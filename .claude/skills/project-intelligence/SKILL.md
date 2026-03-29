---
name: project-intelligence
description: Initializes and maintains the Project Intelligence System — a two-brain memory architecture that gives Claude persistent context across a project's lifespan. Use when the user asks to set up project memory, initialize a new project, onboard Claude to an existing codebase, run a session start or session end, update project files, or reconcile existing Skills against the framework. Trigger phrases include: "set up project memory", "initialize project", "read my project context", "session start", "session end", "update progress", "reconcile skills", "audit skills".
metadata:
  author: Bastian
  version: 0.1.0
---

# Project Intelligence System

This skill initializes and maintains a standardized memory architecture that gives Claude persistent project context across sessions. It also governs how existing Skills are audited and integrated when the skills framework is introduced to a project.

## Core Architecture

```
/project-root
  CLAUDE.md                     ← Lightweight router. Read every session.
  /memory
    PROJECT.md                  ← What, why, who, stack, integrations, goals
    DECISIONS.md                ← Key decisions and reasoning, with dates
    LESSONS.md                  ← What failed, what was tried, what not to repeat
    OPEN-QUESTIONS.md           ← Unresolved questions, unknowns, deferred choices
    PROGRESS.md                 ← Current state, what shipped, what's next
  /context                      ← Optional. Canonical technical reference docs (see below)
  .claude/
    skills/
      claude-skills-guide.md    ← Skills framework briefing
      SKILL.md                  ← Project-specific skill(s)
```

### The `.claude/skills/` Convention

Skills live in `.claude/skills/` — Claude Code's designated namespace — not in a visible `/skills/` folder. This keeps tooling separate from project files.

**Three types of Skills, three locations:**

| Type | Description | Location |
|---|---|---|
| Project-specific | Knows your schema, API, content rules — built for this project | `.claude/skills/` in project repo |
| General reusable | Works across any project without modification | Global skills directory only |
| Customized general | A general skill tuned for this project | `.claude/skills/` with a note on what was changed and why |

Only project-specific and customized-general Skills belong in `.claude/skills/`. If a Skill works identically on every project, it doesn't belong in the project at all.

### The `context/` Directory (Optional)

Large projects benefit from a dedicated `/context/` directory of canonical technical reference docs — schema, API specs, architecture notes, integration details. These are not memory files (they don't change session to session) and not Skills (they don't instruct Claude how to behave). They're deep reference material loaded on demand.

**When to add a `context/` directory:**
- The project has a non-trivial database schema or API surface
- Multiple integrations with external services
- Domain-specific logic that can't be inferred from the codebase alone

**`context/` files are Tier 3** — loaded on demand, never at session start. Reference them in CLAUDE.md so the agent knows they exist.

## Tier System

Files load on a tiered basis to keep context lean.

**Tier 1 — Read every session (200–400 words max)**
- CLAUDE.md
- PROGRESS.md

**Tier 2 — Read when relevant**
- PROJECT.md (starting a new feature)
- OPEN-QUESTIONS.md (starting a new feature or when something is unclear)

**Tier 3 — Read on demand only**
- DECISIONS.md (before any architectural decision)
- LESSONS.md (when hitting blockers or errors)
- Global brain files (only when explicitly needed)

## Session Contract

These prompts are baked into CLAUDE.md for every project.

**Session start:**
Before we begin, read PROGRESS.md to orient yourself on current state.
Summarize where we left off and confirm you're ready to proceed.

**First session only (cold start):**
If PROGRESS.md is empty or this is the first session, read PROJECT.md
instead to orient yourself. Ask Bastian to confirm current state before proceeding.

**If PROGRESS.md looks stale or incomplete:**
Do not proceed from potentially bad information. Read PROJECT.md, flag the
discrepancy to Bastian, and confirm current state before starting work.

**Session end:**
1. Update PROGRESS.md to reflect what we accomplished this session.
   Add a Last updated: [date] line at the top.
2. Flag anything in /memory that needs updating — list for Bastian's review,
   do not write unilaterally.
3. Flag anything worth adding to ~/bastian-global-brain/ LESSONS.md, PLAYBOOK.md,
   or OPERATING.md — but only if it would apply to a project you've never worked
   on before. Project-specific insights belong in /memory/LESSONS.md, not the
   global brain.
4. Wait for Bastian's approval, then stage, commit, and push to GitHub.

## CLAUDE.md Router Template

```markdown
## Memory System
- Always read: PROGRESS.md before starting work
- Read when starting a new feature: PROJECT.md
- Read before any architectural decision: DECISIONS.md
- Read when hitting errors or blockers: LESSONS.md
- Read when something is unclear: OPEN-QUESTIONS.md
- Global brain location: ~/bastian-global-brain/
```

## File Size Discipline

Files stay current, not cumulative.
- PROGRESS.md reflects now, not history
- DECISIONS.md gets pruned of entries no longer relevant to active work
- LESSONS.md is additive but should be reviewed quarterly for staleness
- No file in Tier 1 or 2 should exceed 500 words

---

## Skill Reconciliation

**Trigger:** Run this procedure whenever `claude-skills-guide.md` is introduced to a project that already has a `.claude/skills/` directory containing existing Skills.

**Principle:** The skills guide is a lens, not a bulldozer. Existing Skills are treated as production assets. The agent surfaces gaps and proposes changes — it never overwrites anything without explicit approval.

