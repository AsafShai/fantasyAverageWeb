# Live Data Updates — Design & Plan

Status: design, nothing implemented. Researched 2026-11-12 against the code on
`master` and the live ESPN API for league 660330196, season 2027.

## 1. What is actually stale today (and what is not)

The backend does **not** fetch ESPN once a day. `DataProvider.get_totals_df`
revalidates the league payload every 30 s (`TOTALS_TTL_SECONDS`, ETag). The
staleness is on ESPN's side:

- `teams[].valuesByStat` (the season totals every standings number is built
  from) only changes in ESPN's nightly run. Today that run landed at
  08:15:58 UTC = 10:15 Israel (`status.standingsUpdateDate`), the same
  millisecond as `waiverLastExecutionDate`.
- `scoringPeriodId` identifies the day now being played (24 today).
- The once-a-day part in *our* code is only the DB side: `estimator_scheduler`
  (09:00–11:00 IL slots) calls `sync_db_now()` and runs the estimator, and
  `_sync_db_if_needed` writes `team_daily_snapshot` / `team_rankings_*` for
  `scoringPeriodId - 1` the first time a new period is seen.

So from first tip (~02:00 IL) until ESPN's run (~10:15 IL) every page built
from `valuesByStat` shows yesterday. That is the gap to close.

## 2. What ESPN gives us (verified)

| Finding | Evidence |
|---|---|
| A team's season totals are **exactly** the sum of the single-day stat lines of the players in its active slots (lineupSlotId 0–11, i.e. not BE=12 / IR=13) | Rebuilt all 12 teams × 11 stats (PTS, BLK, STL, AST, REB, FGM, FGA, FTM, FTA, 3PM, GP) from `view=mRoster&scoringPeriodId=1..23`; zero differences against `valuesByStat` |
| A single-day line is `statSplitTypeId 5, statSourceId 0, scoringPeriodId P`; it carries GP as stat `42` (1 when he played, line empty when DNP) and `externalId` = the ESPN game id used by the site box-score API | period 23 payload |
| The payload we **already poll every 30 s** contains every team's current lineup: `schedule[0].teams[].rosterForCurrentScoringPeriod.entries[]` with `lineupSlotId` and a `stats` array | 189/189 players and slots identical to `mRoster` for period 24 |
| Each roster entry has `lineupLocked` (false before his game tips, true after); league lock type is `INDIVIDUAL_GAME` | periods 23 vs 24 |
| Games-played caps exist: 82 per position slot, 246 for UTIL, tracked in `cumulativeScore.statBySlot` with `limitExceeded` / `exceededOnScoringPeriod` | `settings.rosterSettings.lineupSlotStatLimits` |
| ESPN supports ETag/304 on all of these | `mRoster` conditional GET returned 304 |
| Site box-score API (already used by Box Scores, 60 s TTL while live) uses the same player ids | `box_score_value_service` already joins it to fantasy rosters |

### Live probe result (2026-11-13 00:36 UTC, two games in the 1st quarter)

The open question is answered: **the league payload we already poll carries
in-progress stat lines.** Source A is confirmed; no new ESPN request is needed
for the live standings.

| Checked | Observed |
|---|---|
| `schedule[0].teams[].rosterForCurrentScoringPeriod.entries[].player.stats` in the existing standings request | 25 single-day lines for players in started games, 21 with numbers (the other 4 had not checked in). Each has `scoringPeriodId 24`, `statSplitTypeId 5`, `statSourceId 0`, and `externalId` = the game id |
| GP mid-game | stat `42` is already `1` as soon as the player has minutes |
| Against the site box score, 21 players | counting stats agree; two players were one play apart (the two feeds refresh a few seconds apart) |
| `teams[].valuesByStat`, `scoringPeriodId`, `standingsUpdateDate` | unchanged from the afternoon — the official baseline does not move during games, as the design assumes |
| `cumulativeScoreLive.statBySlot` | ESPN already includes tonight's games per slot (team 1: SF 10→11, F 9→10), so live slot usage can be read directly |
| `teams[].pointsLive` | ESPN's own live roto points, differs from `points` for 9 of 12 teams. Not used for display (it is computed on ESPN's totals view), but useful as a cross-check in the shadow logs |
| `lineupLocked` | true for the 25 players whose game had started, false for the rest |
| Payload churn | 116 KB; the ETag changed about every 20–40 s during games, so each 30 s poll is a full download instead of a 304. Same request count as today |
| `view=mRoster` for the current period | carries the same live lines (1.9 MB); not needed for standings |

