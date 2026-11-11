# Boom or Bust: surprises and disappointments of the night

A new Insights page (`/boom-or-bust`) that ranks every player who played last night by
how unexpected his line was: who surprised, who disappointed. Built from the
July 2026 surprise research (`research/walkforward-backtest` branch), with the
research dashboard's final weights frozen into the server.

This note is for review before it goes anywhere near production: what it costs,
what has to change on the server, and what can go wrong.

## What it does

Every morning, right after the model nightly has ingested a night, one extra step
scores each player-game and writes it to a new table. The page reads that table.

Two ingredients per player-game, both standardized against a reference season:

| Ingredient | Question it answers | Source |
|---|---|---|
| Z-surprise (metric 1) | Was tonight unusual **for him**? Pearson z of each stat vs his own history over 4 windows (all data / this season / last 10 / last 5), weighted per stat and window, volume-weighted by √(MIN/30) | `fs_player_games` |
| Model-error surprise (metric 2) | Did he beat **what the model expected for the minutes he played**? | `model_eval_results` |

Final = a blend that differs by sign (research finding: model error adds value on the
good side, z dominates on the bad side), mapped to N(0,1) by rank against the
reference season. Positive = surprise, negative = disappointment. A player without a
model estimate yet (fewer than 10 career games, or not yet in the model's data) is
scored on metric 1 alone, ranked among last season's rows without an estimate, and tagged "history only" on the page.

**The bust side** (November 2026). The league ranked the 20 worst nights of the
season's first three weeks (round 1: three ballots, 10 picks each, in order) and
disagreed with the score: 28 points of Durant sat at #6, Trae Young's 4 points at
#20. The bust side still blends the same two metrics, but reads them differently
from the boom side (all in `surprise.py`, each constant with the night that
motivated it):

- points at 2.5 times the weight, the free-throw impact eased to 0.5 (`BUST_Z_WEIGHTS`);
- every column on a rarity scale, its rank in the reference season as a normal
  score (`rarity_normalize`), instead of standard deviations, where a counting
  stat stops at zero while the shooting impacts run to −5;
- one collapse above a string of medium dips: each rarity score to the power 1.5
  (`BUST_COLLAPSE_POWER`);
- his whole history at 0.5 instead of 0.1 and his last 5 at 0.25 instead of 0.5
  (`BUST_WINDOW_WEIGHTS`);
- the volume weight capped at 30 minutes (`BUST_VOLUME_CAP`): a short stint still
  softens a bust, 40 minutes no longer deepen it.

Agreement with the round 1 ballots (NDCG@10) went from 0.63 to 0.93. A second
round on the new score's own top 30 (three ballots, 15 picks; the voters saw the
score's order, so it is not a blind test) agrees at 0.97; the voters agree with
each other at 0.92–0.96 in both rounds. The booms' scores are unchanged.

Checked against both rounds together and found no better: 108 combinations of
the constants above; each stat's weight moved alone from 0 to 4 (every one sits
at its best value or within noise of it; without points agreement falls to 0.40);
the averages' share of the blend (0.75 best of 0.5–0.9); the recent windows.
Tried and dropped: a lower weight on both shooting impacts (round 1 alone: 0.42),
no volume weight on busts (early exits of 6–8 minutes took the top), points as a
plain drop from his average, and a bust scaled by what the player normally gives
(no gain, and it lifted nights the league gave no vote).

Out of sample on 2026-27 the score leans to busts at ±1.8 (2.8% / 2.1%), not on
the page's bars (35 busts past −2.2, 34 booms past 2.1); walk-forward inside
2025-26 (fitted on the first half, scored on the second) it does not lean more
than before the change (3.0% busts both ways), so the lean is October's, players
under their long-run averages, and is to be watched as the season goes on. The
constants were tuned on 50 nights and three voters; a blind ballot on later
nights is the real test.

After the merge the nights already stored have to be scored again, or the page
mixes two scores: `uv run python scripts/rescore_boom_or_bust.py --database-url …`
(from `backend/`, on a checkout with the new score; it prints the booms and busts
before and after).

