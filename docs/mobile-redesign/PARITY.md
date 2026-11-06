# Feature parity checklist

Every page of the live site (Nov 6, plus the dev-branch changes marked *(dev)*) and where each feature lives in the mobile redesign. Use it as the acceptance checklist for each page PR: nothing removed, nothing invented.

## Today
_Reached from: tab · menu League_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Trade deadline countdown | top card |
| ESPN updated + slate, games | title row |
| Rank movers + team/category filters | grouped by team with the categories that moved |
| Roster health tiles + table (P/Q/D/OUT), sort | card |
| Latest moves + All activity link | card |
| League averages (9 stats + pace, days left, teams) | tiles |
| Top 5 Teams (average) | dark card near the top, with change since yesterday |

**Change:** Reorganized: Top 5 moved up as a highlight card; movers grouped per team. Every card opens its full page: Full standings, Rankings, Injuries, All activity, Standings values, Trade Analyzer, Box Scores.

## Standings & Rankings
_Reached from: tab · menu League_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Layout: Table / Cards (dev) | segmented |
| Show: Standings / Rankings | segmented |
| Values: Averages / Totals | segmented |
| From–To dates, Apply, Clear (dev), Quick range 1d/7d/15d/30d | collapsible "Date range" |
| NBA Avg Pace, Days Remaining | tiles |
| Show / Hide movers | chip next to Date range |
| Table: rank, team, 8 cats, TOTAL, GP, deltas, sort | team column pinned |
| Share | icon |

**Change:** Layout: rank merged into the pinned team column; plain values, no colors.

## Teams
_Reached from: tab · menu League_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| All 12 teams, my team first | list |
| Team #id | subtitle |
| Tap → team page |  |

**Change:** Layout: full-width rows.

## Team page
_Reached from: from Teams, Today, Standings_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Back to Teams, Share, View on ESPN | header |
| Ranking Summary + rank, points, change | header card above the tabs |
| Team Statistics | tab "Team Statistics" |
| Shot Chart Stats, Per-Game Averages | tab "Team Statistics" |
| Roster: Daily (default, dev) / Stats / Schedule | tab "Roster" |
| Daily: day stepper, Moves strip, one roster table (starters, then bench/IR by slot badge; no Status column) | Daily mode |
| Team statistics: overall rank, total points, field goals, free throws (dev) | tab "Team Statistics" |
| Integer projections, period, horizon | tab "Roster" |
| Include checkboxes, matchup expand | roster table |
| Slot usage, Roster coverage | tab "Slots & coverage" |

**Change:** Reorganized: header card, 3 tabs; nothing removed.

## Trade Analyzer
_Reached from: tab · menu Tools_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Team vs Team / Team vs Free Agents | segmented |
| Period selector | chips |
| Total Stats / Per Game Averages | segmented |
| Team A / Team B pickers + player dropdowns | one side at a time |
| Team rankings bar, player cards, remove | side card |
| Free Agent Pool search | side B in FA mode |
| Comparison table, Avg Z, Show/Hide Columns, Share | card + sticky Avg Z summary |

**Change:** Moved: Team A / Team B switch instead of two stacked columns.

## Players
_Reached from: tab · menu Players_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Search | top |
| Team, position, status filters | Filters sheet |
| Stat filters (stat, operator, value, Add Filter) | Filters sheet |
| Slate, Only playing on slate, Integer projections | Filters sheet |
| Stats/Schedule, Per Game/Totals | segmented |
| Period selector | chips |
| Table incl. matchup, sort | name pinned |

**Change:** Moved: filters into one sheet with active-filter chips; name/team columns after stats.

## Player Rankings
_Reached from: menu Players_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Search | top |
| Calc mode, Display mode | segmented |
| Period incl. Last night | chips |
| Position, fantasy team, Show top N, Min GP, Min MPG | Filters sheet |
| Punt categories, Reset | chips |
| Table with Z and _z columns, sort | name pinned |
| Explain: Z-score | link |

**Change:** Moved: filters into the sheet.

## Player profile
_Reached from: from any player name_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Back, photo, name, team, position | header card |
| Rostered by | badge |
| Conference, division, height, age, nationality | collapsible "Bio" |
| Time frame | chips |
| Fantasy Value + category z-scores + Explain | card |
| Stats Per Game / Totals | card |
| Trends tiles, projection (minutes slider, integer, reset) | cards |
| Game log | card |

**Change:** Moved: bio folded so stats come first.

## Activity
_Reached from: menu League_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Activity, Trades, Pending, Trade tree, Released | chips |
| Team filter, move type | selects |
| From / To dates | row |
| Moves list, Show more | card |