### Which source says a game is final (checked 2026-11-13 02:55 UTC)

Checked with TOR @ PHI final, DET @ WSH in overtime and two games in play.

| Source | Says "final"? | Size per request | Notes |
|---|---|---|---|
| League payload stat lines (already polled every 30 s) | **No.** A finished game's lines have exactly the same fields as a live one's (GP 1, minutes, no status) | 0 extra | |
| Fantasy schedule `statsOfficial` (`proTeamSchedules_wl`) | **No.** Still `false` for the finished game; it only turns `true` with ESPN's nightly run | ~40 KB gzip | not usable |
| Site scoreboard | **Yes:** `status.type.state = "post"`, `completed: true`; overtime correctly shows "End of OT", not final | ~8 KB gzip | already fetched and cached by Box Scores, Today and matchups |
| Fantasy live-games feed (`apis/fantasy/v2/games/fba/games`) | **Yes**, same status fields | ~12 KB gzip | not used anywhere in the app today |

So the "finished games only" rule needs one external signal, and only the
scoreboard and the fantasy games feed give it. The scoreboard is smaller and
already in the app's shared cache, so when another page has fetched it in the
last minute the overlay costs no extra request at all. It is only needed while
games are live; before the first tip and after the last final, no request is
made.

**Decision (user, 2026-11-13):** the site scoreboard is the "game is final"
source.

#### When the scoreboard is called

Every check below runs in memory on data the app already holds (the pro-team
schedule, cached for 24 h, has every game's tip time; final states are kept in
memory). No check costs a request.

1. **Only when a page needs it.** The status is fetched on demand by a request
   for a live-capable page, cached 60 s and shared with Box Scores, Today and
   matchups. No background polling: if nobody opens the site, no calls.
2. **Only for the Averages view.** Totals and the roster show games in
   progress anyway and never need it.
3. **Not before a game could have ended.** A game is not checked until
   1 h 45 min after its tip. NBA games take about 2 h 15 min, so this costs no
   delay. This covers the whole day from ESPN's morning update until well
   after the first tip.
4. **A final game is never asked about again.** Final does not go back to
   live, so once a game is seen final it is remembered for the rest of the
   period.
5. **Done when every game is final.** After the last final there are no more
   calls until ESPN moves to the next day (which happens the next morning
   anyway).

In practice that is at most one ~8 KB request a minute, for roughly the two to
three hours between the first possible final and the last final, and only
while someone is on the site. If a game is postponed or suspended, its status
never turns final, so it simply never counts toward averages that night;
ESPN's official update the next morning settles it.

The overlay service still takes "today's lines per player" behind one
function, so the box-score source remains available as a fallback and as a
cross-check.

## 3. Design: an official layer and a live overlay

**Core rule: live numbers are derived on the fly and never stored.** Nothing
that exists today changes meaning.

```
official totals (valuesByStat)            -> DB snapshots, estimator, rank
  = totals_cache['data'], unchanged          changes, over-time, date ranges
        +
live overlay (per team, per stat)         -> computed, in memory only
  = sum of today's lines of players in
    active slots, for ESPN's current period
        =
live totals frame                         -> Rankings, Today, heatmap,
                                             team header (opt-in call sites)
```

### 3.1 `LiveOverlayService` (new, backend)

Input: the cached official raw payload + today's lines. Output: an immutable
`LiveOverlay`:

- `period`: the official payload's `scoringPeriodId`
- `per_team[team_id] -> {FGM, FGA, FTM, FTA, 3PM, REB, AST, STL, BLK, PTS, GP, + league extras (TO…)}`
- `per_slot_gp[team_id][slot]` (for slot usage)
- `games_total / games_live / games_final`, `as_of`
- `version`: hash of the inputs, so consumers can memoise

Rules:

1. Player counts iff `lineupSlotId` not in {BE, IR}. No lock logic is needed:
   an unlocked player has no stats yet, a locked player's slot cannot change.
2. Counting stats are added; **ratio categories are rebuilt** from the summed
   sources via `RATIO_CATEGORIES` (FG% = FGM/FGA…). `StatsCalculator` passes
   derived columns through as-is, so the live frame must recompute them.
3. Slot caps: a slot with `limitExceeded` and `exceededOnScoringPeriod < period`
   contributes nothing (ESPN counts the whole day on which the cap is crossed,
   nothing after).
