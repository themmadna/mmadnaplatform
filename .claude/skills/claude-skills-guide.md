# Claude Skills — Agent Briefing Document

> **For the AI agent reading this:** This file is a briefing document, not a passive summary. When you load this file, your job is to:
> 1. Read and internalize the concepts below
> 2. Explore the project directory you're currently working in
> 3. Produce a concrete integration plan: which Skills patterns apply, what would need to be built, and in what order
>
> Do not wait to be asked. Treat this as standing instructions.

---

## What This Source Is About

This is Anthropic's official guide to building **Skills for Claude** — a system for packaging reusable AI workflows as portable folder-based instruction sets. A Skill teaches Claude how to handle a specific task or domain consistently, without the user having to re-explain context every time.

Skills are the **knowledge layer** on top of raw tool access (MCP). If MCP gives Claude a professional kitchen, Skills provide the recipes.

---

## Core Concepts to Internalize

### What a Skill Is
A Skill is a folder containing:
- `SKILL.md` (required) — YAML frontmatter + Markdown instructions
- `scripts/` (optional) — Python, Bash, or other executable code
- `references/` (optional) — supplementary docs loaded on demand
- `assets/` (optional) — templates, fonts, icons

### Progressive Disclosure (How Claude Loads Skills)
Skills operate on three levels:
1. **YAML frontmatter** — always in Claude's context; tells Claude *when* to load the skill
2. **SKILL.md body** — loaded when the skill is relevant; contains full instructions
3. **Linked files** — additional docs/scripts loaded only when needed

This keeps token usage low while preserving specialized depth.

### The YAML Frontmatter (Most Important Part)
```yaml
---
name: your-skill-name          # kebab-case, no spaces, no capitals
description: What it does. Use when user asks to [specific phrases]. # MUST include WHAT + WHEN
license: MIT                   # optional
metadata:                      # optional
  author: Name
  version: 1.0.0
  mcp-server: server-name
---
```

**Rules:**
- Name must be exact: `SKILL.md` (case-sensitive)
- No `README.md` inside the skill folder
- No XML angle brackets (`< >`) anywhere in frontmatter
- Description must be under 1024 characters and include trigger phrases

---

## The Five Skill Patterns (High-Value Reference)

| Pattern | Use When | Key Technique |
|---|---|---|
| **1. Sequential Workflow** | Multi-step processes in a specific order | Explicit step ordering, validation gates, rollback instructions |
| **2. Multi-MCP Coordination** | Workflows span multiple services (Figma → Drive → Linear → Slack) | Phase separation, data passing between MCPs, centralized error handling |
| **3. Iterative Refinement** | Output quality improves with iteration | Quality check scripts, refinement loops, explicit stop criteria |
| **4. Context-Aware Tool Selection** | Same outcome, different tools depending on context | Decision trees, fallback options, transparency about choices |
| **5. Domain-Specific Intelligence** | Skill adds specialized knowledge beyond tool access | Embed compliance logic, audit trails, governance rules |

---

## Three Skill Use Case Categories

### Category 1: Document & Asset Creation
Creating consistent, high-quality outputs (docs, presentations, apps, designs, code).
- Uses Claude's built-in capabilities — no MCP required
- Embeds style guides, templates, quality checklists

### Category 2: Workflow Automation
Multi-step processes that benefit from consistent methodology.
- Step-by-step workflow with validation gates
- Iterative refinement loops
- Can coordinate across multiple MCP servers

### Category 3: MCP Enhancement
Workflow guidance layered on top of an existing MCP integration.
- Sequences MCP calls correctly
- Embeds domain expertise users would otherwise have to specify
- Handles errors and edge cases

---

## What Makes a Good vs. Bad Skill Description

**Good:**
```
Analyzes Figma design files and generates developer handoff documentation. 
Use when user uploads .fig files, asks for "design specs", "component documentation", 
or "design-to-code handoff".
```

**Bad:**
```
Helps with projects.
```

The description is the trigger mechanism. It must answer: what does this do, and what would a user *say* to invoke it?

---

## Testing Framework

### Three Test Types
1. **Triggering tests** — Does the skill load on relevant queries? Does it stay quiet on irrelevant ones?
2. **Functional tests** — Does it produce correct outputs? Do API calls succeed? Are edge cases handled?
3. **Performance comparison** — Measure token usage, back-and-forth messages, and failed calls with vs. without the skill

### Common Failure Modes & Fixes

| Symptom | Cause | Fix |
|---|---|---|
| Skill never loads | Description too vague | Add specific trigger phrases |
| Skill loads constantly | Description too broad | Add negative triggers, narrow scope |
| Instructions ignored | Too verbose, buried, or ambiguous | Move detail to `references/`, put critical rules at top, use code scripts for deterministic checks |
| Slow/degraded responses | Skill too large, too many skills enabled | Keep SKILL.md under 5,000 words, use `references/` for detail |

---

## Distribution Model (as of January 2026)

- Individual: Upload zipped skill folder via `Claude.ai > Settings > Capabilities > Skills`
- Claude Code: Place in skills directory
- Organization-level: Admins can deploy workspace-wide with auto-updates
- API: Use `/v1/skills` endpoint + `container.skills` parameter in Messages API requests (requires Code Execution Tool beta)
- Open standard: Skills are designed to be portable across AI platforms

---

## Agent Instructions — How to Apply This to the Current Project

When you read this file in the context of a project, execute the following reasoning process:

### Step 1: Audit the Project Directory
Look for:
- Existing workflow patterns that are repeated or manually re-explained
- Scripts, tools, or integrations (especially MCP connections) that lack consistent usage guidance
- Document/asset generation tasks (code, reports, dashboards, emails, presentations)
- Multi-step processes that currently require user direction at each step
- Domain-specific logic (compliance rules, brand standards, data validation) that could be embedded

### Step 2: Map to Skill Patterns
For each workflow or capability you find, determine:
- Which of the 5 patterns (Sequential, Multi-MCP, Iterative, Context-Aware, Domain Intelligence) best fits
- Which category it falls into (Document Creation, Workflow Automation, MCP Enhancement)
- Whether it's standalone or requires MCP coordination

### Step 3: Produce an Integration Plan
Output a prioritized list of Skills to build, each with:
- **Skill name** (kebab-case)
- **Category** (1, 2, or 3)
- **Pattern** (1–5)
- **Trigger description** (draft the YAML description field)
- **What it replaces** (what the user currently has to manually explain or do)
- **Dependencies** (scripts, MCP servers, reference docs needed)
- **Build priority** (High / Medium / Low based on frequency of use and complexity reduction)

### Step 4: Recommend a Build Order
Suggest starting with the single most impactful skill — the one that reduces the most repeated friction — and iterate from there before expanding.

---

## Quick Validation Checklist (Use Before Finalizing Any Skill You Build)

- [ ] Folder named in kebab-case
- [ ] `SKILL.md` exists with exact spelling
- [ ] YAML frontmatter has `---` delimiters
- [ ] `name` is kebab-case, no spaces, no capitals
- [ ] `description` includes WHAT the skill does AND WHEN to use it (with trigger phrases)
- [ ] No XML `< >` tags anywhere
- [ ] Instructions are clear, actionable, and concise
- [ ] Error handling is included
- [ ] Examples are provided
- [ ] `SKILL.md` is under 5,000 words (detailed docs moved to `references/`)
- [ ] Tested: triggers on relevant queries, stays quiet on irrelevant ones

---

## Source
Anthropic — *The Complete Guide to Building Skills for Claude* (2026)
