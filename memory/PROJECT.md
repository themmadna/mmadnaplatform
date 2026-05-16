# UFC Ratings & Combat DNA — Project Reference

> Companion to `claude-skills-guide.md` for Skills integration planning.
> Derived from source code, context docs, and project plan as of 2026-03-28.

---

## 1. Project Overview

**UFC Ratings** is a fan-facing MMA analytics platform that flips the traditional perspective: instead of profiling fighters, it profiles *fans*. By rating fights and scoring rounds, users generate a personalized **Combat DNA** — a fingerprint of their specific taste in violence, revealing whether they prefer brawls, grappling wars, striking technicians, or finishes.

**Secondary purpose:** Judge accountability. Users can score rounds blind and compare their decisions against official judges, building a "Judging DNA" profile that reveals accuracy, tendencies, and biases.

**Target users:** MMA fans ranging from casual viewers wanting self-discovery to serious analysts interested in judge accountability and data-driven fight evaluation.

**Stack at a glance:** React 18 + Tailwind (Pulse theme) → Supabase (PostgreSQL + Auth + Edge Functions) ← Python scrapers (ufcstats.com + mmadecisions.com + ESPN).

---

## 2. Tech Stack

### Frontend
| Tool | Version | Role |
|------|---------|------|
| React | 18.2.0 | UI framework (CRA, hooks only — no Redux/Context) |
| Tailwind CSS | 3.4.1 | Utility-first styling with custom Pulse theme tokens |
| Recharts | 3.7.0 | Radar charts, line charts |
| Lucide React | 0.562.0 | Icons |
| Supabase JS | ^2.89.0 | Database client + auth |
| React Scripts | 5.0.1 | Build tooling |

### Backend / Database
| Tool | Role |
|------|------|
| Supabase (PostgreSQL) | Primary database — 10 tables, 4 views, 9 RPC functions |
| Supabase Auth | JWT-based auth (anon + service role) |
| Supabase Edge Functions | TypeScript — poll-live-fights, record-fight-status |
| pg_cron + pg_net | Server-side ESPN polling every 60 seconds |

### Python Data Pipeline
| Tool | Role |
|------|------|
| Python 3.9 | All scrapers (`C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe`) |
| requests + BeautifulSoup4 | Web scraping (ufcstats.com, mmadecisions.com) |
| supabase-py | Database writes (threaded, thread-local instances) |
| argparse | CLI interface for scraper phases |

### ML Model
| Tool | Role |
|------|------|
| scikit-learn | Logistic Regression training |
| scoring_model.json | Exported model loaded in-browser at startup |
| JavaScript (in App.js) | In-browser inference (no API call needed) |

### External Services
| Service | Purpose |
|---------|---------|
| ESPN Sports API | Live fight status, card position, round tracking |
| ufcstats.com | Fight metadata, round-by-round stats |
| mmadecisions.com | Official judge scorecards |
| Vercel | Frontend hosting |

---

## 3. Project Structure