4. Period selection uses **ESPN's `scoringPeriodId`**, never the Eastern
   calendar date. Late West-coast games run past midnight ET while ESPN is
   still on the same period.
5. Empty overlay (no game started, offseason, All-Star break) ⇒
   `get_totals_df(live=True)` returns the **same object** as the official
   frame. Off-hours behaviour is therefore identical to today, byte for byte,
   and all memos are shared.

### 3.2 `DataProvider` changes

- `get_totals_df()`, `get_all_dataframes()`, `get_averages_df()`,
  `get_rankings_df()`, `memo_response()` gain `live: bool = False`. **Default
  stays official**, so every existing call site (DB sync, estimator, draft
  report, slot pace, team-name maps…) is untouched until it opts in.
- The live frame is never written into `totals_cache['data']`. `sync_db_now`
  and `_sync_db_if_needed` keep reading the official frame only.
- `_averages_memo`, `_rankings_memo`, `_response_memo` become per-mode. They
  are single-slot today and keyed on frame identity; alternating live and
  official requests would otherwise evict each other on every request.
- Keep official-frame identity stable: when a 200 arrives whose parsed totals
  `.equals()` the cached frame (during games the payload will change every
  poll while `valuesByStat` does not), keep the old object — same trick
  `get_players_df` already uses. Otherwise rankings/heatmap would be rebuilt
  every 30 s all evening.
- DB-fallback mode (`data_date` set, ESPN down) ⇒ live disabled.
- Any overlay failure ⇒ serve official with `live.active = false`. Live can
  never turn a 200 into a 5xx.
- Kill switch: `LIVE_STANDINGS_ENABLED` (default off in production until the rollout checks are clean).

### 3.3 The morning hand-over (the risky moment)

Timeline in Israel time: games 02:00–08:00 → all final ~08:00 → ESPN run
~10:15 (period P → P+1, `valuesByStat` absorbs P).

- 08:00–10:15: every game is final, the overlay is the complete day P and
  stops changing. **The site is already correct ~2 hours before ESPN is.**
- At ESPN's run the official payload reports P+1; the overlay is selected by
  that same payload's period, so it becomes the (empty) overlay for P+1 in the
  same computation. There is no moment when both layers contain day P ⇒ no
  double count on our side.
- Guard G1 (ESPN-side non-atomicity): the overlay for period P is applied only
  if `standingsUpdateDate` is earlier than P's first tip (already available
  from `parse_schedule(...).period_lock`). If the period rolled but standings
  did not, or the reverse, we fall back to official and log it.
- Guard G2 (reconciliation, permanent): when the official frame changes,
  compare `official_new − official_old` with the last overlay of the closed
  period, per team and stat. Log `live-reconcile ok` or the diffs, expose the
  last result in `/health`. Small diffs are legitimate ESPN stat corrections;
  anything else is a bug signal.

### 3.4 Per-game averages during games

GP rises by 1 the moment a player checks in, while his stats are still
partial, so live per-game averages would dip mid-game and recover. Since
averages are this site's headline number, the overlay comes in two flavours
from the same lines:

- **in-progress** (all started games) → totals view, team daily roster.
- **settled** (final games only) → per-game averages and averages rankings;
  they step forward as each game goes final and are never biased.

The response carries how many games are still in progress so the UI can say
"2 games in progress not yet counted in averages". (Decision for you: this is
my recommendation; the alternative is to show in-progress averages with a
warning.)

## 4. Where it plugs in

| Page / consumer | Source today | Change |
|---|---|---|
| Rankings (season view) | `memo_response('rankings')` | live=True; response gets `live` block; LIVE badge; existing movers show "tonight" vs this morning's official |
| Rankings with date range | DB snapshot deltas | when the range ends today, add the overlay to the end snapshot |
| Today: league summary, top teams, league averages | `get_averages_df` / `get_rankings_df` | live=True |
| Today: rank movers, `rank-changes` | DB, two latest periods | official day-over-day stays; adds a Tonight view: live movers vs this morning |
| Analytics heatmap (season) | `memo_response('heatmap')` | live=True; values and ranks update, GP shows "+N" for games counted tonight; no outlines or arrows |
| Team detail header (totals, averages, ranks) | `get_all_dataframes` | live=True |
| Team detail slot usage | `statBySlot` | + overlay `per_slot_gp` |
| Team detail Daily (roster-day, today) | `mRoster`, 5 min TTL, status `scheduled/played` | in-game lines, `live`/`final` status, 60 s; use ESPN period instead of `eastern_today()` |
| Team roster season/last-N stats, Players, Player Rankings, Trade, FA report, Trends | `kona_player_info` / `fs_player_games` | unchanged by this plan. Checked 2026-11-13 during games: ESPN's `kona_player_info` season stats do include games in progress, **but the app does not show them**: `merge_windowed_players_df` replaces ESPN's numbers with the `fs_player_games` totals for every player who has a game stored, for the season period too. So player-level pages (season stats, game log, Trends, custom ranges) update only with the morning nightly job. Consequence once this plan ships: tonight's line shows live on Box Scores and the team's Daily roster, and reaches the player pages in the morning. Left as is for now. |
| Standings race / over-time charts | DB | stored points unchanged; adds a dashed live point for tonight |
| Estimator | DB snapshot, daily | unchanged, by design |
| Box Scores, My Players | site API, already live | unchanged; shares its cache with Source B |
| Share cards (rankings, team) | page data | stamp "Live" when the data is live |
| DB sync, estimator scheduler, model nightly, injury scheduler, ADP | official / own sources | unchanged |

