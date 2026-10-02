# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

Full-stack roto fantasy basketball app for a private ESPN league (12 teams, 8 categories, ~12 users).
Live: `https://fantasyleagueinfo.onrender.com` — Render free tier, cold starts after ~15 min idle.

Gotchas:
- **Trade Suggestions (AI) page is disabled** — its backend route was removed, but the frontend page still calls the dead `/trades/suggestions/` endpoint.
- Feature flags live in `frontend/src/config/featureFlags.ts` (many `VITE_FF_*` flags, all opt-in). A flag set in `.env.local` locally is **not** set on prod unless added in Render env vars — check there before assuming users can see a feature.
- Backend layout: `backend/app/` — `routes/` (thin routers), `services/` (business logic; `data_provider.py` centralizes external calls with caching via `cache_manager.py`), plus `builders/`, `models/`, `minigames/`, `fantsy_estimator/`. ML pipeline code lives outside the app in `model_stats_inference/`.

## Stack

- **Backend:** Python 3.12+ / FastAPI / uv. PostgreSQL on Neon (injury status, snapshots, estimator tables). External data: ESPN Fantasy API, nba_api, official NBA injury-report PDF (`ak-static.cms.nba.com`, polled every 15 min at :00/:15/:30/:45 NY time via pdfplumber).
- **Frontend:** React 19 + TypeScript + Vite. Redux Toolkit + React Query + TanStack Table, Tailwind v4, Recharts.
- **Node:** engines pin `>=24 <25` (`.nvmrc`). The root README's "Node.js 18+" is stale.

## Commands

Backend (from `backend/`):
- `uv sync` — install deps
- `uv run uvicorn app.main:app --reload` — dev server on :8000
- `uv run pytest -q` — tests. `pyproject.toml` sets `addopts = "-m 'not live'"`, so tests marked `@pytest.mark.live` (real ESPN API) are **excluded by default**; run them explicitly with `uv run pytest -q -m live`.

Frontend (from `frontend/`):
- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build` (type check + build)
- `npm run lint`, `npm run test` (vitest)

## Database (Neon Postgres)

- `DATABASE_URL` in `backend/.env` — never hardcode or commit it.
- Migrations are plain `.sql` files in `backend/migrations/`, applied **manually by the user**. Write the migration file, then tell the user to apply it — don't look for a migration runner.
- Seed scripts run locally before deploy: `seed_injury_db.py`, `seed_rankings.py`, `seed_team_snapshots.py`.

## Git & PRs

- Base new work off fresh `dev`: `git fetch origin dev && git checkout dev && git pull origin dev && git checkout -b <name>`.
- New branch for new features and for bugs already pushed to dev/master. Stay on the current branch when continuing unpushed, in-progress work. Ask if ambiguous. Branch naming: `feat/` · `fix/` · `refactor/` · `chore/` + kebab-case. `/start-feature` triggers this workflow.
- **PRs always target `dev`, never `master`** — regardless of which tool creates them (GitHub's default branch is `master`, but this team merges feature branches into `dev` first). Only target `master` if the user explicitly says so.
- Frontend changed? A pre-push hook runs `tsc --noEmit` and blocks the push on type errors (`.git/hooks/pre-push`). Don't bypass with `--no-verify`.
- Verify changes live (server restarted, request re-run, real output pasted) before claiming done.

## UI / Responsiveness Rule

Every UI change must work on **both desktop and mobile** (~390px viewport, iPhone-class).

Before marking any frontend task done:
- Tables: `overflow-x-auto` + hide non-essential columns on mobile (`hidden sm:table-cell`). Never let a wide table destroy the layout.
- Keep at least one anchor column sticky on wide tables so users know which row they're on while scrolling.
- Responsive padding/font on dense tables (`px-1.5 sm:px-3`, `text-xs sm:text-sm`).
- Flex layouts: `flex-wrap` with `gap` — never fixed-width rows that overflow.
- Expand/detail rows: center content with `justify-content: center` so items wrap gracefully.

## Code Style

- Minimal comments — only when the WHY is non-obvious (hidden constraint, workaround, surprising behavior).
- All imports at the top of the file. Mid-file imports are allowed only as deliberate lazy imports where circular dependency or load time is the explicit reason.

## Feature History

Implementation notes for completed features (matchup quality, ESPN whitelist calendar, player rankings, depth charts, injury DB) live in `docs/feature-history.md`. Read the relevant entry before touching that area instead of re-deriving design decisions from code.