```
ufc-web-app/                             # Git root
├── src/
│   ├── App.js                           # Main component — all view routing (~2500 lines)
│   ├── dataService.js                   # All Supabase queries & RPC calls
│   ├── guestStorage.js                  # sessionStorage wrapper for guest mode
│   ├── supabaseClient.js                # Client init
│   ├── Login.js                         # Supabase Auth UI
│   ├── CombatDNAVisual.js               # Fighter body heatmap SVG (~5748 lines)
│   └── components/
│       ├── FightDetailView.js           # Fight detail (4-tab, live polling) — 916 lines
│       ├── RoundScoringPanel.js         # Per-round scoring UI — 500 lines
│       ├── ScorecardComparison.js       # User vs judges vs community — 375 lines
│       ├── JudgingDNACard.js            # Judging profile + tendencies — 542 lines
│       ├── ScoringInsightsCard.js       # Scoring insights (Phase 9) — 530 lines
│       ├── CombatScatterPlot.js         # Fight scatter plot — 208 lines
│       ├── JudgeDirectory.js            # Judge leaderboard — 175 lines
│       ├── JudgeProfileView.js          # Individual judge profile — 290 lines
│       ├── JudgeComparison.js           # Head-to-head judge comparison — 293 lines
│       └── UserJudgeComparison.js       # User vs specific judge — 307 lines
│
├── supabase/
│   ├── functions/
│   │   ├── poll-live-fights/index.ts    # pg_cron-triggered ESPN poller
│   │   └── record-fight-status/index.ts # Persists fight lifecycle state
│   ├── views/                           # .sql files for 4 computed views
│   └── deploy_*.py                      # Deploy scripts for all 9 RPC functions
│
├── scoring_model/
│   ├── ml_dataset.csv                   # 30,725 training rows
│   ├── scoring_model.json               # Exported Logistic Regression model
│   ├── build_ml_dataset.py
│   ├── train_scoring_model.py
│   ├── eda_report.py
│   └── compare_models.py
│
├── context/                             # Canonical technical reference docs
│   ├── schema.md                        # All table + view schemas
│   ├── rpc-functions.md                 # RPC signatures + SQL implementation notes
│   ├── scrapers.md                      # Phases, env vars, join rules
│   ├── live-events.md                   # ESPN polling, Edge Functions, status codes
│   ├── ml-model.md                      # Model features, JS integration, 10-8 threshold
│   ├── combat-dna.md                    # DNA metrics, formulas, frontend key mapping
│   ├── phase6-architecture.md           # Scoring UI, Judging DNA design
│   └── completed-phases.md             # Historical phase summaries
│
├── "master file for data update.py"     # Main 6-phase scraper pipeline
├── scrape_mmadecisions.py               # Judge scorecard scraper (threaded)
├── validate_scoring_model.py
│
├── tailwind.config.js                   # Pulse theme tokens
├── package.json
├── PROJECT_PLAN.md                      # Phase tracker [x]/[ ]/[~]/[!]
├── LESSONS.md                           # Reusable patterns & gotchas
├── CLAUDE.md                            # Dev workflow & critical conventions
└── mockups/concept-D-pulse/             # 14-page Pulse design mockups
```

---

## 4. Current Features (Complete & Working)

### Combat DNA & Fight Rating
- Like / Dislike / Favorite voting on any fight
- 5 DNA metrics: Strike Pace, Violence Index, Engagement Style, Finish Profile, Grappling Intensity
- Radar chart — user DNA vs UFC baselines
- Fighter body heatmap (head/body/leg strike distribution with CSS glow effects)

### Fight Browsing
- Event list with date filters + fighter search
- Fight cards (red/blue fighter layout, vote buttons)
- `card_position` ordering (main event = 1, derived from ESPN)

### Fight Detail (4-tab layout)
- Overview tab: fight stats summary
- By Round tab: round-by-round stat breakdown
- Scoring tab: user scoring + community comparison
- Judges tab: official judge scorecards

### Round Scoring System
- Per-round blind scoring panel (scores hidden until fight complete)
- Auto-reveal on completion
- Community average comparison
- User vs official judges side-by-side (ScorecardComparison)
- Guest mode (sessionStorage, no account required)
- Spoiler protection toggle (per-fight and profile default)

### Judging DNA (Phase 6)
- Accuracy %, agreement breakdown, judge matches
- Scoring tendencies (strike vs grapple lean, aggressor/KD/TD bias)
- Scoring differentials (avg stat gaps when awarding rounds)
- Gender split toggle (men's / women's)
- Per-weight-class accuracy breakdown
- Collapsible scored fights list with accuracy indicators
- Tier-gated unlocks (15 / 40 / 80 matched rounds)

### Judge Analytics (Phase 4)
- Judge Directory — sortable leaderboard (50+ rounds threshold)
- Individual Judge Profile — style preferences, weight class breakdown, era trends
- Judge Comparison — head-to-head between any two judges
- User vs Judge Comparison

