# Operational — 2026-05-16

---

## §1 pg_cron

**Active jobs:**
```
jobid  schedule    name              active  command
1      * * * * *   poll-live-fights  true    SELECT net.http_post(url := 'https://hyvyzuzlmnekzvtlauwi.supabase.co/functions/v1/poll-live-fights', ...)
```

One job. Every minute, calls the `poll-live-fights` Edge Function.

**Run history (62 days retained):**
```
Total runs:        89,902
Succeeded:         89,902      (100%)
Failed:                 0
Oldest:            2026-03-15 01:18 UTC
Newest:            2026-05-16 11:39 UTC
```

✅ Healthy. The Edge Function's internal guards (no fight in `fight_started_at IS NULL` window → early return) keep this cheap. No backlog, no timeouts.

---

## §2 pg_net

**Settings:**
```
pg_net.batch_size       200
pg_net.database_name    postgres
pg_net.ttl              6 hours
pg_net.username         (empty)
```

**HTTP response history (last 6h retained per TTL):**
```
status_code  n    last
200          360  2026-05-16 11:39 UTC
```

Only 200s. No 4xx/5xx. 360 responses in ~6h = ~60/hour = 1/minute (matches the cron cadence × 1 successful invocation). ✅

---

## §3 Triggers

**Live triggers (excluding internal):**
```
table       trigger_name           function              enabled
user_votes  sync_fight_ratings     update_fight_ratings  origin
```

**Definition:**
```sql
CREATE TRIGGER sync_fight_ratings
AFTER INSERT OR DELETE OR UPDATE ON public.user_votes
FOR EACH ROW EXECUTE FUNCTION update_fight_ratings()
```

Matches `supabase/deploy_triggers.py` ✓. No drift.

---

## §4 Edge Functions

Two functions deployed in `supabase/functions/`:

### `poll-live-fights`
- Invoked by pg_cron every minute (see §1).
- 3-guard pattern (live event window, ESPN polling, DB writes).
- No incidents in the cron history.

### `record-fight-status`
- April P0 — JWT validation added. Still in place per `supabase/functions/record-fight-status/index.ts`.
- Not directly observable via pg_net (called by browser, not pg_cron).
- April P2 #13 — concurrent-call race not in scope for this audit (low probability at scale of 1 active user).

---

## §5 Extensions

```
extension          version  schema
pg_cron            1.6.4    pg_catalog
pg_net             0.19.5   public
pg_stat_statements 1.11     extensions
pgcrypto           1.3      extensions
plpgsql            1.0      pg_catalog
supabase_vault     0.3.1    vault
uuid-ossp          1.1      extensions
```

All standard Supabase set. **`pg_net` in `public` schema** is the default install pattern and is fine — `net.http_post()` is the only callable. No drift from baseline.

---

## §6 Storage buckets

```
SELECT id, name, public FROM storage.buckets;
-- 0 rows
```

No buckets. Nothing to expose. ✅

---

## §7 Cron retention (informational)

The `cron.job_run_details` table retains 89,902 rows since 2026-03-15 (~62 days, ~1,450 rows/day). At 1 job × 1440 invocations/day, that's ~62 days of full history. If you ever add more cron jobs, retention will shorten proportionally — Supabase's defaults keep ~14 days at higher invocation counts. Worth setting an explicit retention policy if you grow this.

---

## §8 Health check summary

| Area | Status |
|---|---|
| pg_cron job runs | ✅ 100% success over 62 days |
| pg_net HTTP responses | ✅ 100% 200 over retention window |
| Triggers active | ✅ |
| Edge Functions deployed | ✅ |
| Extensions up to date | ✅ |
| Storage exposure | ✅ none |
| Backup tables in active use | ❌ stale — see 01-security §1 |