Response contract addition (all live-capable endpoints):

```json
"live": { "active": true, "period": 24, "as_of": "...",
          "games_total": 4, "games_live": 2, "games_final": 1,
          "official_updated_at": "..." }
```

Frontend: RTK Query `pollingInterval: 60_000` only while
`live.active && games_live > 0`, with `skipPollingIfUnfocused`. One shared
`LiveBadge` next to the existing `EspnUpdatedNote` ("Live · 2 of 4 games in
progress" / "Final · ESPN official pending"). Desktop and `src/mobile` both.

## 5. Performance

- Off-hours: empty overlay, same frame object, no extra ESPN calls, no extra
  compute. Identical to today.
- During games, Source A: **zero** additional ESPN requests (data rides the
  existing 30 s poll). Source B: one scoreboard + one summary per live game
  per 60 s, shared with Box Scores' existing cache and single-flight.
- Compute: summing ~190 rows; rankings/heatmap rebuild only when the overlay
  version changes (≤ once a minute), then served from the per-mode memo.
- After the last final the overlay is frozen; cost returns to zero.
- No new tables, no migrations, nothing to backfill; a restart mid-slate just
  recomputes the overlay from ESPN.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Live numbers leak into DB snapshots → corrupts estimator, date ranges, over-time, movers permanently | Default `live=False`; live frame never enters `totals_cache`; test that `_sync_db_if_needed` only ever receives the official frame |
| Double count / gap at the morning hand-over | Period chosen from the same payload as the baseline; guards G1, G2 |
| Mid-game averages misleading | settled vs in-progress flavours (§3.4) |
| GP caps late in the season | rule 3; unit-tested with a capped fixture |
| Player dropped/traded after his game locked | ESPN keeps him on that period's roster; covered by G2, fixture test |
| Stat corrections after final | official overwrites next morning; G2 logs it |
| ESPN throttling (it already returns bad payloads when polled every few seconds) | no polling faster than existing 30 s / 60 s TTLs; single-flight; negative cache |
| Screenshots of live standings mistaken for official | LIVE pill, stamped share cards |
| Existing latent issue found on the way: `_sync_db_if_needed` writes day P's snapshot the first time it sees period P+1, assuming `valuesByStat` already includes P | apply guard G1 there too (write only when `standingsUpdateDate` is after P's games) |
| Existing: `roster_day_service` / `fantasy_roster_for` derive "today" from the Eastern date, so between 00:00 ET and ESPN's roll the Daily view shows tomorrow while games are live | step 3 of the plan switches them to ESPN's period |

Verdict: for standings, heatmap, Today and team header this is a pure
improvement **provided** the two-layer rule holds; the only places with real
regression potential are the DB writers and the morning hand-over, and both
are covered by defaults plus guards.

## 7. Plan

Everything below is in scope and built as **one delivery** behind
`LIVE_STANDINGS_ENABLED`. Nothing here is optional. The numbering is build
order, not separate releases.

**1. Live overlay and safety net**
- Live probe result (§2) picks the data source; record a live fixture.
- `LiveOverlayService` + parsing; guards G1 and G2; overlay status in `/health`.
- With the flag off the overlay still runs in shadow and logs the morning
  reconciliation, so production hand-overs are checked before anything shows.
- Tests: the season-rebuild check from §2 as a fixture test; empty overlay ⇒
  identity; ratio rebuild; cap; hand-over simulation; DB sync receives
  official only; per-mode memo does not thrash.