**Change:** Layout only.

## Draft Report
_Reached from: menu League_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Include low-GP players | checkbox |
| Totals / Per Game | segmented |
| Draft Board | card, scrolls sideways |
| All Picks + team filter + Value/Diff/Verdict (Steal…Bust, INJ, Low GP, DNP) | card |
| Team Draft Value — diff vs slot, Team Grades + not ranked (dev) | cards |

**Change:** Layout only.

## FA Report (dev)
_Reached from: menu League_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Totals / Per Game | segmented |
| Undrafted top 200 by season value rank | note |
| Search player or NBA team, count | row |
| Player, NBA, Last FA pickup, Picked up by, GP, zTotal, Season rank; sort | table |

**Change:** New page on dev, added as its own page.

## League Analytics
_Reached from: menu Insights_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Heatmap / Rankings Over Time / Shooting Stats | segmented |
| Date range (Today, Apply, Last 1d–30d) | collapsible |
| Performance Heatmap | card |
| Standings Race: Basis Per Game / Season Totals, Show Roto Points / League Rank / Stat Value, Category (dev) | card |
| Shooting Stats | card |

**Change:** Layout only.

## Player Trends
_Reached from: menu Insights_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Minutes, Usage & Role, Categories, Shooting ×2 | chips |
| 7d / 15d / 30d / Custom | segmented |
| All / Free agents / Rostered | segmented |
| Position, fantasy team, min games | Filters sheet |
| Search, explainers, table |  |
| Tap a player → game-by-game chart (per-game makes/attempts vs season, baseline, league) | chart card |

**Change:** Moved: filters into the sheet; the chart opens above the table.

## Projections
_Reached from: menu Insights_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Slate picker | select |
| NBA team, fantasy team | Filters sheet |
| Search, Integer projections, Reset minutes | row |
| Per-player minutes (− / + stepper and ↺, stats update live), sort | one card per player |

**Change:** Moved: filters into the sheet; table rows became cards so each player gets the minutes stepper.

## Boom or Bust
_Reached from: menu Insights_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Last night / 7 / 30 days / Season / Custom | chips |
| ‹ › night navigation | row |
| Surprise + disappointment thresholds | collapsible |
| Booms / Busts tables, Share | segmented |

**Change:** Moved: Booms and Busts as two tabs.

## Standings Estimator
_Reached from: menu Insights_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Rank Probability Heatmap | tab |
| Projected Rankings | tab |
| Season Projections | tab |
| Share | icon |

**Change:** Moved: three stacked tables become three tabs.

## NBA Teams
_Reached from: menu NBA_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Team picker | select |
| Depth chart grid: position × Starter…5th, injury pills, FA mark, team logo + record | card |
| Exclude Out / Doubtful / Questionable / Probable, Duplicates | chips |
| Team schedule | card |

**Change:** Layout as today, position column pinned.

## Box Scores
_Reached from: menu NBA_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| ‹ date › | row |
| Full box, No spoilers | toggles |
| Games list → box score | cards |

**Change:** Layout only.

## Season Schedule
_Reached from: menu NBA_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| 7 / 14 / 28 days / Pick an end date | chips |
| Games per night chart + explainers | card |
| Who plays when (G, Δ, B2B, next, days) | card |
| Months / Weeks season table | card |

**Change:** Layout only.

## Injuries
_Reached from: menu NBA_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| All / My players’ teams / My players | segmented |
| All Statuses, All Teams, search | row |
| Report table, sort | player pinned |
| Notifications | card |

**Change:** Moved: player column first.

## Minigames
_Reached from: menu Minigames_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| All 4 games | list |
| Each game: Start New Game, Auto next, View map | game page |
| Leaderboards | card |

**Change:** Layout only.

## Navigation
_Reached from: every page_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Same 6 menu groups, 23 items (FA Report added on dev) | ☰ menu |
| Tap any player name: quick view (season per game, status, next matchup) → Full profile | player sheet |
| Select my team, dark mode, search | menu + header |
| Today, Standings, Teams, Players, Trade | bottom tab bar |
| Logo header + site footer | as today |
| Every view has its own URL; browser back closes the player sheet / filters first, then goes to the previous page | browser back |

**Change:** Mobile web view: the mock browser bar shows the URL and a working back; dropdowns, filters, search and dark mode work.

## Not on the menu today
_Reached from: unchanged_

| Feature (as on the live site) | Where in the redesign |
|---|---|
| Draft pages (flag off) | stay off |
| Trade Suggestions (disabled) | stays off |
| Feature Store (internal) | stays off |

**Change:** No change.
