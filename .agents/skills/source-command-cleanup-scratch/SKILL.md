---
name: "source-command-cleanup-scratch"
description: "Migrated source command `cleanup-scratch`"
---

# source-command-cleanup-scratch

Use this skill when the user asks to run the migrated source command `cleanup-scratch`.

## Command Template

# Cleanup Scratch

Delete exploration files left in the repo root after debugging sessions.

## Steps

1. List scratch candidates in the repo root matching these patterns:
   - `test_*.py`
   - `debug_*.js`, `debug_*.py`
   - `*_results.json`
   - `temp.json`, `boxscore_sample.json`
   - `nul`
   - `deep_espn_*`, `external_apis_research*`, `find_historical_*`, `reverse_engineer_*`, `espn_api_*`, `analyze_team_slots.py`
   - Any `.py` / `.js` in repo root that isn't part of the project structure

2. **Show the list to the user** and get explicit confirmation before deleting anything. Some files may be intentionally kept as exploration artifacts — do not assume.

3. Delete only the confirmed files with `rm`:
   ```bash
   rm <file1> <file2> ...
   ```

4. Report what was deleted and the git status diff after.

## Rules
- NEVER delete without explicit confirmation
- NEVER touch files inside `backend/`, `frontend/`, `.Codex/`, `.github/`, migrations, or planning `.md` docs
- If in doubt, leave the file alone