### Scoring Insights (Phase 9)
- Stat Fingerprint (radar: which stats drive your scoring)
- Pattern Breaks (rounds where your pick contradicted your fingerprint)
- Stat-Score Disconnect (rounds scored against the stat-sheet winner)
- Consistency Score
- Round Drift (accuracy per round number, momentum bias)

### ML Round Scoring
- Logistic Regression (82.5% accuracy, 19 features)
- 10-8 detection at ≥0.99 confidence threshold
- Fully in-browser (loads `scoring_model.json` at startup, no API call)

### Live Events
- ESPN scoreboard polling — client (60s interval) + server-side pg_cron (every 60s)
- Fight lifecycle: `upcoming → in_progress → final` with timestamps
- Progressive round unlock as rounds complete
- Real-time card position tracking (handles reshuffles)

### UI (Phase 8 — Pulse Design System)
- Pulse color palette, Barlow Condensed + Inter typography
- Bottom nav (4 tabs) + top bar layout shell
- Story progress bar (depth-based per section)
- Skeleton loading for all major views
- Staggered card animations, button press feedback
- Mobile-first (44px touch targets, responsive SVG, WCAG AA contrast)

---

## 5. In Progress / Partially Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| CombatDNAVisual body map | Deferred | Landed vs attempted strike data investigation needed before completion |

---

## 6. Planned / Backlog

### Phase 5: Weight Class Analytics (not started)
- **5a.** Division overview — finish rate, average duration, decision rate by division
- **5b.** Style trends over time — strike/grapple ratios per year per division
- **5c.** Radar fingerprint per division
- **5d.** Most controversial division analysis

### Other Deferred
- Edge Function health-check / verification test for poll-live-fights
- Additional body map granularity (landed vs attempted per zone)

---

## 7. Integrations & APIs

### Supabase
- **Project ref:** `hyvyzuzlmnekzvtlauwi`
- **Auth:** JWT — anon key (frontend reads), service key (scraper writes)
- **Management API:** `https://api.supabase.com/v1/projects/{ref}/database/query` — used by deploy scripts
- **Edge Functions deploy:** `npx supabase functions deploy --project-ref <ref> --no-verify-jwt` with `SUPABASE_ACCESS_TOKEN`

### RPC Functions (9 total)
| Function | Purpose |
|----------|---------|
| `get_user_judging_profile()` | Accuracy, tendencies, bias metrics, gender split |
| `get_scoring_insights()` | Fingerprint, pattern breaks, disconnect, consistency, drift |
| `get_judge_directory()` | All judges ≥50 rounds |
| `get_judge_profile(judge_name)` | Individual judge analytics |
| `get_judge_comparison(judge1, judge2)` | Head-to-head |
| `get_user_judge_comparison(judge_name)` | User vs specific judge |
| `get_community_scorecard(fight_id)` | Per-round community average |
| `get_fight_recommendations(user_id, ...7 DNA params)` | DNA-distance recommendations |
| `get_liked_fight_stats()` | Stats for user's liked fights |

### ESPN API (Live Data)
- **Scoreboard:** `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=YYYYMMDD`
- **Competition detail:** Sports Core API for individual fight status + round tracking
- **Caveat:** Data is ephemeral — only live during the event window; must persist immediately

### ufcstats.com
- Scraped via 6-phase Python pipeline
- Provides: events, fight metadata, round-by-round stats, weight classes
- Critical issue: `bout` field often reversed — always join on `fight_url`

### mmadecisions.com
- Scraped via threaded Python scraper
- Provides: official judge names, per-round scores, decision type
- Critical issue: `event_name` never matches UFC Stats — join on `date ±1 day` + fuzzy fighter name

---

## 8. Repeated Workflows (Skill Candidates)

### Post-Event Data Update
1. Run `python "master file for data update.py"` (6 phases, 30–90 min)
2. Phase 6 separately: `python scrape_mmadecisions.py` (2–3 hrs, threaded)
3. Verify data with fight_scraping_status view
4. Push to Vercel if needed

