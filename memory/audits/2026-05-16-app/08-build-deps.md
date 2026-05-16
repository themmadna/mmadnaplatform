# 08 — Build & Dependency Hygiene

## §1. `npm run build`

```
> ufc-web-app@0.1.0 build
> react-scripts build

(node:1616) [DEP0176] DeprecationWarning: fs.F_OK is deprecated, use fs.constants.F_OK instead
Compiled successfully.

File sizes after gzip:
  255.25 kB  build/static/js/main.fa3d7b0c.js
  7.83 kB   build/static/css/main.c1abc22b.css
  1.76 kB   build/static/js/453.f9be4342.chunk.js
```

**Verdict:** Compiled successfully. Zero ESLint warnings. Zero React-hooks/exhaustive-deps warnings surfaced in the build (despite the explicit `eslint-disable` lines suppressing some — see `04-performance.md §P4.1`). One deprecation warning from Node's `fs.F_OK`, originating from `react-scripts`'s internals — not actionable from app code.

## §2. `npm audit`

Summary line:
> **40 vulnerabilities (10 low, 7 moderate, 23 high)**

All vulnerabilities are in CRA transitive deps (svgo, webpack-dev-server, ajv, brace-expansion, underscore, yaml, `@babel/plugin-transform-modules-systemjs`, etc.). `npm audit fix --force` would install `react-scripts@0.0.0` (a breaking change marker — react-scripts is effectively deprecated).

### B2.1 — Inherited CRA vulnerabilities (P2, low actual exposure)

Nearly all of the 23 "high" vulnerabilities are dev-tooling vulnerabilities (webpack-dev-server, postcss-load-config, etc.) that don't ship to production. Real production-bundled vulnerabilities are limited to:

- `underscore <= 1.13.7` — DoS via unlimited recursion. **Underscore is not directly used** by the app; pulled in transitively. `npm audit fix` (non-force) reportedly resolves this.
- `@babel/plugin-transform-modules-systemjs` — code-injection risk at build time. Dev-only.

**Recommendation:** run `npm audit fix` (without `--force`) and re-run `npm run build` + `npm test` to confirm nothing breaks. Defer the breaking `react-scripts` migration — it's a deeper question (migrate to Vite vs eject vs upgrade).

## §3. `package.json` vs actual imports

Manually checked dependencies block. All deps listed are imported somewhere except:

### B3.1 — `web-vitals` is shipped but inert (P2 — also `04-performance.md §P2.1`)

`index.js:18` calls `reportWebVitals()` with no callback. Library ships in bundle, runs, discards results. Either wire to an endpoint or remove.

### B3.2 — `@testing-library/dom` listed in devDeps even though never directly imported (P2)

`@testing-library/react` depends on `@testing-library/dom`, so explicit listing is unnecessary. Harmless; would clean up `package.json`.

### B3.3 — `autoprefixer` / `postcss` / `tailwindcss` correctly in devDeps (✅)

April audit #15 moved these correctly. Verified.

## §4. Outdated major versions

```
@supabase/supabase-js  ^2.89.0     — current latest is 2.x. ✅
react                  ^18.2.0     — react 19 available. Not migrated.
recharts               ^3.7.0      — current. ✅
lucide-react           ^0.562.0    — current. ✅
react-scripts          5.0.1       — deprecated upstream (CRA EOL). Migration needed eventually.
```

### B4.1 — `react-scripts` is the long-term concern (P2)

CRA is no longer maintained. Future React/webpack upgrades will require migrating to Vite (recommended), Next.js, or ejecting. Not urgent — the app works fine on react-scripts 5.0.1. Plan a migration before React 20 or before a security finding forces it.

### B4.2 — React 18 → 19 migration (P2)

React 19 is stable. Not blocking. Migration mostly comes free except for `ReactDOM.render` → `createRoot` (already done in `index.js:8`). Worth checking concurrent-features regressions before upgrading.

## §5. Build warnings

The build output shows zero ESLint warnings. CRA's strict mode + `react-app` ESLint config covers:
- `react-hooks/exhaustive-deps`
- `import/no-anonymous-default-export`
- `jsx-a11y/*`

The suppressed exhaustive-deps lines are intentional (per inline comments) — see `04-performance.md §P4.1`.

## §6. `.gitignore` correctness

```
.env
node_modules/
__pycache__/
*.pyc
.DS_Store
.claude/settings.local.json
memory/.last-session-id
build/
nul
*.log
*.csv
scoring_model/ml_dataset.csv
```

- ✅ `.env` covered
- ✅ `build/` covered (post-April fix)
- ✅ `.claude/settings.local.json` covered
- ⚠ Backup `src/App.js copys/` and `src/dataService.JS copys/` are NOT ignored and are tracked (committed). See `03-components.md §C1.1`.

### B6.1 — Recommend gitignoring or relocating `src/*copys/` (P1)

Either delete them, or move outside `src/` and add to `.gitignore`. Currently 220 KB of stale code is tracked and ships to clones.

## §7. Vercel build hygiene

- ✅ Per LESSONS Deployment, `vercel.json` was added to prevent Vercel from trying to install `requirements.txt`. Verify still present.