**Per-stat verdicts** (the coloured cells): for every stat of a scored row the same
two ingredients are blended for that stat alone, its z against his own windows and
the model's standardized error for it (makes, not percentages, for FG/FT), with the
same sign-piecewise weights; z alone without an estimate. A stat is marked when
that per-stat surprise is at least 1.0 either way (median cell 0.6, 90th
percentile 1.8 on two real nights): green above his norm, red below, whichever
table the row is in, so a boom can show a cold free-throw line and a bust a good
assist night. Shooting needs volume to be marked (FGA ≥ 4, FTA ≥ 3: a 1-of-1 is
nothing). The strongest stat matching the score's sign is the headline next to
the name. Stored per row as `reasons`, at most 5.

**Where he was in the league that night:** under each name, next to his NBA team, a
small bullet with the fantasy team's abbrev and whether he started (a slot other
than BE / IR) or sat, or "FA". It is the roster **as it was on that night**: one ESPN
request per night for that scoring period (`scoringPeriodId`, period 1 = the season's
first day), stored with the row when the night is scored, so later pickups, drops and
lineup changes never rewrite it (Drummond: FA on Oct 20, picked up on Oct 21). Columns
`fantasy_team_id`, `fantasy_team`, `lineup_slot`; NULL = free agent / unknown.
Cost of that request, measured: ~200 KB on the wire (gzip; ESPN embeds the player
objects and no filter trims them), once per night, parsed and dropped: +4–10 MB on
the step's peak (200–207 MB vs 196 MB without it) and +0.7 s. For scale, the Players
page pulls 364 KB from ESPN on every visit.

Weights and blend: `backend/model_stats_inference/serving/surprise.py` (module constants).
Reference season: `surprise_calibration.json` next to it, built by
`scripts/build_surprise_calibration.py` from the walk-forward parquet. Thresholds
for "worth mentioning": server settings (below). The page has two sliders that only
filter what the viewer sees; the server's verdict is stored per row.

## Periods

Besides one night, the page shows a range: Last 7 days, Last 30 days, Season,
or a custom From–To (a one-day custom range is just that night's normal view).

- **One row per player-night**, with a Date column: a player with two huge
  nights appears twice. Nothing is rescored; the rows are the nightly's own.
- **The same bar as a single night.** The sliders are the night's score sliders
  (1.7–3.0, defaults boom 2.1 / bust 2.2, the same remembered values), applied to every
  player-night in the period. Moving one filters in place.
- `GET /api/surprises/period?start&end&min_score=1.7`: every player-night at
  least ``min_score`` from 0 (the sliders' lowest point) plus a summary, best
  first; the page filters from there. A range is at most 366 days.
- Share works the same: the top 5 of each side, the period in the header,
  each row's night in the table.

## Cost

Measured on 2026-10-21 against the local Docker Postgres (4 seasons of history,
~98k `fs_player_games` rows), `/usr/bin/time -l`, macOS.

**Memory**

| Run | Peak RSS |
|---|---|
| `python -c "import app.services.surprise_service"` (baseline) | 172 MB |
| Surprise step alone, 3-game night (68 players, 13k history rows) | 196 MB |
| Surprise step alone, full night (15 games, 310 players, 40k rows) | 219 MB |
| Model nightly (incremental path, after #344), 3-game night, step **off** | 293 MB |
| Model nightly, 3-game night, step **on** | 310 MB |

So the step's working set is ~25 MB (3 games) to ~47 MB (full night) above a bare
interpreter, and it adds ~17 MB to the nightly's peak on a 3-game night. It runs
after the nightly has released its own memory. Four things keep it there:

- only the night's players' history is loaded (`player_id IN (…tonight…)`), 19
  columns, streamed through a server-side cursor in 10k-row chunks;
- the z-scores are computed for the night's rows only (`night_zscores`: plain
  aggregates over the prior rows), not by walking every row of the history;
  the result is identical to the research function, pinned by a test;
- only the Pearson family of z-scores is built in production (the backtest builds
  all three);
- the step's frames are dropped and `gc.collect()`ed before the rows are written.

**Time:** ~1 s per night, inside the nightly's 9:00–11:00 window. Full-season
backfill ≈ 170 nights × 1 s ≈ 3 min, by hand (`python -m app.services.surprise_service --date`).

**Storage:** ~480 bytes per player-game (the `reasons` JSON is a third of it).
310 rows on a full night ≈ 150 kB; a season ≈ 26k rows ≈ 13 MB with the index.
For comparison `model_eval_results` is 488 kB for 1,082 rows (~450 B/row).

**Code:** ~600 lines of Python (scoring module 347, service 184, route 25, models 48),
one migration, one 52 kB JSON, one page on the frontend. Tests: 16 backend, 4 frontend.

**Read side:** one query of ≤ 310 rows per page view, 10-minute RTK cache. Negligible.

## What has to change on the server

1. **Migration:** `backend/migrations/create_model_surprise_results.sql`
   (`CREATE TABLE IF NOT EXISTS`, one table, one index). Nothing else in the schema changes.
2. **Settings** (all have defaults, none required):
   - `SURPRISE_NIGHTLY_ENABLED` (default true): kill switch for the nightly step.
   - `SURPRISE_GOOD_THRESHOLD` / `SURPRISE_BAD_THRESHOLD` (2.1 / 2.2): the server's
     verdict and the sliders' default position (both sliders 1.7–3.0; the score is
     ranked onto a symmetric bell curve, so the same |score| is as rare either way).
   - `SURPRISE_MIN_MINUTES` (0). Every player past the threshold is listed; each card pages five at a time.
3. **Nightly:** the step runs inside `ModelNightlyService._run_for_date` after the
   night's rows are committed, so it needs `MODEL_NIGHTLY_ENABLED=true` (it already is
   wherever the model nightly runs).
