# balldontlie API — Research Notes (2026-07-11)

Docs: https://docs.balldontlie.io · OpenAPI spec: https://www.balldontlie.io/openapi/nba.yml
Base: `https://api.balldontlie.io` · Auth: `Authorization: YOUR_API_KEY` header · Cursor pagination (`per_page` max 100).
Also offers: native MCP server (mcp.balldontlie.io), webhooks (All-Access only), Google Sheets functions.

## Tiers (per sport, NBA)

| Tier | $/mo | req/min | Unlocks |
|------|------|---------|---------|
| Free | 0 | 5 | Teams, Players, Games only |
| All-Star | 9.99 | 60 | + Game Player Stats, Active Players, **Player Injuries** |
| GOAT | 39.99 | 600 | + Season Averages (player+team), Advanced Stats v2, Box Scores (incl live), Lineups, Standings, Leaders, **Betting Odds**, **Player Props**, Contracts, Plays |

48h GOAT trial per sport (payment method required, 5 req/min during trial).

## Endpoints (26 paths)

`/nba/v1/`: teams, players, players/active, games, stats (per-game box lines, realtime for live games, `period` param for quarter splits), season_averages/{category}, team_season_averages/{category}, standings, player_injuries, box_scores + box_scores/live, lineups (starter flag + game position), leaders (9 stat types), contracts (teams/players/aggregate), plays (play-by-play w/ court coordinates, participants)
`/nba/v2/`: odds, odds/opening, odds/player_props, odds/player_props/opening, stats/advanced

## Data highlights

- **Player Injuries** (All-Star): `status` (Out/Doubtful/...), **`return_date`** ("Nov 17"), `description` (dated beat-writer note). RotoWire-style. This is the return-date data our PDF pipeline lacks.
- **Betting Odds** (GOAT): per vendor per game — spread values+odds, moneyline, totals, live-updated. Opening odds kept for ~current season only.
- **Player Props** (GOAT): LIVE only, no history. Vendors: draftkings, betway, betrivers, ballybet. prop_type: points/rebounds/assists/threes/steals/blocks + 1Q + first3min variants. Markets: over_under or milestone.
- **Advanced Stats v2** (GOAT): 100+ per-game fields — PIE, ratings, four factors, hustle (deflections, contested shots, loose balls, screen assists, box outs, charges), tracking (speed, distance, touches, passes, secondary assists), defensive matchup stats (matchup FG%, points allowed), usage shares (pct_pts, pct_reb, ...).
- **Season Averages** (GOAT): same category×type matrix as NBA.com stats (general/clutch/defense/shooting/playtype/tracking/hustle/shotdashboard).
- Games (Free): schedule + live scores, quarter scores 2023+, NBA Cup stage flag.

## vs our current stack

- nba_api (free) already covers ~everything in GOAT stats: season averages all categories, advanced box scores, hustle, tracking, standings, leaders, lineups. balldontlie adds reliability/clean REST, not new stats data.
- Genuinely NEW data vs what we have: **odds + props** (GOAT), **injury return_date + descriptions** (All-Star), contracts.
- The Odds API (the-odds-api.com) free tier: 500 credits/mo — spreads/totals/ML daily fetch fits free. Cheaper path for idea 7 (Vegas layer) than GOAT.

## Fit to feature ideas (feature_ideas_2026-07.md)

| Idea | balldontlie value | Verdict |
|------|-------------------|---------|
| 7 Vegas layer | odds endpoint clean but GOAT $39.99 | Use The Odds API free tier instead |
| 15 Injury Return Calendar | return_date + description, $9.99 All-Star | Best-value paid option; only real gap-filler |
| 4 Role-Change Detector | advanced v2 usage/touches | Skip — nba_api free has it |
| 5 Hidden-Value Indicators | hustle in advanced v2 | Skip — nba_api free has it |
| 9 Tonight's Forecast | props = market line to compare model vs Vegas | Nice-to-have, GOAT only, props live-only |

Bottom line: free tier adds nothing over nba_api/ESPN. All-Star $9.99 worth considering solely for injury return dates. GOAT only if we want odds/props, and The Odds API free tier undercuts that for basic spreads/totals.
