---
name: new-react-component
description: Scaffolds a new React component for the UFC web app, wired into the existing routing and data layer. Use when user asks to "add a new view", "create a new component", "build a new page", "add a new tab", "wire up a new feature to the frontend", "add a new screen", or "create a [name] component".
---

# New React Component

Scaffold, wire, and integrate a new React component into the UFC web app frontend.

## Architecture Constraints (Read First — Never Deviate)

- **No Redux, no Context API** — React hooks + `dataService.js` singleton only
- **All navigation controlled by a single `currentView` string** in `App.js`
- **No re-fetch on every render** — fetch once into state, re-fetch only on meaningful dependency change
- **Guest mode is real** — every component with user data must handle `user === null` (sessionStorage fallback via `guestStorage.js`)
- **`locked` prop defaults to `false` in FightCard** — must be explicitly passed `locked={true}` where voting should be blocked
- **No new bottom nav tabs** — 4 tabs are fixed; new views are reached via in-view links or secondary navigation

---

## Step 1 — Create the Component File

Location: `ufc-web-app/src/components/<ComponentName>.js`

**Standard shell:**
```jsx
import { useState, useEffect } from 'react'

export default function ComponentName({ user, onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const result = await getFunctionName(/* params */)
        setData(result)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [/* stable deps only */])

  if (loading) return <SkeletonLoader />

  return (
    <div className="...">
      {/* content */}
    </div>
  )
}
```

**Key props to accept:**
- `user` — Supabase user object or `null` (guest)
- `onNavigate` — callback to change `currentView` in App.js (avoid direct state manipulation from child)

---

## Step 2 — Add Data Fetching to dataService.js

File: `ufc-web-app/src/dataService.js`

```javascript
export async function getComponentData(param) {
  const { data, error } = await supabase
    .rpc('rpc_function_name', { param })
  if (error) throw error
  return data
}
```

**Rules:**
- All Supabase calls go through `dataService.js` — never call `supabase` directly from a component
- No caching logic here — component state handles it
- Import the new function at the top of the component file

---

## Step 3 — Import and Wire into App.js

File: `ufc-web-app/src/App.js` (~2500 lines — use search to find the right insertion points)

**3a. Import:**
```javascript
import ComponentName from './components/ComponentName'
```

**3b. Add to view routing** (find the block where other views are rendered):
```javascript
{currentView === 'component-name' && (
  <ComponentName
    user={user}
    onNavigate={setCurrentView}
  />
)}
```

**3c. Add navigation trigger** where appropriate (in-view button, link, or secondary nav item):
```javascript
<button onClick={() => setCurrentView('component-name')}>
  View Component
</button>
```

---

## Step 4 — Apply Pulse Design System

All components must use the Pulse theme tokens from `tailwind.config.js`. Do not use arbitrary colors.

**Key patterns:**

**Click-outside (dropdowns/menus):**
```jsx
const containerRef = useRef(null)
// Wrap BOTH the toggle button AND the dropdown in the same ref'd div
<div ref={containerRef}>
  <button onClick={toggleOpen}>...</button>
  {open && <div className="...">...</div>}
</div>
```

**Skeleton loading:** Match shape of real content — use `animate-pulse` with Pulse theme background tokens.

**Touch targets:** Minimum 44px height/width for all interactive elements (mobile-first).

**Staggered animations:** Use `transition-all duration-200` and CSS delay utilities for card lists.

---

## Guest Mode Pattern

```javascript
// Check auth state
const isGuest = !user

// For reads: guest data lives in sessionStorage via guestStorage.js
import { getGuestVotes } from '../guestStorage'

// Gate write actions:
if (isGuest) {
  // Show login prompt or use sessionStorage fallback
  return
}
```

Guest users can browse and score fights — their data lives in `sessionStorage`. Never silently fail for guests.

---

## Common Mistakes to Avoid

| Mistake | Correct Approach |
|---|---|
| Calling `supabase` directly from component | Always go through `dataService.js` |
| Using `currentView` as a prop on child components | Pass `onNavigate` callback instead |
| Adding a 5th bottom nav tab | Use in-view link or secondary nav |
| Not handling `user === null` | Always check for guest state |
| Fetching on every render | Fetch in `useEffect` with stable dependency array |
| Forgetting `locked` prop on FightCard | Must be explicitly passed where voting is blocked |
| Using Context API for shared state | Use prop drilling or lift state to App.js |

---

## Reference Components (Use as Templates)

| Component | Good Template For |
|---|---|
| `JudgeProfileView.js` (290 lines) | Single-entity detail view with tabs |
| `JudgingDNACard.js` (542 lines) | Collapsible card with tier-gated content |
| `ScorecardComparison.js` (375 lines) | Side-by-side comparison layout |
| `JudgeDirectory.js` (175 lines) | Sortable list/table view |

For full frontend architecture details, read: `c:/Users/sabzu/Documents/VS Ufc/ufc-web-app/context/phase6-architecture.md`