### RPC Function Deployment
1. Write SQL in `supabase/deploy_<name>.py`
2. POST to Supabase Management API with `SUPABASE_MANAGEMENT_KEY`
3. Grant permissions (`GRANT EXECUTE TO authenticated` or `SECURITY DEFINER`)
4. Add/update call in `dataService.js`
5. Wire result into component state

### New React Component
1. Create file in `src/components/`
2. Import into `App.js`, add to `currentView` routing
3. Add data-fetching function to `dataService.js`
4. Add navigation trigger (bottom nav or in-view link)

### Session Workflow (after any task group)
1. Mark tasks complete in `memory/PROGRESS.md`
2. Add patterns to `memory/LESSONS.md` (under relevant topic section)
3. Update relevant `context/` file(s) — context/ is the canonical source
4. Update `MEMORY.md` if stable patterns confirmed
5. Ask user about commit + push

---

## 9. Pain Points & Manual Steps

| Pain Point | Impact | Notes |
|------------|--------|-------|
| Scraper runs fully manual | High | Must be triggered by developer after every UFC event |
| Judge scraper takes 2–3 hours | Medium | Threading helps but mmadecisions rate-limits |
| RPC deploy scripts written per-function | Medium | Each new function needs a new deploy_*.py file |
| ESPN data ephemeral | High | Must poll during the event window or data is lost |
| `bout` reversal across tables | High | Subtle silent bug; always need double-order matching |
| Fighter name fuzzy matching | Medium | New name formats occasionally break matchesFighter() |
| Windows UTF-8 stdout | Low | `sys.stdout.reconfigure(encoding='utf-8')` every scraper file |
| context/ docs drift | Medium | Must manually update after changes or they become stale |
| No automated tests | High | Full regression is manual checklist |

---

## 10. Conventions & Constraints

### Database / SQL
- **Join key:** Always `fight_url`, NEVER `bout` or `event_name` across sources
- **Bout reversal:** When matching `bout` within the same source, always test both orderings: `rfs.bout = fmd.bout OR rfs.bout = REVERSE(fmd.bout)`
- **Judge scores join:** `date ±1 day` only — `event_name` never matches across sources
- **`weight_class`** (raw) on fight cards; **`weight_class_clean`** (normalized) in analytics
- **`fight_dna_metrics` is a VIEW** — frontend reads here, never raw `round_fight_stats`
- **`SUPABASE_SERVICE_KEY`** required for all scraper writes — anon key fails silently
- **`leaderboard_eligible`** is a GENERATED ALWAYS column — never write to it directly

### Frontend Architecture
- **No Redux or Context API** — React hooks + `dataService.js` singleton only
- **Single `currentView` string** — controls all navigation routing in App.js
- **Derived booleans** — gate logic via derived state (e.g. `isLive = !!startedAt && !endedAt`)
- **`locked` prop defaults to `false`** in FightCard — must be explicitly passed where voting should be blocked
- **Click-outside pattern:** wrap toggle button + dropdown in a single ref'd container
- **Guest mode:** separate code paths for `user` (Supabase) vs `null` (sessionStorage)
- **`getRecommendations(userId, combatDNA)`** — both args always required; maps to all 7 RPC params

### Fighter Name Matching (`matchesFighter()` — 6 strategies in priority order)
1. Exact `normName()` match (Unicode NFD decomposition)
2. Space-collapse (handles "Rong Zhu" / "Rongzhu")
3. Character-sort anagram — only when `length === other.length >= 5`
4. First-name prefix + same last name ("Josh Van" / "Joshua Van")
5. Last-name match (last word, length > 3)
6. Word-subset match (all words of shorter name appear in longer)

### ML Model Conventions
- **Symmetric augmentation** — every training row mirrored to prevent positional bias
- **Differential features** — `f1_stat - f2_stat` not raw values
- **10-8 threshold = 0.99 confidence** — not KD-based (82.9% of real 10-8 rounds have 0 KDs)

