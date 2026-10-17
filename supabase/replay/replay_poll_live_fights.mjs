// Dry-run replay of poll-live-fights against UFC 332 (2026-10-03).
// Runs the REAL index.ts under Node (type-stripped) with a Deno shim. Supabase REST is
// mocked in memory (nothing is written anywhere); ESPN is fetched for real with whatever
// headers the function sends.
//
// Run from ufc-web-app/ (Node 22.18+ / 24 — strips TS types natively):
//   node supabase/replay/replay_poll_live_fights.mjs
// Needs ESPN to still serve the 2026-10-03 scoreboard (it has kept old cards so far).
//
// ufc332_fixture.json:
//   pre_event_rows — the 13 fights rows as they stood pre-card (first pick-watch snapshot;
//                    includes 9060 McGhee vs Sopaj, the late opponent swap)
//   final_rows     — the post-scrape rows: ESPN ids, card positions, ufcstats winners
//                    used as ground truth (9069/9070 were inserted by the scrape)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(here, '..', 'functions', 'poll-live-fights', 'index.ts');
const MOCK = 'https://mock.supabase.local';

const fx = JSON.parse(fs.readFileSync(path.join(here, 'ufc332_fixture.json'), 'utf8'));
const db = { event: fx.event, fights: fx.final_rows };
const dbById = Object.fromEntries(db.fights.map(f => [f.id, f]));
const baseFights = () => fx.pre_event_rows.map(r => ({
  ...r,
  scheduled_rounds: null,
  espn_competition_id: dbById[r.id]?.espn_competition_id ?? null,
  card_position: dbById[r.id]?.card_position ?? null,
}));
const finalWinners = Object.fromEntries(db.fights.map(f => [f.id, f.winner])); // ufcstats truth

// ---- mock environment
let state = { event: null, fights: [], patches: [], espnCalls: [], espnTransform: null };
globalThis.Deno = {
  env: { get: k => ({ SUPABASE_URL: MOCK, SUPABASE_SERVICE_ROLE_KEY: 'mock' })[k] },
  serve: h => { globalThis.__handler = h; },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith(MOCK)) {
    const method = init.method || 'GET';
    if (method === 'GET' && url.includes('/ufc_events')) return Response.json([state.event]);
    if (method === 'GET' && url.includes('/fights')) return Response.json(state.fights);
    if (method === 'PATCH') {
      const body = JSON.parse(init.body);
      state.patches.push({ url: decodeURIComponent(url.replace(MOCK, '')), body });
      return new Response(null, { status: 204 });
    }
    throw new Error('unmocked ' + method + ' ' + url);
  }
  const res = await realFetch(url, init);
  state.espnCalls.push({ url, ua: init.headers?.['User-Agent'] ?? '(default)', status: res.status });
  if (!res.ok || !state.espnTransform) return res;
  const j = await res.json();
  return Response.json(state.espnTransform(j));
};

await import(pathToFileURL(indexPath).href);
const handler = globalThis.__handler;

async function run(label, fights, { espnTransform = null } = {}) {
  state = {
    event: { ...db.event, ended_at: null },
    fights, patches: [], espnCalls: [], espnTransform,
  };
  const res = await handler(new Request('http://x'));
  const body = await res.json();
  console.log(`\n=== ${label} ===  HTTP ${res.status}`);
  for (const c of state.espnCalls) console.log(`  ESPN ${c.status}  UA=${c.ua.slice(0, 40)}`);
  return { body, patches: state.patches };
}

const ago = ms => new Date(Date.now() - ms).toISOString();
const byId = patches => Object.fromEntries(
  patches.filter(p => p.url.startsWith('/rest/v1/fights?id=eq.'))
    .map(p => [Number(p.url.split('eq.')[1]), p.body]));
const last = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(' ').pop();
let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

