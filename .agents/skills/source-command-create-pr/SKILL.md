---
name: "source-command-create-pr"
description: "Migrated source command `create-pr`"
---

# source-command-create-pr

Use this skill when the user asks to run the migrated source command `create-pr`.

## Command Template

# Create PR

Create a pull request for the current feature branch.

## Steps:

1. **Verify pre-PR checks are done**
   - If `/fix-build`, `/review-tests`, `/debug-endpoint` haven't been run yet, ask the user if they want to run them first

2. **Gather PR info**
   ```bash
   git log dev..HEAD --oneline
   git diff dev...HEAD --stat
   ```
   - Summarize what changed across all commits
   - Derive a concise PR title (under 70 chars)

3. **Push branch**
   ```bash
   git push -u origin <current-branch>
   ```

4. **Create the PR**
   ```bash
   gh pr create --base dev --title "<title>" --body "$(cat <<'EOF'
   ## Summary
   - <bullet points of what changed>

   ## Test plan
   - [ ] Build passes
   - [ ] Tests pass
   - [ ] Endpoint tested manually
   - [ ] Mobile view checked (if UI change)

   🤖 Generated with [Codex](https://Codex.com/Codex)
   EOF
   )"
   ```

5. **Return the PR URL**

## Notes:
- Always target `dev` as the base branch, never `master` directly
- Keep the title short and descriptive
- The body should explain *why*, not just *what*
