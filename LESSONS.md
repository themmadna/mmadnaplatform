# Lessons Learned

---

## Project cleanup & git consolidation — 2026-03-01

**Bugs / errors encountered:**
- Two `.git` folders (`VS Ufc/.git` and `ufc-web-app/.git`) both pointed to the same GitHub remote. Pushing from the root repo put commits on `origin/main` that looked like deletions of `src/App.js`, `package.json`, etc. — which were destructive from the `ufc-web-app/` repo's perspective because they shared the same relative paths.
- Pulling into `ufc-web-app/` from that state triggered modify/delete conflicts and a merge that would have wiped the entire frontend. Had to abort and force push from `ufc-web-app/` instead.
- `git pull` in `ufc-web-app/` was silently being rejected by origin because the root repo had already pushed newer commits — this took a fetch + log comparison to diagnose.

**What I'd do differently:**
- Before doing any cleanup or file deletion work, check for multiple `.git` directories in the workspace first (`find . -name ".git" -maxdepth 3`). Identify which is the canonical repo before touching anything.
- When two repos share a remote, always establish which one is the source of truth and delete the other's `.git` before making any commits. Never push from both.
- Always check `git remote -v` in both repos before any push to confirm they're not pointing to the same remote.

---