### Live Event Edge Cases
- **UTC midnight:** UFC events run past midnight UTC — guard uses 2-day window (yesterday–today)
- **ESPN query date:** use `event.event_date`, not UTC today
- **`period = 0` on STATUS_FINAL:** use fallback chain (`last_rounds → scheduled → 3`)
- **Mount timing:** immediate ESPN poll fires before `eventFights` state populates → silent no-op is safe

### Deployment
- **Edge Functions:** Supabase Management API ZIP upload → 500 error. Use CLI deploy instead
- **pg_cron/pg_net:** not enabled by default — run `CREATE EXTENSION IF NOT EXISTS pg_cron` via management API query endpoint
- **Vercel:** standard `npm run build` + push (auto-deploy on main branch push)

### Scraper Conventions
- `sys.stdout.reconfigure(encoding='utf-8', errors='replace')` at top of every Python scraper
- Thread-local Supabase client instances — shared client causes threading errors
- `.limit(N)` on incremental queries is a bug — dedup is per-record check, not pagination
- Consecutive-skip counter (not break-on-first) to handle gap records

### Documentation Hierarchy
- **`context/`** — Canonical technical truth; read before task, update after
- **`memory/LESSONS.md`** — Reusable patterns (organized by topic)
- **`CLAUDE.md`** — Critical always-on conventions only
- **`memory/PROGRESS.md`** — Phase tracker with `[x]` / `[ ]` / `[~]` / `[!]` markers
- **`MEMORY.md`** — Cross-session memory index (pointers to detail files)

---

## 11. Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| `ufc_events` | Events: name, date, URL, start_time |
| `fights` | Fight records: fight_url, status, started/ended timestamps, card_position |
| `fight_meta_details` | Metadata: fighter names, weight_class_clean, title_fight flag |
| `round_fight_stats` | Per-round stats: sig strikes, KD, control time, TD, etc. |
| `judge_scores` | Official decisions: judge, fighter, round, score |
| `user_round_scores` | User scoring: user_id, fight_id, round, f1_score, f2_score |
| `user_fight_scorecard_state` | Scoring metadata: scored_blind, forfeited, leaderboard_eligible (generated) |
| `user_votes` | Likes/dislikes/favorites: user_id, fight_id, vote_type |
| `fight_ratings` | Aggregated vote counts per fight: likes_count, dislikes_count, favorites_count |
| `profiles` | Per-user settings: spoiler_protection (bool, default true) |
| `fight_dna_metrics` (VIEW) | Computed DNA metrics per fight — frontend reads here |
| `ufc_baselines` (VIEW) | Average DNA metrics across all fights |
| `fight_scraping_status` (VIEW) | Data completeness per fight |
| `judge_scores_coverage` (VIEW) | Judge data coverage summary |

---

## 12. Performance Notes

- `fight_dna_metrics` computed on query — acceptable at ~3K fights; revisit if 10K+
- `getScoringInsights` lazy-loaded on demand (not at page load)
- Judge directory RPC pre-aggregates before `json_agg` to avoid PostgreSQL error 42803
- Scraper threads: 5 workers for fight page fetches with exponential backoff on rate limits
- RPC results cached in component state — no re-fetch unless user navigates away

---

## 13. Project Phase History

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Events + fights scraper | Complete |
| 2 | Fight metadata + stats | Complete |
| 3 | User voting + Combat DNA | Complete |
| 4 | Judge analytics | Complete |
| 4.5 | Fight recommendations | Complete |
| 5 | Weight class analytics | **Not started** |
| 6 | Live events + round scoring + Leaderboard | Complete |
| 7 | Judge Directory + profiles + comparison | Complete |
| 8 | UI overhaul (Pulse design system) | Complete; CombatDNAVisual landed/attempted deferred |
| 9 | Scoring Insights | Complete |
| — | Post-Event Automation (`--post-event` GH Actions cron) | Complete |
