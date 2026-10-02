# Streaming Planner / Schedule Grid — Design (idea 1)

**Asaf 2026-07-11: low priority, probably won't use — documented + mocked anyway for completeness.** Originally FILTERED; revisited on request.

Games-cap roto framing: not "stream to win the week" (no weeks here) — it's **schedule-aware pickup planning**: which FAs give the most games before cap pressure, on nights your roster is thin, against the friendliest defenses.

## Data

| Piece | Source | Status |
|---|---|---|
| NBA schedule (future) | nba_api `scheduleleaguev2` (season schedule incl. future games) or ESPN scoreboard per date | needs probe when 2026-27 schedule drops (~Aug) |
| NBA schedule (played) | `fs_team_games` | ✅ in DB |
| League rosters + FAs | existing `data_provider` (kona, filterStatus FREEAGENT) | ✅ exists |
| Matchup quality on future games | existing `NbaMatchupService` def ranks, applied to future opponents | ✅ service exists |
| Slot/cap pace | existing `team_slot_pace` | ✅ exists |

## Calc

- **Grid**: NBA team × next 14 days — game/no-game per day, opponent, home/away; total games per week per team.
- **Off-night flag**: day where ≤ 5 NBA games scheduled (league-wide) — these nights FAs matter most because most rosters idle.
- **Roster coverage** (per fantasy team, dropdown): games your current roster plays per day → thin nights highlighted.
- **FA panel**: free agents sorted by `games_next_7 × matchup_quality_avg`, with off-night games counted separately ("3 games, 2 on your empty nights").
- Cap context: banner from `team_slot_pace` — "UTIL slot at 96% of cap pace" → planner de-emphasizes volume adds when cap-tight.

## Frontend

Page `SchedulePlanner.tsx`: heat grid (sequential single hue on games count), off-night columns tinted, FA table below, fantasy-team dropdown (no auth — pick any team). Mobile: grid scrolls horizontally with sticky team column.

## Mockup

`streaming_planner_mockup.html` (repo root) — grid built from **real schedule week 2026-01-05 → 01-18** (`fs_team_games`), off-nights computed from real game counts; FA panel uses real player names with illustrative matchup values.

## Tasks (if ever built)

- [ ] backend `schedule_service.py`: schedule fetch+cache, off-night calc, FA ranking join
- [ ] route `GET /api/schedule/planner?team_id=`
- [ ] frontend page + navbar entry behind flag
- Scope: Medium

## Open questions
- Worth building at all given games-cap format? (Asaf leaning no — parked)
- If built: 7 vs 14 day horizon default
