# Nightly Model Pipeline: fetch → retro-predict → persist → update feature store

## Context

The `model_stats_inference` package (PR #100) can predict per-player stat lines, but nothing runs it in production: `FeatureStore` has no live data source and no code fetches nightly games. To be ready for next season, the backend needs a scheduled morning job that:

1. Fetches **only last night's** NBA games (player + team game logs) via nba_api.
2. Runs model estimations for those games using the **actual minutes played** (retro-prediction, computed from feature-store state that excludes the night being predicted — leakage-safe).
3. Appends predicted-vs-actual rows to Postgres.
4. Updates the feature store with the night's data.
5. All in one callable function, scheduled at 9:00/9:30/10:00/10:30/11:00 Asia/Jerusalem (mirroring `estimator_scheduler.py`), skipping once the night is processed.

## Decisions (settled in design review)

| Decision | Choice |
|---|---|
| Store persistence | **Postgres-backed feature store now** (no parquet store dir, no docker volume). |
| Store shape | Raw game rows (`fs_player_games`, `fs_team_games`) are the **source of truth**; vectors are derived. **Materialized vectors** are also persisted (`fs_player_vectors`, `fs_team_allowed_vectors`, `fs_team_own_vectors`, features as JSONB) so a live inference path loads ready-to-use vectors without recomputing. The nightly job rebuilds vectors from the raw rows each run and upserts them (post-night, so they're current for tonight's games). |
| Serving | `ModelNightlyService` holds a **resident in-memory `FeatureStore`** (`get_inference_store`), loaded once from the vector tables and reused for every intra-day prediction (no per-request DB hit). Invalidated whenever the nightly job refreshes vectors; a separate serving process refreshes via `get_inference_store(refresh=True)`. `FeatureStore.from_vectors` builds an inference-only store (no raw rows). |
| Stale players | Bootstrap-only: players whose newest game is ≥2 years old are dropped (`drop_stale_players`). Forced re-bootstrap truncates raw + vector tables first. |
| Bootstrap depth | Same seasons as `research/config.py: SEASONS` (currently 2023-24 → 2025-26; bump each season). Row-level filter only (regular season, `MIN >= MIN_MINUTES`); do **not** apply the research corpus filter `MIN_PLAYER_GAMES=20` — `MIN_INFERENCE_GAMES=10` gates at read time. |
| Eval output | DB table only (`model_eval_results`). No API route, no UI tab for now. |
| Retraining | Out of scope. Models stay frozen `models/*.joblib`; retrain manually offline. |
| Go-live | `MODEL_NIGHTLY_ENABLED` default `false`; flip near opening night. No SEASON_START logic — off-nights just record `no_games`. |
| Simulation/FeatureStore tabs | Stay behind flags, default off. `SimulationService` (research-cache-based) untouched. |
| Local DB | Postgres 16 service in `backend/docker-compose.yml`; prod later = change `DATABASE_URL`. |
| Eval table shape | Wide `pred_*`/`actual_*` columns per target (PTS, REB, AST, FG3M, STL, BLK, FGM, FGA, FTM, FTA). FG%/FT% derivable; error metrics left to SQL. |

## Key design points

- **"Yesterday"**: `(now(Asia/Jerusalem) - 1 day).date()`. NBA `GAME_DATE` is the US/ET calendar date; at 9:00–11:00 IL, all of last night's games carry exactly that date. A catch-up loop covers the last 7 unprocessed dates (oldest first) so downtime never leaves holes.
- **Idempotency**: `model_nightly_runs` ledger row per date (`processed` / `no_games` / `store_already_ingested`). Leakage guard: if `fs_player_games` already has rows for the date, never predict — mark `store_already_ingested`.
- **Off-night vs data-lag**: ScoreboardV2 for the date. 0 regular-season games (`GAME_ID` prefix `002`) → `no_games` (done). Games exist but not all final (`GAME_STATUS_ID != 3`) or logs incomplete → return **without marking**, next retry slot tries again.
- **Leakage-safe build**: each run builds the in-memory store from `fs_player_games`/`fs_team_games` rows `WHERE game_date < target_date` only.
- **Unknown teams must be pre-filtered** before `predict_many`: it only catches `InsufficientHistoryError`/`UnknownPlayerError` per request (`serving/inference.py:102`); `UnknownTeamError` would abort the whole batch. Ineligible players (< 10 games / unknown) are stored with NULL `pred_*`, real actuals, `eligible=false` + `reason`. Their raw rows are still ingested, so newcomers become eligible over time.
- **Crash-safe order**: predict → insert eval rows (must succeed) → insert night's raw rows → mark run. Every step retry-safe (`ON CONFLICT DO UPDATE`; re-prediction after a partial failure rebuilds the identical pre-night store, so results are reproducible).
- **Positions**: nightly logs lack `POSITION` (needed by `build_current_state`). Bootstrap stores it per row (merged from `fetch_positions`, as `load_or_build` does); nightly rows get the player's last known `POSITION` from the store (`""` for brand-new players until the next bootstrap/roster refresh).
- **Risk (accepted)**: nba_api sometimes blocks datacenter IPs; the nightly fetch runs from wherever the backend runs. Fine for local dev; revisit for cloud deployment.

## Files

### 1. NEW `backend/migrations/create_model_pipeline_tables.sql`

```sql
CREATE TABLE IF NOT EXISTS fs_player_games (
    player_id BIGINT NOT NULL, game_id TEXT NOT NULL,
    season TEXT NOT NULL, game_date DATE NOT NULL,
    player_name TEXT NOT NULL, team_id BIGINT NOT NULL,
    matchup TEXT NOT NULL, position TEXT NOT NULL DEFAULT '',
    min DOUBLE PRECISION NOT NULL,
    -- one column per stat the research cache carries (mirror players.parquet schema exactly;
    -- enumerate at implementation time from the local cache): fgm, fga, fg3m, fg3a, ftm, fta,
    -- oreb, dreb, reb, ast, stl, blk, tov, pf, pts, plus_minus, ...
    PRIMARY KEY (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_fs_player_games_date ON fs_player_games (game_date);

CREATE TABLE IF NOT EXISTS fs_team_games (
    team_id BIGINT NOT NULL, game_id TEXT NOT NULL,
    season TEXT NOT NULL, game_date DATE NOT NULL,
    team_name TEXT NOT NULL DEFAULT '', matchup TEXT NOT NULL,
    -- mirror the raw TeamGameLogs columns build_team_allowed/build_team_own consume
    PRIMARY KEY (team_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_fs_team_games_date ON fs_team_games (game_date);

CREATE TABLE IF NOT EXISTS model_nightly_runs (
    game_date DATE PRIMARY KEY,
    status    TEXT NOT NULL,            -- 'processed' | 'no_games' | 'store_already_ingested'
    num_games INT  NOT NULL DEFAULT 0,
    num_rows  INT  NOT NULL DEFAULT 0,
    ran_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_eval_results (
    game_id TEXT NOT NULL, player_id BIGINT NOT NULL, game_date DATE NOT NULL,
    player_name TEXT NOT NULL, team_id BIGINT NOT NULL, opponent_team_id BIGINT NOT NULL,
    is_home BOOLEAN NOT NULL, minutes DOUBLE PRECISION NOT NULL,  -- actual minutes, used as model input
    eligible BOOLEAN NOT NULL, reason TEXT NOT NULL DEFAULT '',
    pred_pts DOUBLE PRECISION, pred_reb DOUBLE PRECISION, pred_ast DOUBLE PRECISION,
    pred_fg3m DOUBLE PRECISION, pred_stl DOUBLE PRECISION, pred_blk DOUBLE PRECISION,
    pred_fgm DOUBLE PRECISION, pred_fga DOUBLE PRECISION, pred_ftm DOUBLE PRECISION, pred_fta DOUBLE PRECISION,
    actual_pts DOUBLE PRECISION NOT NULL, actual_reb DOUBLE PRECISION NOT NULL,
    actual_ast DOUBLE PRECISION NOT NULL, actual_fg3m DOUBLE PRECISION NOT NULL,
    actual_stl DOUBLE PRECISION NOT NULL, actual_blk DOUBLE PRECISION NOT NULL,
    actual_fgm DOUBLE PRECISION NOT NULL, actual_fga DOUBLE PRECISION NOT NULL,
    actual_ftm DOUBLE PRECISION NOT NULL, actual_fta DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_model_eval_results_game_date ON model_eval_results (game_date);
CREATE INDEX IF NOT EXISTS idx_model_eval_results_player ON model_eval_results (player_id, game_date);
```

### 2. NEW `backend/model_stats_inference/serving/nightly.py` — pure sync fetch + eval

Reuses `rdata._to_datetime/_regular_season_only/build_team_allowed`, `research/config.MIN_MINUTES`, `EvalRow`/`_actual_line` from `serving/simulation.py`, `LiveInference.predict_many`.

- `season_for(d: date) -> str` — month ≥ 8 → season starts that year (`2026-01-15` → `"2025-26"`).
- `@dataclass NightFetch`: `game_date, player_games, team_games, expected_games, complete`.
- `fetch_night(game_date) -> NightFetch`:
  - `PlayerGameLogs`/`TeamGameLogs` with `season_nullable=season_for(d)`, `date_from_nullable=date_to_nullable=MM/DD/YYYY`, `season_type_nullable="Regular Season"`, plus the sleep/timeout conventions from `rdata` (its `_fetch` loops whole seasons — small `_fetch_one_day` here).
  - Insert `SEASON` column; `rdata._to_datetime` + `_regular_season_only`; drop player rows with `MIN` null or `< MIN_MINUTES`.
  - `ScoreboardV2(game_date=...)` → `expected_games` (GAME_ID prefix `002`), `complete` = all final AND `len(team_games) == 2*expected` AND player logs non-empty; `expected == 0 → complete=True`.
- `evaluate_night(store, inference, night) -> list[EvalRow]` — mirror `SeasonSimulator._evaluate_all` (`simulation.py:338`): opponent map from `build_team_allowed(night.team_games)`, `is_home = "vs" in MATCHUP`, `minutes = float(MIN)`; **pre-filter unknown teams** into ineligible `EvalRow`s; batch the rest through `predict_many`.
- `attach_positions(store, player_games)` — map `PLAYER_ID` → last known `POSITION` from `store.players`, fallback `""`.
- Only touch to existing ML code: add `game_id: str = ""` (defaulted) to `EvalRow` in `simulation.py`.

### 3. EDIT `backend/app/services/db_service.py` — following the existing pool/try-except pattern, returning success booleans

- `get_fs_rows_before(game_date) -> (player_records, team_records)` — both fs tables `WHERE game_date < $1`.
- `fs_has_date(game_date) -> bool` — leakage guard.
- `insert_fs_rows(player_rows, team_rows) -> bool` — executemany, `ON CONFLICT DO NOTHING`.
- `get_model_nightly_run(game_date) -> Optional[dict]` / `upsert_model_nightly_run(game_date, status, num_games, num_rows) -> bool`.
- `insert_model_eval_rows(rows) -> bool` — `ON CONFLICT (game_id, player_id) DO UPDATE`.
- DataFrame ↔ records conversion lives in the service layer, not DBService.

### 4. NEW `backend/app/services/model_nightly_service.py` — the single orchestrating function

`ModelNightlyService` singleton (`__new__` like `SimulationService`), `asyncio.Lock`, heavy sync work via `asyncio.to_thread`.

- `run_for_date(game_date, force=False) -> str`:
  1. Ledger row exists (not force) → `"already_processed"`.
  2. `fs_has_date(d)` → mark `store_already_ingested` → return (leakage guard).
  3. `night = await to_thread(nightly.fetch_night, d)`.
  4. `expected_games == 0` → mark `no_games`.
  5. `not night.complete` → `"incomplete_data"` (NOT marked; next slot retries).
  6. Read raw rows `< d` from Postgres → `to_thread`: DataFrames → derive `team_allowed`/`team_own` → `FeatureStore.build()`.
  7. Store empty → `"store_not_bootstrapped"` error status (tells you to run bootstrap).
  8. `to_thread`: `LiveInference(store)` + `evaluate_night`.
  9. Map `EvalRow`s → dicts; `insert_model_eval_rows` — failure → `"db_write_failed"` (retry next slot).
  10. `attach_positions` → `insert_fs_rows(night)`.
  11. Mark `processed`.
- `run_catchup()` — last 7 dates ending IL-yesterday, oldest first, each fully completing before the next (each date rebuilds its own pre-date store; a few extra seconds, maximal simplicity).
- `bootstrap(force=False, until_date=None)` — one-time init: `fetch_player_logs`/`fetch_team_logs`/`fetch_positions` for `research/config.SEASONS` → clean rows (regular season, `MIN >= MIN_MINUTES`, merge `POSITION`) → bulk `insert_fs_rows`. Refuses if fs tables non-empty unless `force`. `until_date` inserts only rows before it (for E2E testing mid-season replay).
- `__main__` CLI: `python -m app.services.model_nightly_service [--date YYYY-MM-DD] [--force] [--bootstrap] [--until-date YYYY-MM-DD]`.

### 5. NEW `backend/app/services/model_nightly_scheduler.py`

Copy of `estimator_scheduler.py` structure: `ISRAEL_TZ`, `SCHEDULE_TIMES = [(9,0),(9,30),(10,0),(10,30),(11,0)]`, `_compute_next_trigger()`; loop calls `ModelNightlyService().run_catchup()` in try/except with `logger.exception`. Skip-once-processed is automatic via the ledger.

### 6. EDIT `backend/app/config.py` + `backend/app/main.py` + `.env.example`

- Settings: `model_nightly_enabled: bool = False` (alias `MODEL_NIGHTLY_ENABLED`).
- `main.py` lifespan, after the estimator scheduler line (~51), mirroring injury gating:
  `if settings.model_nightly_enabled: asyncio.create_task(model_nightly_scheduler.start_scheduler())`.

### 7. EDIT `backend/docker-compose.yml` — local Postgres

```yaml
  postgres:
    image: postgres:16-alpine
    container_name: fantasy-postgres
    environment: {POSTGRES_USER: fantasy, POSTGRES_PASSWORD: fantasy, POSTGRES_DB: fantasy}
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d:ro   # all *.sql are CREATE IF NOT EXISTS → safe auto-apply on first init
    healthcheck: {test: ["CMD-SHELL", "pg_isready -U fantasy -d fantasy"], interval: 5s, timeout: 3s, retries: 10}
```

`fantasy-backend` gets `depends_on: postgres (service_healthy)` and `DATABASE_URL: postgresql://fantasy:fantasy@postgres:5432/fantasy`. Host-run dev: `DATABASE_URL=postgresql://fantasy:fantasy@localhost:5432/fantasy` in `backend/.env`. Existing volume: `docker compose exec -T postgres psql -U fantasy -d fantasy < migrations/create_model_pipeline_tables.sql`.

### 8. NEW `backend/tests/services/test_model_nightly_service.py`

- `season_for` edge dates (Nov → same season, Mar → prior-year season, Aug → new season).
- `evaluate_night` on a tiny synthetic store: predictions computed pre-ingest; ineligible player gets reason + actuals; unknown-team row doesn't abort the batch.
- Idempotency: fake DB + monkeypatched `fetch_night`; second run → `already_processed`; `fs_has_date` true → `store_already_ingested`; failed eval insert → run not marked.

## Verification

1. `cd backend && docker compose up -d postgres`; confirm the 4 tables via `psql -c '\dt'`.
2. Bootstrap with a mid-season cutoff (offseason-safe E2E — it's July): `DATABASE_URL=... uv run python -m app.services.model_nightly_service --bootstrap --until-date 2026-01-15`.
3. `... --date 2026-01-15` → `processed` (nba_api serves historical dates).
4. `SELECT COUNT(*), COUNT(pred_pts) FROM model_eval_results WHERE game_date='2026-01-15'`; sanity-check pred vs actual magnitudes; check `model_nightly_runs`; confirm `fs_player_games` now has 2026-01-15 rows.
5. Rerun → `already_processed`; delete ledger row, rerun → `store_already_ingested` (leakage guard); eval rows unchanged.
6. `MODEL_NIGHTLY_ENABLED=true uv run uvicorn app.main:app` → "Model nightly scheduler started" + next-trigger log; flag off → disabled log.
7. `uv run pytest tests/services/test_model_nightly_service.py`.