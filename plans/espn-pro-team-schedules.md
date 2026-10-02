# NBA schedule from ESPN `proTeamSchedules_wl` (one request)

Branch: `perf/espn-pro-team-schedules`

## Verified 2026-09-18
`GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027?view=proTeamSchedules_wl` → 200, 423 KB, no cookies.
Payload: `settings.proTeams[]` (31 entries incl. FA id 0) each with `abbrev`, `id`, `name`, `location`, `byeWeek`, `proGamesByScoringPeriod: {periodId: [{id, date (epoch ms), homeProTeamId, awayProTeamId, scoringPeriodId, startTimeTBD, statsOfficial, validForLocking}]}`.
As of today it lists 80 scoring periods (season not fully published yet — re-check in October; expected ~174, matching `status.finalScoringPeriod`).

## What it replaces
- `schedule_service.py`: today builds the season schedule from 7 monthly `site.api.espn.com` scoreboard scans, then maps ESPN team ids. One request replaces seven, and period ids come for free.
- `settings.season_start` derivation at startup (`NBAStatsService.get_regular_season_start_date`, ~16 sequential scoreboard calls via binary search): `proGamesByScoringPeriod["1"][0].date` is the first regular-season game date. Keep the old path as fallback only.
- Future: gives a canonical `date → scoringPeriodId` map, replacing `season_start + timedelta(days=period-1)` arithmetic in `db_service.py` upserts.

## Change
1. `data_provider.py`: `get_pro_team_schedules()` cached 24 h (`CacheManager` entry), same httpx client, ETag header support like the standings fetch.
2. `schedule_service.py`: new builder `_games_from_pro_team_schedules(payload)` producing the existing `ScheduledGame` list; keep `_extract_games(scoreboards)` as fallback when the fantasy endpoint fails. Response shape of `GET /api/nba/schedule` unchanged.
3. `main.py` lifespan: derive `season_start` from period 1 first; fall back to the binary search.
4. Map `proTeamId` → abbreviation using the payload's own `abbrev` (ESPN fantasy ids match `PRO_TEAM_MAP` in `utils/constants.py`; assert in a test).

## Tests
- Fixture: trimmed real payload (2 teams, 3 periods) under `tests/fixtures/`.
- `test_schedule_service.py`: games extracted, home/away correct, dates converted from epoch ms to ET date via `ZoneInfo('America/New_York')`.
- Startup derivation test with fixture.

## Risks
- `startTimeTBD` games have placeholder times; only the date matters here.
- Preseason games: check whether period ids < 1 or a separate flag appear once the full season is published; filter to `scoringPeriodId >= 1`.
