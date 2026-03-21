// poll-live-fights — Supabase Edge Function
// Called by pg_cron every minute. No JWT required.
// Polls ESPN scoreboard for today's live fights and writes status to fights table.
//
// Guards (in order):
//   1. Exit if no UFC event today (event_date = UTC today)
//   2. Exit if current time is before event start_time
//   3. Exit if all upcoming fights already have fight_ended_at set
//
// Uses native fetch + Supabase REST API only — NO esm.sh imports.

// ---------- helpers (mirrors FightDetailView.js) ----------

function normName(name: string): string {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function matchesFighter(jsName: string, metaName: string): boolean {
  const a = normName(jsName)
  const b = normName(metaName)
  if (!a || !b) return false
  if (a === b) return true

  const aCol = a.replace(/\s/g, '')
  const bCol = b.replace(/\s/g, '')
  if (aCol === bCol) return true

  // Same chars, different order (Chinese name transliterations)
  if (aCol.length >= 5 && aCol.length === bCol.length) {
    if ([...aCol].sort().join('') === [...bCol].sort().join('')) return true
  }

  const aWords = a.split(' ')
  const bWords = b.split(' ')
  const aLast = aWords[aWords.length - 1]
  const bLast = bWords[bWords.length - 1]
  if (aLast === bLast && aLast.length > 3) return true

  const shorter = aWords.length <= bWords.length ? aWords : bWords
  const longer  = aWords.length <= bWords.length ? bWords : aWords
  return shorter.filter((w: string) => w.length > 1).every((w: string) => longer.includes(w))
}

// Match an ESPN competition to a fight.bout string using both fighters
function boutMatchesComp(bout: string, comp: any): boolean {
  const parts = (bout || '').split(/ vs /i)
  if (parts.length < 2) return false
  const compNames = (comp.competitors || []).map((c: any) => c.athlete?.displayName || '')
  return compNames.some((n: string) => matchesFighter(n, parts[0])) &&
         compNames.some((n: string) => matchesFighter(n, parts[1]))
}

// ---------- main ----------

Deno.serve(async (_req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const dbHeaders = {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    }

    const nowMs    = Date.now()
    const todayUTC = new Date(nowMs).toISOString().slice(0, 10)          // YYYY-MM-DD
    const ydayUTC  = new Date(nowMs - 86400000).toISOString().slice(0, 10) // yesterday

    // Guard 1: Any UFC events in the last 24 hours?
    // Use a 2-day window (yesterday → today) because UFC events start late US time
    // and can still be ongoing after UTC midnight rolls to the next day.
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ufc_events?event_date=gte.${ydayUTC}&event_date=lte.${todayUTC}&select=event_name,event_date,start_time&order=event_date.desc&limit=1`,
      { headers: dbHeaders }
    )
    const events = await eventsRes.json()
    if (!events.length) {
      return json({ ok: true, skipped: 'no_event_today' })
    }
    const event = events[0]

    // Guard 2: Before event start_time?
    // start_time is stored as an ESPN ISO 8601 string e.g. "2026-03-08T23:00:00Z"
    if (event.start_time) {
      const startMs = new Date(event.start_time).getTime()
      if (!isNaN(startMs) && Date.now() < startMs) {
        return json({ ok: true, skipped: 'before_start_time', start_time: event.start_time })
      }
    }

    // Guard 3: All upcoming fights already ended?
    const fightsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/fights?event_name=eq.${encodeURIComponent(event.event_name)}&status=eq.upcoming` +
      `&select=id,bout,fight_started_at,fight_ended_at,rounds_fought,scheduled_rounds,ended_by_decision,espn_competition_id,card_position`,
      { headers: dbHeaders }
    )
    const fights = await fightsRes.json()
    if (!fights.length) {
      return json({ ok: true, skipped: 'no_upcoming_fights' })
    }
    if (fights.every((f: any) => f.fight_ended_at !== null)) {
      return json({ ok: true, skipped: 'all_fights_ended' })
    }

    // Fetch ESPN scoreboard using the event's stored date (not UTC today —
    // the event may span midnight UTC so event_date is the local US start date)
    const espnDate = event.event_date.replace(/-/g, '') // YYYYMMDD
    const espnRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${espnDate}`
    )
    if (!espnRes.ok) {
      return json({ ok: false, error: 'ESPN fetch failed', espnStatus: espnRes.status }, 502)
    }
    const espnJson = await espnRes.json()

    // Build card_position map from ESPN competition order.
    // ESPN lists competitions chronologically (first fight = index 0).
    // We want main event = 1 (top), so card_position = totalComps - index.
    const allComps: any[] = []
    for (const ev of espnJson.events || []) {
      if (!ev.name?.toUpperCase().includes('UFC')) continue
      for (const c of ev.competitions || []) allComps.push(c)
    }
    const totalComps = allComps.length
    const compPositionMap = new Map<any, number>()
    allComps.forEach((c: any, i: number) => compPositionMap.set(c, totalComps - i))

    const now = new Date().toISOString()
    const results: any[] = []

    for (const fight of fights) {
      if (fight.fight_ended_at) {
        results.push({ fight_id: fight.id, skipped: 'already_ended' })
        continue
      }

      // Find matching ESPN competition — by ID first, then by bout name
      let comp: any = null
      for (const ev of espnJson.events || []) {
        if (!ev.name?.toUpperCase().includes('UFC')) continue
        if (fight.espn_competition_id) {
          comp = (ev.competitions || []).find(
            (c: any) => String(c.id) === String(fight.espn_competition_id)
          )
        }
        if (!comp) {
          comp = (ev.competitions || []).find((c: any) => boutMatchesComp(fight.bout, c))
        }
        if (comp) break
      }

      if (!comp) {
        results.push({ fight_id: fight.id, skipped: 'no_espn_match' })
        continue
      }

      const statusName: string = comp.status?.type?.name || ''
      const period: number     = comp.status?.period || 0
      const espnScheduled: number | null = comp.format?.regulation?.periods || null
      const isDecision: boolean = (comp.details || []).some((d: any) => d.type?.id === '22')

      const updates: Record<string, unknown> = {}

      // Always sync card_position from ESPN order
      const espnPos = compPositionMap.get(comp)
      if (espnPos && espnPos !== fight.card_position) {
        updates.card_position = espnPos
      }

      // Always persist scheduled_rounds on first sight (available before fight starts)
      if (espnScheduled && !fight.scheduled_rounds) {
        updates.scheduled_rounds = espnScheduled
      }

      if (statusName.startsWith('STATUS_IN_PROGRESS') || statusName === 'STATUS_END_OF_ROUND') {
        if (!fight.fight_started_at) updates.fight_started_at = now
        if (espnScheduled) updates.scheduled_rounds = espnScheduled

      } else if (statusName === 'STATUS_FINAL') {
        if (!fight.fight_started_at) updates.fight_started_at = now
        if (!fight.fight_ended_at)   updates.fight_ended_at   = now

        // Guard: ESPN occasionally returns period=0 on STATUS_FINAL
        const finalPeriod = period > 0
          ? period
          : ((fight.rounds_fought || 0) > 0 ? fight.rounds_fought : (fight.scheduled_rounds || 3))

        if (!fight.rounds_fought) updates.rounds_fought = finalPeriod
        updates.ended_by_decision = isDecision
        if (espnScheduled) updates.scheduled_rounds = espnScheduled
      }

      if (Object.keys(updates).length === 0) {
        results.push({ fight_id: fight.id, noop: true, status: statusName })
        continue
      }

      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/fights?id=eq.${fight.id}`,
        {
          method: 'PATCH',
          headers: { ...dbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify(updates),
        }
      )

      results.push({ fight_id: fight.id, status: statusName, updates, ok: patchRes.ok })
    }

    return json({ ok: true, event: event.event_name, results })
  } catch (err: any) {
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
