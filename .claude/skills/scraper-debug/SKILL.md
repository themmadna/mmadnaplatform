---
name: scraper-debug
description: Diagnoses data issues, silent bugs, or join failures in the UFC platform scrapers, database queries, or frontend data display. Use when user reports "missing fights", "wrong fighter names", "judge scores not matching", "bout field wrong", "data looks reversed", "scraper returned no results", "stats not showing", "wrong fight linked", "name not matching", or "data is missing".
---

# Scraper & Data Debug

Diagnose data issues in the UFC platform. Most problems trace back to three root causes: bout reversal, cross-source join failure, or fighter name mismatch. Start here before looking elsewhere.

---

## Diagnostic Decision Tree

**Q1: Is data missing entirely, or is it present but wrong/mislinked?**

- Missing entirely → go to **Section A** (scraper ran but wrote nothing)
- Present but linked to wrong fight → go to **Section B** (bout reversal or join failure)
- Present but fighter names don't match → go to **Section C** (name normalization)
- Judge scores specifically missing → go to **Section D** (judge join rules)

---

## Section A — Scraper Ran But Wrote Nothing

**Check 1: Wrong Supabase key**
Anon key fails silently — no error, no write. All scraper writes require `SUPABASE_SERVICE_KEY`.
```python
# Must be service key, not anon key
client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
```

**Check 2: Threading issue**
Shared Supabase client across threads causes silent failures. Each thread must use its own client.
```python
# Wrong: shared client
# Right: thread-local instance
import threading
_local = threading.local()
def get_client():
    if not hasattr(_local, 'client'):
        _local.client = create_client(url, key)
    return _local.client
```

**Check 3: Scraper stopped on first gap**
Incremental scrapers should use a consecutive-skip counter, not break on first missing record. If the scraper stopped before the expected number of fights, this is the cause.
```python
# Wrong: break on first miss
# Right: increment skip counter, break after N consecutive misses
```

**Check 4: `.limit(N)` on incremental query**
`.limit(N)` on an incremental "already scraped" check is a bug — it only checks the first N records, causing re-scrape of everything after N. Dedup must be per-record.

**Check 5: UTF-8 encoding error crashed silently**
Add at top of every scraper:
```python
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
```

---

## Section B — Data Linked to Wrong Fight (Bout Reversal)

This is the most common silent bug. `fight_meta_details.bout` and `round_fight_stats.bout` are frequently stored in reversed fighter order.

**Golden rule: Never join on `bout`. Always join on `fight_url`.**

```sql
-- Wrong:
JOIN fight_meta_details fmd ON rfs.bout = fmd.bout

-- Right (cross-source):
JOIN fight_meta_details fmd ON rfs.fight_url = fmd.fight_url

-- Right (within-source, when fight_url unavailable):
JOIN fight_meta_details fmd ON (
  rfs.bout = fmd.bout OR rfs.bout = REVERSE(fmd.bout)
)
```

**Also never join on `event_name` across sources** — names never match between ufcstats.com and mmadecisions.com.

**Frontend check:** If `fight_dna_metrics` data looks wrong, remember it is a **VIEW** computed from `round_fight_stats`. Never query `round_fight_stats` directly from the frontend — always read from `fight_dna_metrics`.

---

## Section C — Fighter Name Not Matching

The `matchesFighter()` function uses 6 strategies in priority order. If a match is failing, identify which strategy should catch it and check if it's working:

| Strategy | Catches | Condition |
|---|---|---|
| 1. Exact `normName()` | Same name, different Unicode encoding | Always |
| 2. Space-collapse | "Rong Zhu" vs "Rongzhu" | Always |
| 3. Character-sort anagram | Transposed names | Only when `length === other.length >= 5` |
| 4. First-name prefix + same last name | "Josh Van" vs "Joshua Van", "Alex" vs "Alexander" | Always |
| 5. Last-name match | Last word, length > 3 | Always |
| 6. Word-subset | All words of shorter name appear in longer | Always |

**`normName()` uses NFD Unicode decomposition** — not a simple `.toLowerCase()`. Accented characters must decompose to base + combining mark before comparison.

**Debug approach:**
```python
import unicodedata

def normName(name):
    return unicodedata.normalize('NFD', name).lower().strip()

# Test both sides
print(normName("fighter_name_from_source_a"))
print(normName("fighter_name_from_source_b"))
```

If even strategy 6 fails, the name formats are too divergent — add an explicit alias or manual override for that fighter.

---

## Section D — Judge Scores Missing or Not Linking

**Rule: Join judge_scores to fights by `date ±1 day` only.**

`event_name` from mmadecisions.com never matches `event_name` from ufcstats.com — they use different formatting. This is not a bug to fix; it's a permanent constraint.

```sql
-- Correct join:
WHERE js.date BETWEEN f.event_date - INTERVAL '1 day'
                  AND f.event_date + INTERVAL '1 day'

-- Wrong (will return no rows):
WHERE js.event_name = f.event_name
```

**Judge row dedup:** When linking judge rows to fights, require BOTH `f1Row` AND `f2Row` to match. Matching on only one fighter name causes cross-fight collisions (same fighter name appears in multiple fights on the same card).

**Expected coverage baseline:**
- 5,412 fights: complete judge data
- 55 fights: partial
- 678 fights: missing (pre-2010 or no mmadecisions entry) — this is expected, not a bug

**Weight class join:** Use `fight_meta_details.weight_class_clean` (normalized) for analytics. `fights.weight_class` is raw from ESPN and inconsistently formatted.

---

## Section E — Frontend Not Showing Data

**Check 1: Reading from the wrong table**
`fight_dna_metrics` is a VIEW — always read from here, never from `round_fight_stats` directly.

**Check 2: `leaderboard_eligible` is a generated column**
This is `GENERATED ALWAYS` — never write to it. It is computed automatically.

**Check 3: `SUPABASE_SERVICE_KEY` vs anon key**
Frontend uses anon key (correct). Scrapers must use service key. RLS policies gate what anon key can read.

**Check 4: `card_position` ordering**
Fight card order: `card_position ASC NULLS LAST, id ASC`. `card_position = 1` is the main event (from ESPN). Fights without ESPN data have `null` card_position.

---

## Quick Reference — What to Never Do

| Never | Because |
|---|---|
| Join on `bout` across sources | It's often reversed |
| Join on `event_name` across sources | Never matches |
| Use anon key in scrapers | Writes fail silently |
| Share Supabase client across threads | Threading errors |
| Read from `round_fight_stats` in frontend | Use the `fight_dna_metrics` VIEW |
| Write to `leaderboard_eligible` | Generated always column |
| Use `.limit(N)` on incremental dedup checks | Only checks first N records |

For full schema reference: `c:/Users/sabzu/Documents/VS Ufc/ufc-web-app/context/schema.md`
For full scraper reference: `c:/Users/sabzu/Documents/VS Ufc/ufc-web-app/context/scrapers.md`
