---
name: fix-build
description: This skill should be used when the frontend build fails, the user says "fix the build" / "fix type errors" / "fix lint", TypeScript or ESLint errors appear in tool output, or after a refactor to verify the build still passes.
---

# Fix Build

Drive the frontend build to green.

## When this applies
- `npm run build` exits non-zero
- User asks to fix type errors or lint warnings
- Build errors surface after a refactor

## Steps

1. Run the build and capture output:
   ```bash
   cd frontend && npm run build 2>&1
   ```
2. Categorize errors: TypeScript type errors → ESLint warnings (treated as errors here) → missing modules → other.
3. Fix in severity order:
   - Unused imports: remove
   - Unused variables: remove, or prefix with `_` only if intentional
   - Type errors: fix the types, don't use `any` unless unavoidable
   - Never use `// @ts-ignore` or `eslint-disable` without a comment explaining why
4. Re-run the build. Confirm clean.

## Rules
- Fix root cause, not symptoms
- JSX usage counts as usage — if ESLint disagrees, check the rule config
- Backend has no fix-build equivalent today (no linter wired up)
