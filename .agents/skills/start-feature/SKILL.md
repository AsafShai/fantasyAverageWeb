---
name: start-feature
description: This skill should be used when the user agrees to start implementing a feature or fix ("yes, start", "let's go", "go ahead", "start implementing"), when a plan-feature session concludes with approval, or when beginning new coding work and we are not on the correct feature branch. Handles fetch dev → pull → branch.
---

# Start Feature — git workflow

## When this applies
- User approved a plan or said "start" / "let's go" / "go ahead"
- Beginning new coding work not on the right branch

Do NOT apply if:
- We're already on the correct feature branch
- User is still in planning / Q&A mode
- User explicitly says to skip git setup

## Steps

1. Fetch latest dev:
   ```bash
   git fetch origin dev
   ```
2. Checkout and pull dev:
   ```bash
   git checkout dev && git pull origin dev
   ```
3. Create feature branch — derive name from the work. Ask for confirmation if not obvious.
   Naming:
   - `feat/<name>` — new feature
   - `fix/<name>` — bug fix
   - `refactor/<name>` — refactor
   - `chore/<name>` — maintenance
   ```bash
   git checkout -b <branch-name>
   ```
4. Confirm current branch is up to date with dev. Begin implementation immediately.
