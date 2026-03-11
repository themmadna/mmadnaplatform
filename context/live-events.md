# Live Events Reference

ESPN polling, Edge Function, status codes, and live scoring architecture.
Update this file whenever the Edge Function, polling logic, or status handling changes.

---

## ESPN Status Codes

Used by the frontend to drive live event badges and the `record-fight-status` Edge Function.

| Status | Meaning | Treatment |
|---|---|---|
| `STATUS_SCHEDULED` | Not started | Upcoming |
| `STATUS_FIGHTERS_WALKING` | Walkout | Upcoming — do NOT trigger live |
| `STATUS_IN_PROGRESS` | Round 1 live | Live — use `startsWith('STATUS_IN_PROGRESS')` |
| `STATUS_IN_PROGRESS_2/3/4/5` | Round N live | Live |
| `STATUS_END_OF_ROUND` | Between rounds | Live |
| `STATUS_FINAL` | Fight over | Completed |

---

## ESPN Polling Endpoints

```
# Event-level scoreboard (works for historical dates too — returns STATUS_FINAL for past events)
https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=YYYYMMDD

# Competition-level status (used during live events)
https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/{eventId}/competitions/{competitionId}/status
```

Key fields: `comp.status.type.name` (status code), `comp.format.regulation.periods` (scheduled rounds), `comp.details` (finish type — check type id `'22'` for Unofficial Winner Decision).

**ESPN scoreboard is ephemeral** — only serves live data during the event window. Always persist data to DB immediately; do not rely on ESPN being available after the event.

---

## Edge Function — `record-fight-status`

Deployed at `{SUPABASE_URL}/functions/v1/record-fight-status` (current: v6).

### Request
```
POST { fight_id, status?, scheduled_rounds?, rounds_fought?, ended_by_decision? }
Authorization: Bearer {user JWT}
```
`status` is optional — metadata-only calls omit it. If present, must be `'in_progress'` or `'final'`.

### Behaviour
- Writes `fight_started_at` / `fight_ended_at` NULL-safely (idempotent — only writes if currently NULL)
- Always writes ESPN metadata fields (`scheduled_rounds`, `rounds_fought`, `ended_by_decision`) when provided
- Uses native `fetch` + Supabase REST API — **NO esm.sh imports** (Management API deployments are not pre-bundled; esm.sh imports cause BOOT_ERROR)
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected env vars in the Edge Function runtime

### Critical config
`verify_jwt` must be `false` on this function. Set via Management API PATCH:
```
PATCH https://api.supabase.com/v1/projects/{ref}/functions/record-fight-status
{ "verify_jwt": false }
```
Default `true` causes Supabase middleware to reject valid user JWTs before function code runs.

### Users never write directly to `fights`
The Edge Function is the only path — it runs with service role and validates the ESPN payload before writing.

---

## Frontend Polling Architecture (`FightDetailView.js`)

### State seeding on mount
- `fightStartedAt` / `fightEndedAt` seeded from `fight.fight_started_at` / `fight.fight_ended_at`
- `scheduledRounds` seeded from `fight.scheduled_rounds`
- `scorableRounds` computed from `fight.rounds_fought + fight.ended_by_decision` for completed fights

### Poll timing
- Polls every 60s when fight is upcoming
- First poll fires after 3s delay (prevents race where `eventFights` hasn't loaded yet from Supabase)
- Event-level poll: opening the fight list is sufficient — no need to click individual fights

### Progressive round unlock
- `STATUS_END_OF_ROUND` → `scorableRounds = period` (round just finished — unlock it)
- `STATUS_IN_PROGRESS` → `scorableRounds = period - 1` (round in progress — don't unlock yet)
- On FINAL: check `comp.details` for type id `'22'` → set `ended_by_decision`; persist `rounds_fought + ended_by_decision` to DB

### `fights` table query
`select('*')` everywhere in App.js — new columns auto-included in the `fight` prop without explicit listing.

---

## Live Scoring Render Logic (`FightDetailView`)

- Render no longer gated on `meta !== null` — header falls back to `fight.bout` string; upcoming panels always show
- Completed fight with null meta: shows "stats pending" + scoring panel if `scorableRounds > 0` (ESPN data was persisted)
- Completed fight with meta: full breakdown + scoring + comparison

### Derived booleans
```js
isLive    = !!fightStartedAt && !fightEndedAt
isLocked  = !!fightEndedAt
```
Use derived booleans, not inline JSX conditions — keeps 3-state branching readable.

### Gate/lock logic
- Scoring UI gated on `fight_started_at IS NOT NULL` (fight has started)
- Submissions locked on `fight_ended_at IS NOT NULL` (fight is over)
- `readOnly` in RoundScoringPanel: `judgesRevealed && !isHistorical && isLocked` — stays editable mid-fight for new rounds
- Auto-reveal only fires when `isLocked || isHistorical` — prevents premature lockout between rounds
