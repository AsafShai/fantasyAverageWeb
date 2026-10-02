---
name: plan-feature
description: This skill should be used when the user asks to "plan a feature", "design before coding", "think through" a change, or describes a new feature idea without asking for immediate implementation. Produces a staged implementation plan with file-level changes before any code is written.
---

# Plan Feature

Produce an implementation plan before writing code on non-trivial changes.

## When this applies
- User describes a new feature or non-trivial change
- User asks to "think through" or "plan" something before building
- Change spans backend + frontend, or involves schema / migrations

Do NOT apply if the user explicitly says "just do it" or the change is a one-line fix.

## Steps

1. **Clarify requirements** — ask about data needed, UI shape, edge cases. Don't assume.
2. **Find relevant existing code** — backend routes/services/models and frontend components/pages/hooks. Identify reuse vs new.
3. **Design the change** — backend + frontend + data flow (ESPN → DB → service → UI). Load [references/project-context.md](references/project-context.md) if you need the service map or known gotchas.
4. **Break into ordered tasks** — file-level: "edit X to do Y", "create Z". Flag blockers.
5. **Estimate scope** — Small / Medium / Large. Flag if multiple PRs are needed.
6. **Confirm with user** — show the full plan, ask for approval. Do not start implementing until approved. After approval, the `start-feature` skill handles the git workflow.

## Output shape
```
## Plan: <feature>

### Backend
- [ ] <file>: <change>
...

### Frontend
- [ ] <file>: <change>
...

### Migrations / DB
- [ ] <file>: <change>  (user applies manually)

### Scope: Small | Medium | Large
### Open questions
- <question>

Proceed with implementation?
```
