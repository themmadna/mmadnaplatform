# Schema Integrity — 2026-05-16

---

## §1 Foreign Keys

| Table.Column | → | Target | Delete | Status |
|---|---|---|---|---|
| `fight_ratings.fight_id` | → | `fights.id` | CASCADE | ✅ |
| `round_fight_stats.fight_url` | → | `fights.fight_url` | CASCADE | ✅ added April |
| `user_fight_scorecard_state.fight_id` | → | `fights.id` | CASCADE | ✅ |
| `user_round_scores.fight_id` | → | `fights.id` | CASCADE | ✅ |
| `user_votes.fight_id` | → | `fights.id` | **NO ACTION** | ⚠️ inconsistent with sibling tables |

**Finding (P2):** `user_votes.fight_id → fights.id` has `ON DELETE NO ACTION`, every other user-data table uses `CASCADE`. If a fight is ever deleted (Phase 2 auto-delete guard exists but isn't bulletproof), votes for that fight will block the delete with a constraint violation. Pick a behavior and apply it consistently. CASCADE matches sibling tables and the user-data lifecycle.

**Coverage check — what's NOT FK-protected:**
- `judge_scores → fights` — no FK. The cross-source date-±1-day join is the only link. Documented intent (`judge_scores.event_name` never matches `fights.event_name` per Convention #2), so an FK isn't feasible. Convention is the protection.
- `fight_meta_details → fights` — no FK, but joined via `fight_url`. Both come from ufcstats, so a FK on `fight_url` is feasible. **P2 suggestion** — add `FK(fight_meta_details.fight_url) REFERENCES fights(fight_url) ON DELETE CASCADE` once you confirm no fmd rows orphaned (`completed_no_meta` query returned 0).
- `user_round_scores.user_id` / `user_votes.user_id` / `profiles.user_id` — no explicit FK to `auth.users` in `information_schema.referential_constraints`, but the deploy script comment claims `profiles.user_id FK → auth.users ON DELETE CASCADE`. The constraint may exist outside the public schema. Verify by querying `pg_constraint` joined to `auth.users.oid`. *(Not blocking — Supabase guarantees auth.users existence; orphan checks below all returned 0.)*

---

## §2 NOT NULL Gaps

Spot-checked columns the app assumes non-null. No surprises:

- `fight_meta_details.fighter1_name` / `fighter2_name` / `fight_url` — NOT NULL ✓
- `judge_scores.fighter`, `judge`, `score`, `round`, `date`, `bout` — NOT NULL ✓
- `round_fight_stats.event_name`, `bout`, `fighter_name`, `round` — NOT NULL ✓ (but `fight_url` is nullable — see §3)
- `fights.event_name`, `bout` — NOT NULL ✓ (`winner` nullable; that's the bug in 04-data-quality §2)
- `profiles.spoiler_protection` — NOT NULL with default `true` ✓

---

## §3 P1 — `round_fight_stats.fight_url` NULL on recent rows

**Finding:** 270 of 40886 rfs rows (0.66%) have `fight_url IS NULL`, all from events **after** the April FK migration:

```
event_name                                      null_url_rows
UFC Fight Night: Sterling vs Zalal              76
UFC 328: Chimaev vs Strickland                  74
UFC Fight Night: Della Maddalena vs Prates      60
UFC Fight Night: Burns vs Malott                54
UFC 327: Prochazka vs Ulberg                     6
```

The April migration (`supabase/migrate_round_stats_fk.py`) backfilled `fight_url` on every existing row, but the live Phase 4 scraper insert statement isn't writing `fight_url`. The FK allows NULL so the migration didn't fail.

**Evidence:**
```sql
SELECT event_name, COUNT(*) FROM round_fight_stats
WHERE fight_url IS NULL GROUP BY event_name ORDER BY 2 DESC;
```

**Impact:**
- Any future query that joins via `rfs.fight_url` (more robust than `event_name + bout`) silently drops these rows.
- A future migration that tightens the FK to `NOT NULL` will fail.
- The current `fight_dna_metrics` view aggregates by `(event_name, bout)`, so the symptom is masked today.

**Root cause hypothesis:** Phase 4 in `master file for data update.py` upserts on `(event_name, bout, round, fighter_name)` and doesn't include `fight_url` in the column list. Phase 3 has the `fight_url` available — could be threaded down or backfilled with a one-liner UPDATE keyed on `(event_name, bout)`.

**Suggested fix (not deployed):**
1. Scraper change: include `fight_url` in the Phase 4 upsert payload (read from the same fight detail page that already populates fight_meta_details).
2. One-time backfill: `UPDATE round_fight_stats rfs SET fight_url = f.fight_url FROM fights f WHERE rfs.event_name = f.event_name AND (rfs.bout = f.bout OR rfs.bout = TRIM(SPLIT_PART(f.bout,' vs ',2))||' vs '||TRIM(SPLIT_PART(f.bout,' vs ',1))) AND rfs.fight_url IS NULL;`

---

## §4 Indexes

All 6 indexes from `supabase/deploy_indexes.py` present:

```
judge_scores(date)                      idx_judge_scores_date ✓
judge_scores(judge)                     idx_judge_scores_judge ✓
fight_meta_details(fight_url)           idx_fight_meta_details_fight_url ✓
fight_meta_details(weight_class_clean)  idx_fight_meta_details_weight_class_clean ✓
round_fight_stats(event_name, bout)     idx_round_fight_stats_event_bout ✓
user_round_scores(user_id, fight_id)    idx_user_round_scores_user_fight ✓
```

Plus auto-generated PK and unique-constraint indexes (e.g. `fights.fight_url_key`, `round_fight_stats_unique`).

**Suggested adds (P2):**
- `idx_round_fight_stats_fight_url` once §3 above is resolved — Phase 9's `get_scoring_insights` and any future fight_url-based join will benefit.
- `idx_user_votes_fight_id` — `update_fight_ratings` trigger filters by `fight_id` to recount. At 240 rows it's negligible, but the trigger fires per vote so this scales linearly with users.

---

## §5 Dead tables / columns

**Backup tables (P0 — see 01-security §1):**
- `fight_ratings_backup` (8500 rows)
- `user_votes_backup` (130 rows)

Both untouched since the April migration and not referenced by any view or RPC. Drop after final confirmation that the live tables hold canonical data.

**No dead columns identified** — every column in `context/schema.md` is referenced by at least one view, RPC, or scraper.

---

## §6 Row counts (for context)

```
fight_meta_details          8686
fight_ratings               8560
fight_ratings_backup        8500       <-- dead
fights                      8700
judge_scores               63274
profiles                       1       <-- pre-launch scale
round_fight_stats          40886
ufc_events                   773
user_fight_scorecard_state    24
user_round_scores            108       <-- 3 distinct users (1 with profile)
user_votes                   240
user_votes_backup            130       <-- dead
```

108 user_round_scores across 3 distinct user_ids; only 1 row in `profiles`. The other 2 users have user_round_scores but never saved a profile — `profiles` is created lazily on first profile save. Not a bug; just observability.
