# Feature Ideas — 2026-07-11 Research Round

> Design docs created: **Trends page (3+4+6)** → `trends_page_plan.md` · **Standings Race (8)** → `standings_race_plan.md` + `standings_race_mockup.html` · **Draft Report Card (12)** → `draft_report_card_plan.md` + `draft_report_mockup.html` · **Streaming Planner (1, low-prio)** → `streaming_planner_plan.md` + `streaming_planner_mockup.html`

New ideas beyond the existing wiki roadmap (`tools/fantasyleagueinfo-roadmap`: SGP engine, category lock, gap table, cluster-pass, trade sim, waiver impact, radar, overkill — none duplicated here).

League context: 8-cat roto, ESPN, games cap per slot, no H2H, no keepers, no playoffs, third-round-reversal draft, 12 teams, ~12 active users. Constraints: no AI/chat features, no preseason projections, no per-user auth (global views), in-app only (no external notifications).

Status legend: **active** = candidate. **filtered** = rejected 2026-07-11 by Asaf.

## A. Games-cap + schedule

### 1. Streaming Planner / League-Tailored Schedule Grid — FILTERED
NBA teams × weeks grid, off-night highlights, crossed with league rosters ("FAs that play on your thin nights", matchup-quality on future games).
Filtered: streaming schedule not relevant enough in games-cap roto.

### 2. Cap Burn-down + End-Game Calendar — active
Burn-down chart per team vs games cap, league-wide pace comparison, day-by-day final-6-weeks planner. Reuses `team_slot_pace` + `slot_games_estimator`. ESPN shows raw games used only.

## B. Data ESPN doesn't show (nba_api / external, free)

### 3. Luck / Regression Meter (buy-low, sell-high) — active
Per player: 3P%, FT%, FG% now vs career baseline; recent window vs season. Flags unsustainably hot/cold. Feeds Trade Analyzer leverage. Pure math.

### 4. Role-Change Detector — active (revival of shelved idea)
Shelved 2026-06-19 for lack of usage data on ESPN API. Condition met: nba_api has `USG_PCT` (advanced) + touches, time-of-possession, drives (tracking). Minutes trend + usage trend + starter flag = waiver early-warning board.

### 5. Hidden-Value Leading Indicators (hustle + tracking) — active
Deflections lead STL; contested shots lead BLK; drives/touches proxy usage. Board: "deflections top-20 but STL rank 60 → buy". No fantasy site surfaces this.

### 6. Minutes Movers — active
Rolling MPG leaderboard, biggest risers/fallers 2 weeks, starter↔bench flips. Could merge 3+4+6 into one "Trends" page.

### 7. Vegas Layer on Matchups — active
Spreads → blowout risk; totals → production environment; B2B + injury report → rest risk. Extra chips in existing MatchupDisplay. Source: The Odds API free tier (confirmed viable — see round-2 findings). Player props excluded (not free).

## C. League engagement

### 8. Standings Race Chart — active
Animated bump chart of roto standings over season from existing team score snapshots. Cheapest big-wow item.

### 9. Tonight's Forecast — active ⭐ flagship candidate
Combine live per-player ML predictions (`live_projection_service`) with roto standings: projected cat gains tonight per team, likely standings flips. The ML pipeline made visible to the league.

### 10. Transaction Feed + Pickup ROI — FILTERED
League-wide add/drop feed + value-gained-since-pickup leaderboards from ESPN transactions endpoint.
Filtered: not needed.

### 11. Records & Milestones — FILTERED
League records from snapshots + roster-player milestones (triple-doubles, career highs).
Filtered: not needed.

### 12. Live Draft Report Card — active
Every pick vs realized z-value, steals/busts per round, per-team draft grade updating all season. ESPN draft data via API; z-engine exists.

### 13. Weekly Recap (template, no AI) — active
Auto digest page: biggest riser, cat-lead flips, pickup of the week, coming-week schedule notes. Fixed template + computed numbers, Hebrew-friendly.

### 14. Player Comparison Tool — active
Side-by-side 2–3 players: z-scores, 30-day trends, upcoming game counts, matchup quality. All ingredients exist.

### 15. Injury Return Calendar — REMOVED (infeasible free)
Timeline of returning-soon players. Removed 2026-07-11: reliable return dates require paid source (balldontlie All-Star $9.99/mo); our PDF/ESPN pipeline has status only. Revisit only if a free return-date source appears.

## Round-2 research findings (2026-07-11, site dives)

### 16. With/Without Splits ("Next Man Up") — active, NEW
Hashtag Basketball's Next Man Up: pick player → every teammate's per-game averages WITH vs WITHOUT him. We can build from our own feature store game logs (`fs_player_games`) and go further: auto-link to injury tracker — "X ruled Out tonight → historical beneficiaries: A +4.1 AST, B +6 MIN". Waiver gold during injuries. Hashtag's is manual-lookup only; ours can push context to Players/Matchups.