4. **Frontend:** `VITE_FF_BOOM_OR_BUST=true` to show the nav item and route.
5. **Once a year:** re-run the walk-forward backtest for the finished season and
   `scripts/build_surprise_calibration.py` so the reference season moves on.
   Nothing breaks if this is skipped; the scale just ages.

## Risks and what limits them

| Risk | Effect | Limit |
|---|---|---|
| Memory on a full night pushes the nightly container over its limit | OOM kill of the nightly, after the night's rows are already committed | The step runs last and is isolated: a failure is logged, the night stays `processed`, the tab keeps its last night. Kill switch `SURPRISE_NIGHTLY_ENABLED=false`. Backfill by hand later. Watch the first full-slate night's `[mem]` lines. |
| The step raises for any reason | Same as above, no effect on predictions or vectors | `try/except` around the whole step |
| Table missing on prod (migration not applied) | The step logs an error every night; the tab shows "No nights scored yet" | Apply the migration; nothing else depends on it |
| Early season | The model estimates anyone with 10 career games (opening night 2026: 62 of 68), but the calibration's backtest only had estimates from 10 games *this* season, so opening weeks were never in it; the first nights of 2026-27 leaned to busts. The SEASON window is still thin, so ALL/L10/L5 carry it | Rebuild the backtest with the live rule; until then read the first weeks as provisional |
| Calibration drift | Scores are relative to 2025-26's distribution; a league-wide scoring change shifts how many cross the bars | Yearly refresh; thresholds are settings, not code |
| Weights are opinion | Someone disagrees with what "surprise" means | They are one dict each in `surprise.py`, mirrored in the research dashboard's defaults; change there, re-run the calibration script, done |
| Reference season assumes the research z-scores and the nightly's agree | Scores off if they drifted | The backtest now imports the same `compute_zscores`; the shipped calibration is checked against the module's settings in `test_surprise.py` |
| ID space | Player links and headshots use ESPN athlete ids from `fs_player_games`; eval rows from before the ESPN migration do not join and are simply treated as "no estimate" | Nothing to do; new nights are post-migration |
| Turnovers | Stored in the table, never scored, not shown | Could drop the column before the table exists anywhere |

Not covered yet: no "post to the group" output, no history view per player, no
fantasy-team owner column. All three are straightforward on top of the stored rows.
