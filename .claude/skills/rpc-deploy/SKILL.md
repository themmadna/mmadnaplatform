---
name: rpc-deploy
description: Deploys a new or updated Supabase RPC function for the UFC platform. Use when user asks to "add an RPC", "deploy a new function", "create a stored procedure", "push the SQL function", "add a Supabase function", "write a deploy script", "update dataService.js for a new function", or "add a new database function".
---

# RPC Function Deployment

Deploy a new PostgreSQL RPC function to Supabase and wire it into the frontend.

## Environment Requirements

- `SUPABASE_MANAGEMENT_KEY` — Management API key (not the service key or anon key)
- Management API endpoint: `https://api.supabase.com/v1/projects/hyvyzuzlmnekzvtlauwi/database/query`

---

## Step 1 — Write the SQL Function

Create `ufc-web-app/supabase/deploy_<function_name>.py` with the SQL definition.

**Naming convention:** `deploy_<function_name>.py` — matches the RPC function name.

**Standard SQL template:**
```sql
CREATE OR REPLACE FUNCTION function_name(param1 type, param2 type)
RETURNS <return_type>
LANGUAGE plpgsql
SECURITY DEFINER  -- only if needs elevated access; otherwise omit
AS $$
BEGIN
  -- implementation
END;
$$;

GRANT EXECUTE ON FUNCTION function_name(param1 type, param2 type) TO authenticated;
```

**SECURITY DEFINER decision:**
- Use `SECURITY DEFINER` if the function needs to access tables the authenticated role cannot read directly (e.g., admin data, cross-user aggregates)
- Omit it for standard user-scoped queries — prefer least privilege

**GRANT rule:** Always `GRANT EXECUTE TO authenticated`. If the function is public (no auth required), also grant to `anon`.

**Aggregation note:** Pre-aggregate before `json_agg` to avoid PostgreSQL error 42803. Do not use `json_agg` inside a `GROUP BY` directly — use a subquery or CTE.

---

## Step 2 — Deploy via Management API

```python
import requests, os

sql = """
CREATE OR REPLACE FUNCTION ...;
GRANT EXECUTE ON FUNCTION ... TO authenticated;
"""

resp = requests.post(
    "https://api.supabase.com/v1/projects/hyvyzuzlmnekzvtlauwi/database/query",
    headers={
        "Authorization": f"Bearer {os.environ['SUPABASE_MANAGEMENT_KEY']}",
        "Content-Type": "application/json"
    },
    json={"query": sql}
)
print(resp.status_code, resp.json())
```

Run with:
```bash
C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe supabase/deploy_<function_name>.py
```

**Expect:** `200` with `{"results": []}` or `{"results": [{"command": "CREATE FUNCTION"}]}`.

**If 500:** ZIP upload was likely attempted via dashboard — always use the Management API query endpoint for SQL functions, not the Edge Function deploy path.

---

## Step 3 — Add to dataService.js

File: `ufc-web-app/src/dataService.js`

**Standard pattern:**
```javascript
export async function getFunctionName(param1, param2) {
  const { data, error } = await supabase
    .rpc('function_name', { param1, param2 })
  if (error) throw error
  return data
}
```

**Auth-scoped functions:** No extra config needed — `supabase` client uses the user's JWT automatically.

**No caching layer** — component state handles caching. Do not add memoization in dataService.js.

---

## Step 4 — Wire into Component

In the relevant component file under `ufc-web-app/src/` or `ufc-web-app/src/components/`:

```javascript
const [data, setData] = useState(null)
const [loading, setLoading] = useState(false)

useEffect(() => {
  async function load() {
    setLoading(true)
    try {
      const result = await getFunctionName(param1, param2)
      setData(result)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }
  load()
}, [param1, param2])
```

**Architecture constraints:**
- No Redux, no Context API — hooks only
- RPC results cached in component state — no re-fetch unless user navigates away
- Lazy-load expensive RPCs (call on demand, not at page load) — see `getScoringInsights` as reference

---

## Step 5 — Add Navigation Trigger (if new view)

If the RPC powers a new view, add a `currentView` routing entry in `App.js`:

```javascript
// In the view-routing switch/conditional:
{currentView === 'new-view-name' && <NewComponent ... />}

// In nav trigger:
<button onClick={() => setCurrentView('new-view-name')}>...</button>
```

Bottom nav has 4 fixed tabs — new views are typically accessed via in-view links or secondary navigation, not a new tab.

---

## Existing RPC Inventory (9 functions)

| Function | Purpose |
|---|---|
| `get_user_judging_profile()` | Accuracy, tendencies, bias metrics, gender split |
| `get_scoring_insights()` | Fingerprint, pattern breaks, disconnect, consistency, drift |
| `get_judge_directory()` | All judges ≥50 rounds |
| `get_judge_profile(judge_name)` | Individual judge analytics |
| `get_judge_comparison(judge1, judge2)` | Head-to-head |
| `get_user_judge_comparison(judge_name)` | User vs specific judge |
| `get_community_scorecard(fight_id)` | Per-round community average |
| `get_fight_recommendations(user_id, ...7 DNA params)` | DNA-distance recommendations |
| `get_liked_fight_stats()` | Stats for user's liked fights |

Check this list before adding a new function — the capability may already exist.

For full RPC SQL details, read: `c:/Users/sabzu/Documents/VS Ufc/ufc-web-app/context/rpc-functions.md`
