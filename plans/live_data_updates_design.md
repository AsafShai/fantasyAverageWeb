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

### Open question (cannot be observed at 2 PM ET)

Does `rosterForCurrentScoringPeriod[].player.stats` (or `mRoster` for the
current period) carry **in-progress** lines during games, or only after the
game is final? `stats` is `[]` pre-game. A probe is scheduled for 01:30 UTC
tonight during live games; this section will be updated with the answer.

It changes only *where the day's lines come from*, not the design:

- **Source A (preferred if live lines exist):** the league payload we already
  poll. Zero new ESPN requests, ESPN's own fantasy numbers, GP included.
- **Source B (works regardless):** site-API box scores for started games (the
  cache Box Scores already fills) joined to the lineup slots from the league
  payload. `GP = 1` when the player has minutes.

The overlay service takes "today's lines per player" behind one function, so
either source — or A with B as cross-check — plugs in.

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
- Kill switch: `LIVE_STANDINGS_ENABLED` (default off until Phase 1 ships).

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
| Rankings (season view) | `memo_response('rankings')` | live=True; response gets `live` block; LIVE pill; optional per-team "tonight" delta vs official |
| Rankings with date range | DB snapshot deltas | Phase 3 (optional): when the range ends today, add the overlay to the end snapshot |
| Today: league summary, top teams, league averages | `get_averages_df` / `get_rankings_df` | live=True |
| Today: rank movers, `rank-changes` | DB, two latest periods | unchanged (official day-over-day). Phase 3: "live movers vs this morning" |
| Analytics heatmap (season) | `memo_response('heatmap')` | live=True |
| Team detail header (totals, averages, ranks) | `get_all_dataframes` | live=True |
| Team detail slot usage | `statBySlot` | + overlay `per_slot_gp` |
| Team detail Daily (roster-day, today) | `mRoster`, 5 min TTL, status `scheduled/played` | Phase 2: in-game lines, `live`/`final` status, 60 s; use ESPN period instead of `eastern_today()` |
| Team roster season/last-N stats, Players, Player Rankings, Trade, FA report, Trends | `kona_player_info` / `fs_player_games` | unchanged (player-level; ESPN and the nightly model update these overnight) |
| Standings race / over-time charts | DB | unchanged. Phase 3: optional dashed "live" point |
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
| Existing: `roster_day_service` / `fantasy_roster_for` derive "today" from the Eastern date, so between 00:00 ET and ESPN's roll the Daily view shows tomorrow while games are live | Phase 2 switches them to ESPN's period |

Verdict: for standings, heatmap, Today and team header this is a pure
improvement **provided** the two-layer rule holds; the only places with real
regression potential are the DB writers and the morning hand-over, and both
are covered by defaults plus guards.

## 7. Plan

**Phase 0 — verify, shadow, no user-visible change**
- Live probe tonight (open question, §2); record a live fixture.
- `LiveOverlayService` + parsing, behind the flag, not wired to any response.
- Log G1/G2 every morning for ~a week; add overlay status to `/health`.
- Tests: the season-rebuild check from §2 as a fixture test; empty overlay ⇒
  identity; ratio rebuild; cap; hand-over simulation; DB sync receives
  official only; per-mode memo does not thrash.

**Phase 1 — live standings**
- `live=` plumbing in `DataProvider`, per-mode memos, stable official identity.
- Rankings (season), Today summary, heatmap, team header + slot usage.
- `live` block in responses, `LiveBadge`, conditional polling, share-card stamp.
- Ship with `LIVE_STANDINGS_ENABLED` on staging first.

**Phase 2 — live team roster day**
- Roster-day "today" on ESPN's period; in-game lines and `live` status; 60 s.

**Phase 3 — optional**
- Date ranges ending today; live movers vs this morning; live point on the
  standings race; G1 hardening of `_sync_db_if_needed`.

## 8. Decisions needed

1. Averages during games: settled-only (recommended) or in-progress with a warning.
2. Live as the default view with a badge (recommended), or an explicit Live/Official toggle on Rankings.
3. Whether Phase 3 items are wanted at all.