**2. Live standings**
- `live=` plumbing in `DataProvider`, per-mode memos, stable official identity.
- Rankings (season), Today (league averages, Top 5), heatmap (values update and
  GP shows "+N"; no other markers), team header + slot usage.
- `live` block in responses; tappable `LiveBadge` on every affected page;
  movers and "GP +N" switch to "tonight" while live; conditional polling;
  share-card stamp. Desktop and mobile components.

**3. Live team roster day**
- Roster-day "today" on ESPN's period instead of the Eastern date; in-game
  lines and `live` / `final` status; "Starters (Today, so far)" row; 60 s.

**4. Ranges, movers, race**
- Rankings and heatmap date ranges that end today include tonight.
- Today's Rank movers: Tonight / vs yesterday switch.
- Rankings Over Time: dashed live point until ESPN confirms it.
- G1 hardening of `_sync_db_if_needed`.

**Rollout:** staging with the flag on through a few live slates and morning
hand-overs; production with the flag off (shadow logs only); flag on in
production once both are clean.

## 8. Decisions (approved 2026-11-12)

1. Averages during games count finished games only; totals include games in progress.
2. Live is the default view, marked with a badge. No Live/Official toggle.
3. All items are in scope; none are optional.
4. Everything is built together as one delivery (see §7). The shadow check
   runs alongside it rather than before it: nothing user-visible is turned on
   in production until the reconciliation logs are clean (see decision 9).
5. Updates reach the browser by polling (see §9), not manual refresh only.

Mockups of every affected screen: https://claude.ai/artifact/APmBcZdJicKURzHzHHEDwi

6. Mobile is in scope for the build (its pages are separate components), but
   gets no extra mockups beyond the standings screen. On mobile the badge is
   shortened to "LIVE · 2 of 4" and the "averages count finished games only"
   note opens from a tap on the badge instead of a permanent line.
7. The live UI reuses the existing movers (▲/▼ and "GP +N"): while a slate is
   live or final-but-unofficial they mean "change tonight" against this
   morning's official standings, and return to "since last night" after
   ESPN's update.

8. The live badge is tappable on every page it appears on (desktop and
   mobile) and opens tonight's games with their status, plus when ESPN's
   official data was last updated. On the team page the badge stays in the
   header, and each section subtitle (Team statistics, Slot usage, Roster)
   carries its own short live status.

9. No separate waiting period before implementation (the shadow check no longer comes first). Everything is built in one go behind
   `LIVE_STANDINGS_ENABLED` and verified after it is merged:
   - staging/dev: flag on, real league, watched through a few live slates and
     morning hand-overs;
   - production (master): flag off. The live calculation still runs in shadow
     there and logs the morning reconciliation (G2), so production hand-overs
     are checked without anything being shown;
   - the flag is turned on in production once the staging slates and the
     shadow logs are clean.
   The live layer writes nothing to the database, so a staging service that
   shares the production database cannot corrupt it through this feature.

### What each view counts while games are in progress

| View | A player whose game is still in progress | A player whose game is final |
|---|---|---|
| Averages: values, category ranks, roto points, heatmap, Top 5, movers | not counted yet (neither his stats nor his GP) | counted |
| Totals: values, category ranks, roto points | counted, stats so far and GP +1 | counted |
| Team page Daily roster and "Starters" row | shown live | shown |
| Slot usage | counted (+1 live) | counted |

FG% and FT% follow the view they are shown in: in the Averages view they are
built from finished games only, in the Totals view from everything so far.
Once every game of the night is final the two views cover the same games.

## 9. Polling vs refresh

Polling is the low-risk option here, because the browser polls **our** backend,
never ESPN. ESPN load is set by the backend TTLs (30 s league payload, 60 s box
scores) and does not grow with the number of open tabs or the poll rate.

- Interval 60 s, only while the response says `live.active && games_live > 0`.
  Before tip-off, after the last final and all day long there is no polling.
- `skipPollingIfUnfocused`: hidden tabs do not poll; a tab that regains focus
  refetches once.
- A poll that changes nothing costs one memo hit on the backend. To make it
  nearly free on the wire too, add the live endpoints to `HttpCacheMiddleware`
  so an unchanged response is an empty 304. `last_updated` must stop changing
  on every memo hit for that to work (today `memo_response` stamps a fresh
  `last_updated` per request).
- Box Scores already polls at 60 s in production with the same pattern.
- Manual refresh keeps working and returns live data either way.
