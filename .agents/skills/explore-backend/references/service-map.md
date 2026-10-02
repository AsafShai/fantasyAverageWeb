# Service Map

Load this for the structured project snapshot when exploring or documenting the backend.

## Routes (`backend/app/routes/`)
Thin HTTP layer. No business logic. Each file owns one resource (teams, players, rankings, injuries, snapshots, etc.).

## Services (`backend/app/services/`)
- `nba_stats_service.py` — per-player stat calculations
- `team_service.py` — fantasy team aggregation, roster + slot usage
- `snapshot_service.py` — daily snapshot writes to Neon
- `injury_service.py` — parses 4 PM ET NBA injury PDFs
- `data_provider.py` — ESPN fetcher with ETag caching
- `data_transformer.py` — shapes raw ESPN payloads
- `ranking_service.py` — league rankings

## Builders
- `builders/response_builder.py` — assembles final API response objects from services

## Models (`backend/app/models/`)
Pydantic v2. Shared: `Team`, `Player`, `PlayerStats`.

## Data flow
```
ESPN API  →  data_provider (ETag cache)
              ↓
          data_transformer
              ↓
           service layer  ←  Neon (asyncpg)
              ↓
         response_builder
              ↓
             route
              ↓
             JSON
```

## Persistence vs compute
- **Persisted in Neon**: snapshots, `player_injury_status`, rankings history
- **Computed on-the-fly**: team aggregation, per-player stats in a period
- **Ephemeral in-memory**: `injury_store` (PDF-only, for the public injury page)

## DB
- Neon Postgres via asyncpg (no ORM)
- Migrations: `backend/migrations/*.sql`, applied manually
- Live schema: query via `postgres` MCP
