---
name: "source-command-seed-db"
description: "Migrated source command `seed-db`"
---

# source-command-seed-db

Use this skill when the user asks to run the migrated source command `seed-db`.

## Command Template

# Seed DB

Run a seed script against Neon. Used before deploys.

## Steps

1. Ask which script(s) to run (or all):
   - `seed_injury_db.py` — last 3 days of 4 PM ET NBA injury PDFs → `player_injury_status`
   - `seed_rankings.py` — league rankings history
   - `seed_team_snapshots.py` — daily team snapshots

2. Confirm with the user before running — these write to production Neon.

3. Run from `backend/`:
   ```bash
   cd backend && uv run python seed_injury_db.py
   ```
   (or the chosen script, or each in turn for "all").

4. Report stdout + exit code. If any script failed, stop and surface the error.

## Notes
- `DATABASE_URL` is read from `backend/.env` by each script.
- Seed scripts are idempotent (upsert on conflict) but still confirm before running.
- Post-seed, spot-check one row via the postgres MCP.
