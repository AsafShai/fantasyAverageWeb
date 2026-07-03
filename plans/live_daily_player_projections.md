# Live Daily Player Projections — Full Plan

## 1. Database

Add `player_game_logs` table:
- `player_id`, `player_name`, `team_id`, `game_id`, `game_date`, `season`, `opponent_team_id`, `is_home`
- `min`, `pts`, `reb`, `ast`, `fg3m`, `stl`, `blk`, `fgm`, `fga`, `ftm`, `fta`, `position`

Add `player_projections` table:
- `player_id`, `game_date`, `opponent_team_id`
- `projected_min`, `pts`, `reb`, `ast`, `fg3m`, `stl`, `blk`, `fgm`, `fga`, `ftm`, `fta`
- `status` (green/orange/red), `reason`
- Written daily by the job, read by the API

---

## 2. Daily Job (GitHub Action, ~7am before games)

1. Fetch yesterday's ESPN box scores (1–2 API calls)
2. Parse + insert new rows into `player_game_logs`
3. Build live feature store from DB (last 60 days of logs)
4. Run inference for every player with a game today → write to `player_projections`

---

## 3. Backend — New / Changed

- **`player_game_logs` DB service** — insert yesterday's logs, query by player/date range
- **Live FeatureStore** — reads from DB instead of parquet, same interface as current serving code
- **New endpoints:**
  - `GET /api/projections/today` — all players with games today + projected stats + status
  - `GET /api/projections/player/{id}` — single player projection
  - `GET /api/projections/reflection` — yesterday's projected vs actual for all players who played
- **Models** — `.joblib` files committed to git, loaded at startup, never change at runtime

---

## 4. Model / Training (offline, manual)

- **Pre-season:** full `research.run` (nba_api, ~30 min) + `training.train` → commit `.joblib`
- **Monthly during season:** retrain from `player_game_logs` DB instead of parquet (new training entry point needed)
- **Parquet pipeline stays as-is** for simulation/replay page (PR #100 feature) — separate from live projections

---

## 5. UI

### Players page
- Add "Tonight" column/badge per player
- Shows projected pts/reb/ast inline if they have a game today
- Green/orange/red dot for confidence
- Click → expands to full stat line projection

### Team page
- Projected lineup card for tonight
- Each player row shows projected stats + minutes
- Minutes slider per player (manual override, reruns inference client-side or calls API)

### Matchup page (expandable)
- When expanding a matchup, each player gets projected stats added inline
- Green/orange/red confidence dot
- Helps directly with start/sit decisions

### New: Projections page (today's slate)
- Full list of all players with games today, grouped by game
- Sortable by any projected stat
- Minutes toggle per player
- Confidence indicators

### New: Reflection page (yesterday's scorecard)
- Table: `player | projected pts/reb/ast/etc | actual pts/reb/ast/etc | diff`
- Color coded: green = within RMSE band, red = miss
- Sortable, filterable by team/stat
- Builds trust in the model over time

---

## 6. Open Questions (revisit later)

- Retraining cadence — monthly manual vs automated
- Whether minutes override is API call or purely client-side
- ESPN player ID → NBA player ID mapping (partially done in codebase)
- Whether simulation/replay page (PR #100) stays separate or merges with reflection page

---

*Purely additive — does not touch existing product flows.*