// 1. Pre-event state, poller first sees the card fully FINAL (its dead-poller reality).
{
  const { body, patches } = await run('1. pre-event rows, ESPN all FINAL', baseFights());
  const p = byId(patches);
  console.log('  results:', body.results.map(r => `${r.fight_id}:${r.skipped || (r.swap ? 'swap' : r.status)}`).join(' '));
  for (const f of baseFights()) {
    const u = p[f.id] || {};
    const truthId = f.id === 9060 ? 9070 : f.id; // 9060 became 9070 in the real scrape
    console.log(`  ${f.id}  ${(u.bout || f.bout).padEnd(40)} winner=${JSON.stringify(u.winner)}  truth=${finalWinners[truthId]}`);
    check(u.fight_ended_at && u.winner && last(u.winner) === last(finalWinners[truthId]),
      `${f.id} ended + winner matches ufcstats`);
  }
  check(p[9060]?.bout?.includes('Romero'), '9060 swap-resolved to McGhee vs Romero');
  check(body.event_ended_at, 'event ended_at stamped (main event FINAL)');
}

// 2. Already ended 2 min ago (app stamped it), winner NULL → winner filled, no re-stamp.
{
  const fights = baseFights().map(f => ({ ...f, fight_started_at: ago(20 * 60e3), fight_ended_at: ago(2 * 60e3), rounds_fought: 3 }));
  const { patches } = await run('2. ended 2m ago, winner NULL', fights);
  const p = byId(patches);
  const all = fights.filter(f => f.id !== 9060);
  check(all.every(f => p[f.id]?.winner), 'every matched fight gets a winner');
  check(all.every(f => !('fight_ended_at' in (p[f.id] || {})) && !('rounds_fought' in (p[f.id] || {}))),
    'no re-stamp of fight_ended_at / rounds_fought');
}

// 3. Winner flag lagging: strip winner flags from ESPN.
const stripWinners = j => { for (const e of j.events || []) for (const c of e.competitions || []) for (const cc of c.competitors || []) delete cc.winner; return j; };
{
  const fights = baseFights().map(f => ({ ...f, fight_started_at: ago(20 * 60e3), fight_ended_at: ago(2 * 60e3) }));
  const { patches } = await run('3a. no flag, ended 2m ago (inside grace)', fights, { espnTransform: stripWinners });
  const p = byId(patches);
  check(Object.values(p).every(u => !('winner' in u)), 'no winner written inside grace');
}
{
  const fights = baseFights().map(f => ({ ...f, fight_started_at: ago(40 * 60e3), fight_ended_at: ago(15 * 60e3) }));
  const { patches } = await run('3b. no flag, ended 15m ago (past grace)', fights, { espnTransform: stripWinners });
  const p = byId(patches);
  check(fights.filter(f => f.id !== 9060).every(f => p[f.id]?.winner === ''), "'' (draw/NC) written past grace");
}
{
  const fights = baseFights().map(f => ({ ...f, fight_started_at: ago(10 * 60e3) }));
  const { patches } = await run('3c. no flag, first FINAL sighting this cycle', fights, { espnTransform: stripWinners });
  const p = byId(patches);
  check(Object.values(p).every(u => !('winner' in u)) && Object.values(p).some(u => u.fight_ended_at),
    'stamps end but no winner on first sight');
}

// 4. Settled: all ended with winners → guard 3 exits before ESPN.
{
  const fights = baseFights().map(f => ({ ...f, fight_ended_at: ago(60e3), winner: 'x' }));
  const { body } = await run('4. all settled', fights);
  check(body.skipped === 'all_fights_ended', `guard 3 exits (${body.skipped})`);
}
// 5. Ended 7h ago, winner NULL → past chase cap, settled.
{
  const fights = baseFights().map(f => ({ ...f, fight_ended_at: ago(7 * 3600e3), winner: null }));
  const { body } = await run('5. ended 7h ago, winner NULL', fights);
  check(body.skipped === 'all_fights_ended', `chase cap → guard 3 exits (${body.skipped})`);
}
// 6. Mixed: one ended+winner, others not → the settled one is skipped, no patch for it.
{
  const fights = baseFights().map((f, i) => i === 0 ? { ...f, fight_ended_at: ago(60e3), winner: 'Someone' } : f);
  const { body, patches } = await run('6. one settled, rest pre-event', fights);
  check(body.results.find(r => r.fight_id === fights[0].id)?.skipped === 'already_ended' && !byId(patches)[fights[0].id],
    'settled fight skipped, not patched');
}

console.log(`\n${failures ? `FAILURES: ${failures}` : 'ALL CHECKS PASSED'}`);
process.exit(failures ? 1 : 0);
