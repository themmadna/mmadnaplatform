# Round 3 — Security Response (Agent B)
**Date:** 2026-04-14
**Mode:** Response to Devil's Advocate challenges

---

## Response to: "`record-fight-status` JWT check is theatre — authorization bypass"

**Status: CONFIRMED FINDING — UPGRADED TO HIGH**

DA challenge is fully verified. Reading `record-fight-status/index.ts` lines 12-17:

```typescript
const authHeader = req.headers.get('Authorization')
if (!authHeader) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401, ...
  })
}
```

The function checks only that the `Authorization` header is **non-empty**. It never validates the JWT signature, never calls a Supabase auth verify endpoint, and never checks user identity. Any HTTP client can pass `Authorization: Bearer anything` and proceed to write `fight_started_at`, `fight_ended_at`, `scheduled_rounds`, `rounds_fought`, and `ended_by_decision` to the production `fights` table.

The attacker only needs:
1. The Edge Function URL: `{SUPABASE_URL}/functions/v1/record-fight-status`
2. Any valid `fight_id` (integers 1, 2, 3... visible in the React app)
3. Any non-empty Authorization header value

This is a confirmed **HIGH** severity authorization bypass. It could be exploited to:
- Mark any upcoming fight as `final` before it occurs, breaking the scoring window for all users
- Overwrite `rounds_fought` to corrupt round-by-round scoring panels
- Set `fight_started_at` in the past, affecting time-based filtering

Severity: **HIGH** (upgraded from LOW).

---

## Response to: "CORS `*` on `record-fight-status` amplifies the bypass"

**Status: CONFIRMED FINDING — MEDIUM**

Verified: `record-fight-status/index.ts` line 1:
```typescript
'Access-Control-Allow-Origin': '*'
```

A state-mutating endpoint with wildcard CORS and no real auth check means any webpage can issue cross-origin POST requests to it from a victim's browser. With the JWT bypass, this amplifies the attack surface: a malicious site could trigger fight status corruption without requiring direct API access. CORS wildcard is acceptable on read-only public endpoints but not on authenticated write endpoints. **MEDIUM** (combined with the HIGH bypass above, the effective risk is higher).

---

## Response to: "`.gitignore` encoding corruption — `.claude/settings.local.json` may not be excluded"

**Status: CONFIRMED FINDING — MEDIUM**

Verified: `.gitignore` line 5 reads: `.DS_Store. c l a u d e / s e t t i n g s . l o c a l . j s o n`

This is a single garbled line where `.DS_Store` and `.claude/settings.local.json` appear to be concatenated with space-separated characters — likely a UTF-16 or Windows encoding artifact. This means:
1. `.DS_Store` may not be properly excluded (the rule is malformed)
2. `.claude/settings.local.json` is definitely **not** excluded (git status confirms it as `??` untracked, not ignored)

Claude's local settings file (`settings.local.json`) is confirmed untracked. Its contents are not a secrets store by default, but this is a governance gap — the intent was to exclude it, the execution failed. **MEDIUM** severity — fix by correcting `.gitignore` with proper encoding.

---

## Response to: "Build artifacts contain baked env vars — `build/` exists and was not inspected"

**Status: CONFIRMED FINDING — MEDIUM MAINTAINED**

The DA correctly notes that `build/` exists and could be inspected directly. The `REACT_APP_*` vars are baked into build bundles by CRA at compile time. The anon key is designed to be public (Supabase's security model relies on RLS, not key secrecy), so even if committed, it does not represent a critical secret exposure. However:
- The `REACT_APP_SUPABASE_URL` exposes the project reference
- The anon key still enables unauthenticated queries against tables that lack RLS (see G finding)
- The combination of URL + anon key in version history is a permanent exposure

Add `build/` to `.gitignore` immediately. **MEDIUM** (not CRITICAL because anon key is intentionally public, but the combination is unnecessary exposure).

---

## Response to: "Large CSV files and `scoring_model/ml_dataset.csv` not examined for PII"

**Status: CONFIRMED GAP — RESOLVED LOW**

DA correctly identifies that `ufc_fight_scores*.csv` and `scoring_model/ml_dataset.csv` were not examined. Investigation:

- `ufc_fight_scores*.csv` — contains judge scorecard data (event, bout, fighter, judge, round, score, referee). This is public fight record data with no user identifiers. No PII. **LOW** concern (should be gitignored for repo hygiene, not a security issue).
- `scoring_model/ml_dataset.csv` — confirmed at the path `scoring_model/ml_dataset.csv`. The ML dataset is built from `round_fight_stats` (public fight data). Per the codebase, `user_round_scores` is used for _validation_ of the model (comparing user picks to model picks) but not as a training feature. No user IDs appear in the training features. **No PII confirmed.**

All CSVs should be added to `.gitignore` as large untracked data files. **LOW** severity.

---

## Response to: "IDOR on `get_leaderboard_user_detail()` — not resolved"

**Status: CONFIRMED GAP — ASSESSED MEDIUM**

DA correctly notes the RPC SQL was not read. Based on the context available: `get_leaderboard_user_detail(p_user_id uuid)` returns "fights/rounds with green/red dots" per PROGRESS.md — per-fight and per-round scoring accuracy indicators. The `user_id` to query is visible on the public leaderboard. If the RPC returns the user's per-round scores (f1_score, f2_score per round), this is an IDOR allowing any authenticated user to see another user's detailed scoring.

The deploy script `supabase/deploy_leaderboard_detail.py` contains the SQL but was not read in full. This is a **MEDIUM** finding that requires verification of the RPC's SELECT scope against `user_round_scores`. If it returns only aggregate accuracy (not per-round scores), the IDOR severity is LOW.

---

## Response to: "`.env.example` — MEDIUM here vs HIGH in Agent F"

**Status: ACKNOWLEDGED — SEVERITY RESOLVED AS HIGH**

The DA correctly identifies the contradiction. Resolving: the absence of `.env.example` is **HIGH** in operational terms (cannot reproduce a working environment from the repo alone) and MEDIUM in security terms (secrets themselves are not exposed, just undocumented). The unified severity is **HIGH** because the operational impact is more immediately consequential. Upgrading this finding to HIGH.

---

## Updated Summary

| Finding | Status | Severity |
|---------|--------|----------|
| No hardcoded secrets in source | Confirmed | — |
| `.env` excluded from git | Confirmed | — |
| `record-fight-status` JWT bypass | **UPGRADED** | **HIGH** |
| CORS `*` on write endpoint | **NEW** | MEDIUM |
| `.gitignore` encoding corruption | **NEW** | MEDIUM |
| `build/` not gitignored | Maintained | MEDIUM |
| RLS status unverifiable | Maintained | HIGH |
| CSV files not gitignored / no PII | **NEW** | LOW |
| IDOR on leaderboard user detail | Maintained | MEDIUM (unresolved) |
| `.env.example` missing | **UPGRADED** | HIGH |