### Step 1: Inventory

List all existing Skills by scanning the `.claude/skills/` directory. For each Skill found, read the YAML frontmatter only — do not load the full body yet.

Produce a table:

| Skill Name | File Path | Has Frontmatter | Has Description | Notes |
|---|---|---|---|---|

Flag any Skill that is missing its `SKILL.md`, lacks YAML frontmatter, or has no description field.

### Step 2: Validate

For each Skill, check the following against the framework. Note pass/fail for each:

- [ ] Folder name is kebab-case, no spaces, no capitals
- [ ] File is named exactly `SKILL.md` (case-sensitive)
- [ ] YAML frontmatter present with `---` delimiters
- [ ] `name` field is kebab-case
- [ ] `description` field includes WHAT the skill does AND WHEN to use it (with specific trigger phrases)
- [ ] `description` is under 1024 characters
- [ ] No XML angle brackets (`< >`) anywhere in frontmatter
- [ ] `SKILL.md` body appears to be under 5,000 words

**When to read a Skill's full body:**

First, check the aggregate size of all files in `.claude/skills/`:
- **Under 50KB total:** Read all bodies. Overhead is negligible; higher confidence is worth it.
- **Over 50KB total:** Read bodies lazily — only when one of these conditions is met:
  - The Skill has any structural validation failure
  - The description is too vague to classify the Skill from frontmatter alone
  - File size exceeds 25KB (conservative proxy for the 5,000-word ceiling)

If none of these conditions apply, the Skill passes the body check by default.

### Step 3: Classify

For each valid Skill, classify it using the framework vocabulary:

**Pattern** (pick one):
1. Sequential Workflow
2. Multi-MCP Coordination
3. Iterative Refinement
4. Context-Aware Tool Selection
5. Domain-Specific Intelligence

**Category** (pick one):
1. Document & Asset Creation
2. Workflow Automation
3. MCP Enhancement

Add these classifications to the inventory table.

### Step 4: Produce a Delta Report

Output a structured report with three sections:

**Section A — Existing Skills (with status)**
List every Skill found, its classification, and any validation failures. For each failure, provide a specific, actionable fix proposal. Example:

> `blog-post-writer` — Category 1, Pattern 3
> ❌ Description too vague ("Helps write blog posts"). Proposed fix: "Generates structured blog posts in Bastian's voice. Use when asked to write, draft, or outline a blog post, article, or newsletter."
> ✅ All other checks pass.

**Section B — Integration Plan Gaps**
Based on the project context (from PROJECT.md if available), list Skills that the integration plan would recommend that do not yet exist. Format each as:

- **Skill name** (kebab-case)
- **Category / Pattern**
- **Draft trigger description**
- **What it replaces** (what the user currently re-explains manually)
- **Build priority**: High / Medium / Low

Priority is an inference made at planning time from reading the project — not a tracked metric. Score using two factors:
- **Frequency**: How often would this Skill plausibly be invoked in a typical work week on this project?
- **Friction reduction**: How much re-explanation or manual steering does it replace per use?

High = frequent AND high friction. Medium = either frequent OR high friction but not both. Low = occasional use, modest friction reduction. Do not create any logging or tracking mechanism — this is a judgment call, not a measurement.

**Section C — Recommended Actions (in order)**
A short, prioritized list of what to do next:
1. Fix validation failures on existing Skills (quick wins, low risk)
2. Build highest-priority missing Skills
3. Retire or merge any Skills that overlap significantly

### Step 5: Wait for Approval

Do not create, modify, rename, or delete any files based on this report. Present the delta report and explicitly state:

> "No changes have been made. Please review and tell me which actions to proceed with."

Only act after receiving explicit per-action approval.

---

## New Project Initialization

When setting up the Project Intelligence System on a new project:

### For an existing codebase:

1. Analyze the project directory thoroughly
2. Draft all memory files (see output instructions below)
3. After approval, write final versions to disk
4. Run Skill Reconciliation if a `.claude/skills/` directory exists

### For a new project:

1. Accept PROJECT.md as a vision doc from the user
2. Draft skeleton memory files and CLAUDE.md (see output instructions below)
3. After approval, write final versions to disk
4. Produce a Skills integration plan based on the vision doc

### Output instructions

All generated files are output inline in chat for review before anything is written to disk — except PROJECT.md, which is written to `/memory/drafts/PROJECT.md` first so it can be reviewed and edited in the user's editor before being moved to its final location. All other memory files (DECISIONS.md, LESSONS.md, OPEN-QUESTIONS.md, PROGRESS.md, CLAUDE.md) are short enough to review inline.

Never write files to their final destinations without explicit approval.

---

## Error Handling

**Skill directory not found:** Note in the delta report that no `.claude/skills/` directory exists. Recommend creating one and propose an initial Skill based on the most repeated workflow in the project.

**PROJECT.md not found during Skill Reconciliation:** Proceed with inventory and validation only. Note in Section B that gap analysis cannot be completed without PROJECT.md and prompt the user to either provide one or run initialization first.

**Malformed SKILL.md (cannot parse frontmatter):** Flag the file in the inventory as unreadable. Do not attempt to fix it automatically — surface it to the user with the raw content and ask how to proceed.

**Conflicting Skills (significant overlap between two existing Skills):** Flag both in Section C with a merge recommendation. Describe what the merged Skill would cover and ask the user to decide.