### 17. Frustration Value — active (fun, low effort), NEW
Basketball Monster original: metric for how frustrating a player was to own (missed games, cold streaks, blown expectations). League banter feature; pairs with z-engine + game logs.

### API verdicts
- **The Odds API free tier viable for idea 7**: cost = markets × regions per call, one call covers all NBA games. `h2h,spreads,totals` × `us` = 3 credits; 2×/day all season ≈ 180/mo vs 500 free. Player props priced per-event — NOT viable free.
- **balldontlie**: free tier useless for us (teams/players/games only). Only unique data: injury `return_date` + descriptions ($9.99 All-Star), odds/props ($39.99 GOAT). Stats tiers duplicate nba_api free. See balldontlie_api_reference.md.
- **Idea 6 validated**: Hashtag "Playing Time Trends" = same concept (season MPG vs last-7-days), proves demand; ours adds starter flag + league FA status.
- **Idea 5 confirmed feasible**: NBA.com hustle page (deflections, contested 2PT/3PT, loose balls, screen assists, charges) all exposed via nba_api free.
- Basketball Monster otherwise validates existing roadmap (Analysis Monster ≈ SGP/standings analysis, Trade Monster ≈ trade sim); their z-rankings with custom date ranges = feature we already shipped this week.

## Feasibility verification (2026-07-11, ideas 12/4/5/16 probed)

### 12. Draft Report Card — VERIFIED ✅
`GET lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/660330196?view=mDraftDetail` → 200 **without cookies** (league public-read). 168 picks, fields: `playerId`, `teamId`, `overallPickNumber`, `roundId`, `roundPickNumber`, `memberId`, `keeper`. Names via existing `kona_player_info`; team names via `mTeam`; realized value via existing z-engine. No blockers.

### 4. Role-Change Detector — VERIFIED ✅
`leaguedashplayerstats(measure_type='Advanced')` → 582 players, `USG_PCT`/`E_USG_PCT`/`PACE` present. Rolling windows via `last_n_games`/`date_from` params (same endpoint). Starter/bench split available via `starter_bench_nullable`. Minutes trend from own `fs_player_games`.

### 5. Hidden-Value Indicators — VERIFIED ✅
`leaguehustlestatsplayer` → 581 players: DEFLECTIONS, CONTESTED_SHOTS(_2PT/_3PT), CHARGES_DRAWN, SCREEN_ASSISTS(+PTS), LOOSE_BALLS(_OFF/_DEF), BOX_OUTS. `leaguedashptstats` Possessions → TOUCHES, TIME_OF_POSS, PTS_PER_TOUCH, ELBOW/POST touches; Drives → DRIVES, DRIVE_FGM/FGA/FTA. All free.

### 16. With/Without Splits — VERIFIED ✅
`fs_player_games` (Neon): full NBA population, 3 seasons — 2023-24 (23.3k rows/457 players), 2024-25 (25.5k/568), 2025-26 (26k/582), ~10.1 players per team per game = complete box scores. With/without = teammates' rows on team game_ids where target has/lacks a row. Zero external calls; historical seasons included.

### Render/nba_api reliability note (ideas 4+5)
Direct offseason probe inconclusive (matchups route returns `[]` for both no-games and failure). Strong indirect evidence: nightly model pipeline ingested nba_api logs from Render all season (fs rows through 2026-04-12). Mitigation regardless: these boards need daily freshness only → fetch in nightly scheduled job + persist to DB (existing pipeline pattern), never live-call nba_api per request.

## Top picks (pre-filter ranking, impact × feasibility × differentiation)

1. **9. Tonight's Forecast** — unique, reuses ML pipeline, daily visit driver
2. **8. Race Chart** — data fully in DB, wow per effort
3. **3+4+6 "Trends" page** — best decision-support cluster
4. **12. Draft Report Card** — engagement king for draft-centric league
5. **2. Cap Burn-down** — format-specific, mostly reuses existing services

## Sources

- ESPN roto games-played strategy: https://www.espn.com/fantasy/basketball/story/_/id/20674472/fantasy-basketball-roto-strategy-managing-games-played
- Hashtag schedule grid: https://hashtagbasketball.com/nba-fantasy-schedule
- Basketball Monster: https://basketballmonster.com/
- Sleeper league history/awards: https://sleeper.com/blog/league-history-and-weekly-trophies/
- RotoWire buy-low shooting trends: https://www.rotowire.com/basketball/article/fantasy-basketball-buy-low-sell-high-evaluating-shooting-trends-68024
- NBA hustle stats: https://www.nba.com/stats/players/hustle
- The Odds API: https://the-odds-api.com/
- balldontlie: https://www.balldontlie.io/
