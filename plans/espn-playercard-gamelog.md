# Player game log from ESPN `kona_playercard`

Branch: `feat/espn-playercard-gamelog`

## Verified 2026-09-18
`GET .../seasons/2027/segments/0/leagues/660330196?view=kona_playercard` with header
`X-Fantasy-Filter: {"players":{"filterIds":{"value":[4066261]},"filterStatsForTopScoringPeriodIds":{"value":16,"additionalValue":["002027","102027","012026","002026"]}}}`
→ 200, one player (Bam Adebayo), 19 stat entries: per-game lines (`statSplitTypeId 5`, one per `scoringPeriodId`, 45 stat keys each) plus season/projection aggregates. No cookies.

## What it improves
Today the Player Profile game log comes from `fs_player_games` (nightly ingest from site.api box scores, joined to ESPN players by **normalized name**). Known weak spots that ESPN's own view removes:
- Name-join misses (suffixes, accents, duplicate names) → "no data" on real players.
- Ingest gaps (a night that failed to fold in) → missing games until backfill.
- Keyed by ESPN `playerId`, which `Player.player_id` already carries, so the join is exact.
- Includes ESPN's fantasy-relevant keys directly (stat ids per `utils/espn_stat_map.py`), and previous seasons via `additionalValue` codes (`00<season>` actual, `10<season>` projection).
Feature store stays the source for the ML pipeline and Trends; this is only a better read path for one player's log.

## Change
- `data_provider.py`: `get_player_card(player_id, top_n=16)` — per-player fetch, in-process cache 30 min keyed by id (bounded: profile visits only).
- `data_transformer.py`: `playercard_to_game_log(payload) -> list[GameLogEntry]` mapping stat ids via `STAT_ID_TO_CATEGORY`; skip non-game splits.
- `routes/trends.py` `GET /trends/player/{id}/gamelog`: add `source=espn|store` query (default `store` until parity is checked); `espn` path serves the card. Keep the response model identical so `TrendGameLogChart` needs no change.
- Later (separate task): flip default to `espn` for `PlayerProfile`, keep `store` for Trends anchors.

## Tests
- Fixture from the probe (trimmed to 3 games).
- Transformer test: 3 entries, correct PTS/REB/3PM/FG%/period ids, sorted by period desc.

## Verification
- Compare `/gamelog?source=espn` vs `store` for 5 players over last 10 games: totals must match; note any differences (DNP handling, OT minutes).

## STATUS 2026-09-18: DROPPED (revisit after 2026-27 season starts)

Probe results before dropping:
- Stat mapping validated: 14/14 games matched `fs_player_games` exactly on MIN/FGM/FGA/FTM/FTA/3PM/3PA (stat ids 40/13/14/15/16/17/18). `fs_player_games.player_id` IS the ESPN id, so the id-join claim holds.
- DNP arrives as a `statSplitTypeId 5` split with an empty `stats` dict — skip, not zeros.
- Blocker: `GameLogEntry` needs `usg` (team totals from `fs_team_games`) and `matchup` (opponent). The playercard has neither — only the player's own line, `proTeamId`, and NBA game `externalId`. ESPN alone cannot fill the chart; a hybrid (ESPN line + store for usg/matchup) was the only zero-frontend option and still depends on the store for those two fields.
- `game_date` must not be derived as `season_start + (spid - 1)` from `.env` — `.env` SEASON_START is stale (2025-10-22, real start 2025-10-21; prod overrides it at startup from the ESPN calendar). Use the proTeamSchedules_wl period→date map once that PR lands.
- Preseason: no 2026-27 rows anywhere, so live parity through the route is impossible until October.

If revisited: option (b) hybrid from the discussion, after `perf/espn-pro-team-schedules` merges (gives period→date and opponent per period, which removes the `matchup` gap and leaves only `usg` on the store).

Note: the Bam Adebayo 2026-03-10 row (43 FGA / 43 FTA / 22 3PA) is REAL — an 83-point game. Not an ingest bug. Do not "fix" it.
