# Dependencies Audit — UFC Web App
**Date:** 2026-04-14
**Auditor:** Dependencies Agent (Round 1-E, conducted by orchestrator)
**Project root:** `c:\Users\sabzu\Documents\VS Ufc\ufc-web-app`

> **Note:** Version currency and abandonment assessments are approximations based on known release history as of the knowledge cutoff (August 2025). Human verification against current npm registry recommended for flagged packages.

---

## JavaScript Dependencies (`package.json`)

### Production `dependencies`

| Package | Pinned Version | Status | Notes |
|---------|---------------|--------|-------|
| `@supabase/auth-ui-react` | ^0.4.7 | FLAG-FOR-REVIEW | Auth UI package — verify it's still maintained alongside supabase-js v2 |
| `@supabase/auth-ui-shared` | ^0.1.8 | FLAG-FOR-REVIEW | Companion to above |
| `@supabase/supabase-js` | ^2.89.0 | Current-looking | v2 is the current major; 2.89 looks recent |
| `@tailwindcss/postcss` | ^4.1.18 | **MISPLACED** | Build tool — should be in `devDependencies` |
| `@testing-library/dom` | ^10.4.1 | **MISPLACED** | Test library — should be in `devDependencies` |
| `@testing-library/jest-dom` | ^6.9.1 | **MISPLACED** | Test library — should be in `devDependencies` |
| `@testing-library/react` | ^16.3.1 | **MISPLACED** | Test library — should be in `devDependencies` |
| `@testing-library/user-event` | ^13.5.0 | **MISPLACED** | Test library — should be in `devDependencies` |
| `lucide-react` | ^0.562.0 | Current-looking | Actively maintained icon library |
| `react` | ^18.2.0 | Current-looking | React 18; React 19 exists but 18 is widely supported |
| `react-dom` | ^18.2.0 | Current-looking | Matches react version |
| `react-scripts` | 5.0.1 | **HIGH RISK** | CRA (Create React App) is de facto abandoned — Meta stopped maintaining it in 2023. Last release was 5.0.1 in April 2022. No security patches since. |
| `recharts` | ^3.7.0 | Current-looking | Actively maintained |
| `web-vitals` | ^2.1.4 | OUTDATED | v3 released; v2 still functional but not receiving updates |

### Development `devDependencies`

| Package | Pinned Version | Status | Notes |
|---------|---------------|--------|-------|
| `autoprefixer` | ^10.4.16 | Current-looking | PostCSS plugin, actively maintained |
| `postcss` | ^8.4.31 | Current-looking | Standard PostCSS |
| `tailwindcss` | ^3.4.1 | Current-looking | Tailwind v3; v4 exists but v3 is still supported |

---

## Findings

### HIGH

**H1: `react-scripts` 5.0.1 — CRA is de facto abandoned**
- Create React App received its last release in April 2022. The underlying webpack config, babel transforms, and security dependencies have not been patched since.
- The React team no longer recommends CRA for new projects; the official React docs redirect to Next.js, Remix, or Vite.
- Known security exposure: `react-scripts` depends on dozens of transitive dependencies (webpack, babel, etc.) that have received CVEs since 2022. These will not be patched upstream.
- **Impact:** Not an immediate RCE risk for a frontend-only app deployed to Vercel (the build runs in a controlled environment), but the ecosystem support is gone. Migration to Vite or Next.js is the recommended path.
- **Severity: HIGH** — long-term maintainability risk; near-term security exposure in build dependencies.

### MEDIUM

**M1: 4 `@testing-library/*` packages in `dependencies` instead of `devDependencies`**
- `@testing-library/dom`, `@testing-library/jest-dom`, `@testing-library/react`, `@testing-library/user-event` are all test utilities that should never be in the production bundle.
- In CRA, `react-scripts build` is smart enough to not include test utilities in the production bundle — so there is no actual runtime impact. However, this is a hygiene issue and inflates `npm install` in production contexts.
- **Severity: MEDIUM** — no runtime impact with CRA, but incorrect and misleading.

**M2: `@tailwindcss/postcss` ^4.1.18 in `dependencies` instead of `devDependencies`**
- PostCSS is a build-time tool. It has no runtime presence. Moving to `devDependencies` is correct.
- **Severity: MEDIUM** — hygiene, no runtime impact.

**M3: No `requirements.txt` or equivalent for Python dependencies**
- The project has 3+ Python scraper files and 10+ Supabase deploy scripts. The Python dependencies (at minimum: `requests`, `beautifulsoup4`, `python-dotenv`, `supabase`, `python-dateutil`) are completely undocumented.
- Any developer setting up a new machine cannot reproduce the Python environment without trial and error.
- `scoring_model/train_scoring_model.py` depends on `scikit-learn` — also undocumented.
- **Severity: MEDIUM** — reproducibility risk; onboarding friction.

**M4: `@supabase/auth-ui-react` and `@supabase/auth-ui-shared` — maintenance status unclear**
- These packages were developed by Supabase to provide drop-in auth UI components. Their maintenance cadence is less predictable than the core `supabase-js` package.
- If Supabase deprecates these packages (they have shown willingness to rebuild auth flows), the `Login.js` component may require a rewrite.
- **Severity: MEDIUM** — flag for human verification.

### LOW

**L1: `web-vitals` ^2.1.4 is outdated (v3 released)**
- Minor — v2 still functional. No impact on production behavior, only measurement accuracy for Core Web Vitals reporting (which appears unused given no analytics integration).
- **Severity: LOW**

**L2: Tailwind CSS v3 (not v4)**
- Tailwind v4 introduced significant config format changes. v3 is still fully supported. Not a risk; just worth noting for future upgrade planning.
- **Severity: LOW**

---

## Python Environment (No requirements.txt)

Inferred dependencies based on import statements in scraper files:
- `requests` (HTTP)
- `beautifulsoup4` / `bs4` (HTML parsing)
- `python-dotenv` / `dotenv` (env loading)
- `supabase` / `supabase-py` (DB client)
- `python-dateutil` (date parsing)
- `scikit-learn` (ML training)
- `pandas` (likely, for ML dataset)
- Standard library: `threading`, `os`, `sys`, `json`, `re`, `time`, `argparse`

None of these are pinned. A `pip install` without a requirements file will install the latest version of each, which could break on a major version bump in any dependency.

---

## Dependency Count Assessment

**JavaScript:** 14 production dependencies, 3 dev dependencies. Lean for a project of this feature set — no unnecessary dependencies detected.

**Python:** ~7 core dependencies, 0 pinned. Lean count but zero reproducibility.

---

## License Assessment

- React, Tailwind, Recharts, Lucide: MIT — no concerns.
- Supabase JS: Apache 2.0 — no concerns for a commercial project.
- `@testing-library/*`: MIT — no concerns.
- scikit-learn: BSD-3-Clause — no concerns.
- No GPL-licensed packages detected.

---

## Summary

| Category | Flagged | Key Risk |
|----------|---------|----------|
| Abandoned / high-risk | 1 | `react-scripts` 5.0.1 (CRA abandoned) |
| Misplaced dependencies | 5 | 4 test libs + 1 build tool in wrong section |
| Undocumented Python deps | ~7 | No requirements.txt |
| Outdated (minor) | 2 | `web-vitals` v2, Tailwind v3 |
| Total flagged | **15** | |

**Overall Dependency Health: C**

The JavaScript runtime dependencies are lean and current. The grade is brought down by the `react-scripts` / CRA situation (a known, ticking clock for any CRA project), the misplaced test/build tools in `dependencies`, and the complete absence of a Python dependency manifest. None of these are acute emergencies, but the CRA migration should be on the roadmap.
