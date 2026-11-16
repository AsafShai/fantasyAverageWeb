# With / Without — Implementation Plan

Design: "League Feature Concepts" canvas, artboards *With / Without · Desktop* and
*With / Without · Mobile*. Roto Leverage and the "my fantasy team" mode in that
file are **out of scope**.

**Question the page answers:** pick an NBA team and 1–3 of its players. How did
each teammate play in games those players sat vs. games they played?

Current season only. Nothing about past seasons is stored or shown.

---

## 1. Decisions (settled)

| Topic | Decision |
|---|---|
| Who played | ESPN box scores already in `fs_player_games`. Any minutes count as played, even a 2-minute stint. |
| Who was on which team, and when | NBA Player Movement feed (`stats.nba.com/js/data/playermovement/NBA_Player_Movement.json`) turned into per-player **stints**. ESPN box-score appearances override the feed when they disagree. |
| "Sat" | The game falls inside one of his stints for that team, and he has no played row. No reason is needed; injury, coach's decision, suspension and G League all count as sat. |
| Two-way players | Counted like everyone else (G League nights = sat). Tagged "Two-way" in the picker; nothing hidden. |
| FG% / FT% | Total makes ÷ total attempts within each group, never an average of per-game %. |
| Z Δ | The per-game line of each group, scored with `scoreAgainstPool` against the default Player Rankings pool, equal weights over the 8 categories. Z Δ = without total − with total. |
| Small samples | Tag "small" under 3 "without" games. No hiding, no re-sorting. |
| Noise check | Not in v1. Every value shows the same way. |
| Trade Analyzer | Opens with both players pre-filled (new URL params on the Trade page). |
| Route / flag | `/with-without` behind `VITE_FF_WITH_WITHOUT`, like League Activity. |
| Injury-report PDFs | Not a roster source. Only the existing "OUT today" pill and filter use them. |

Verified before planning (Nov 16, 2026):
- The feed downloads from Render staging: `GET /health?probe=nba_movement` gave 200, 4.3 MB, 10,144 rows, 438 ms (PR #547).
- Replaying the feed for the 597 players in 23 games (Nov 13–15) gave the right team for 593. One feed entry was missing (Wiseman to NYK), and 2 names didn't match ("Yang Hansen" / "Hansen Yang", "Chris" / "Christopher Cenac Jr.").

---

## 2. Backend

### 2.1 Table `nba_roster_stints` (new migration)

```sql
CREATE TABLE IF NOT EXISTS nba_roster_stints (
    season      TEXT    NOT NULL,
    player_id   BIGINT  NOT NULL,      -- ESPN athlete id
    team_id     BIGINT  NOT NULL,      -- ESPN team id (1-30)
    start_date  DATE    NOT NULL,
    end_date    DATE,                  -- NULL = still on the team
    two_way     BOOLEAN NOT NULL DEFAULT FALSE,
    source      TEXT    NOT NULL,      -- 'feed' | 'feed+box' | 'box_only'
    PRIMARY KEY (season, player_id, team_id, start_date)
);
CREATE INDEX IF NOT EXISTS idx_nba_roster_stints_team ON nba_roster_stints (season, team_id);
```

`box_only` means the player's name never matched the feed, so the stint runs
from his first to his last box-score appearance. The UI shows these players as
"approx".

The table is rebuilt from scratch every night (delete the season, then insert)
in one transaction. It's small (about 600 rows), so the rebuild is cheap.

### 2.2 `app/services/roster_stints/` (new)

- **`feed.py`:** download the feed with `httpx` (30 s timeout, 3 retries with
  backoff). Parse each row into
  `(date, type, nba_team_slug, nba_player_id, player_slug, description)`, and
  skip rows with no `PLAYER_ID`.
- **`replay.py`:** pure functions that turn feed rows and box appearances into stints:
  1. **Opening-night roster:** replay every row before the season's first game
     date (this needs pre-season history, e.g. Haliburton's last row is from
     2023). A signing, a trade "received" row or a waiver claim sets the team.
     A waive releases the player from that team.
  2. **10-day contracts:** a signing whose description contains "10-Day"
     closes after 10 days unless a newer row comes first.
  3. **`ContractConverted`:** the team stays the same, and `two_way` follows
     the new contract type.
  4. **`two_way`:** true while his latest signing says "Two-Way Contract".
  5. **This season's rows** close the current stint and open the next.
  6. **Box-score correction:** an appearance for team T on day D (played, or
     an ESPN DNP entry if §2.4 ships) guarantees T covers D. A stint starts at
     the earlier of the feed's join date and his first T appearance, and ends
     at the earlier of the feed's leave date and his first appearance for
     another team.
- **`matching.py`:** map an NBA player to an ESPN id **within one team only**.
  Normalize names (accents, punctuation, `Jr/Sr/II/III/IV`), then try in turn:
  exact match, swapped name order, a small first-name alias list
  (Chris/Christopher, Nic/Nicolas…), last name when it's unique on that team.
  Anyone still unmatched gets `box_only` stints and goes into the health
  output.
- **Team mapping:** a fixed table from NBA team slug/id to ESPN team id, added
  next to `model_stats_inference/espn/teams.py`. Includes `sixers` → PHI.

### 2.3 Scheduling

- **When:** run the rebuild at the end of `ModelNightlyService.run_catchup`,
  after the night's box scores are in. Run it even when no new nights were
  processed, since transactions happen on days without games.
- **On failure:** a fetch or parse failure keeps yesterday's stints, logs an
  error, and shows on `/health`.
- **Backfill:** none needed. The first run rebuilds the whole season.

### 2.4 Store ESPN DNP entries (small, optional in v1)

`games.py` currently skips `didNotPlay` athletes. Add a table
`fs_player_dnp (player_id, game_id, team_id, game_date, season, reason)` and
write those entries during ingest. Their uses:
- an extra box-score presence signal for §2.2 step 6
- an optional reason under a "Sat" cell ("Coach's decision", "Right knee").

Existing nights get these entries only if they're re-fetched; the rest of the
feature doesn't depend on it. **Recommend in v1 only if it fits; otherwise phase 2.**

### 2.5 API

**`GET /api/nba/with-without/teams`**
- Returns the 30 teams with a `has_out_today` flag, from the existing injury
  status data.

**`GET /api/nba/with-without/{team_id}`**
- Returns one team's season, all the data the page needs. The page then does
  every split and calculation in the browser, so changing the picks or switching
  between "all of them sat" and "any of them sat" makes no extra requests.

```jsonc
{
  "team_id": 20, "season": "2026-27",
  "games": [ { "game_id": "...", "date": "2026-10-22", "opp": "BOS",
               "home": true, "result": "W 112-104" } ],
  "players": [ {
    "player_id": 3059318, "name": "Joel Embiid", "pos": "C",
    "two_way": false, "approx": false,
    "out_today": { "status": "Out", "note": "Knee" } | null,
    "owner": { "team_id": 9, "name": "Khachapuri’s Team" } | null,   // null = FA
    // one entry per team game, aligned with `games`:
    //   null = not on the team that day
    //   0    = on the team, sat
    //   [min, pts, reb, ast, stl, blk, fg3m, fgm, fga, ftm, fta] = played
    "lines": [ [32, 28, 10, 4, 1, 2, 1, 10, 19, 7, 8], 0, null ]
  } ]
}
```

- **Data:** `fs_team_games` for the schedule, `fs_player_games` for the lines,
  `nba_roster_stints` for the `null` vs `0` split, the injury table for
  `out_today`, and ESPN fantasy rosters for `owner`.
- **Caching:** cached per team until the next nightly rebuild.
- **Health:** `/health?verbose=1` gains a `roster_stints` section: last
  rebuild, feed row count, stint count, number of unmatched/approx players.
- **Probe:** the temporary `?probe=nba_movement` from PR #547 is removed.

### 2.6 Tests

- **`replay.py`** (table-driven): trade mid-season, waive then sign elsewhere,
  10-day expiry, contract conversion, two-way flag, a box appearance with no
  feed row (Wiseman), a player injured from opening night (no appearances
  before game N).
- **`matching.py`:** swapped name order, aliases, suffixes, accents,
  same-surname teammates.
- **Endpoint:** the line encoding, owner/FA, and `out_today`.
- **Validation script** (`scripts/validate_roster_stints.py`, run by hand):
  for every season game, roster size = played + sat on that date. Flag any
  team-game outside 13–18 players.

---

## 3. Frontend

### 3.1 Page `pages/WithWithout.tsx`, route `/with-without`

Matches the desktop artboard:

1. **Step 1:** NBA team select, plus an "Only teams with a player out today" toggle.
2. **Step 2:** pick up to 3 players.
   - Each shows "missed N of M" (M = team games during his stints), an
     "OUT · note" pill and a "Two-way" tag.
   - Sorted by games missed. Players who never missed a game are disabled.
3. **Step 3** (only with 2+ picks): "All of them sat" / "Any of them sat".
4. **"Which games are compared" card:**
   - counts of With / Without / Not used, with the one-sentence explanation
   - the game strip (date, opponent, score, ✓/Sat per picked player, "Counts as")
   - for a picked player who is `approx`, an "approximate roster dates" note.
5. **Teammate table:**
   - Columns: Player · Owner · GP w/ · w/o · MIN PTS REB AST STL BLK 3PM FG% FT% · Z Δ.
   - Sort by any category Δ or Z Δ (default Z Δ).
   - "Free agents only" filter. Cells show Change / With / Without.
   - The viewer's own fantasy players are highlighted.
   - "small" tag under 3 "without" games.
   - A row needs at least 1 with game and 1 without game.
6. **Expanded row:**
   - the with / without / change lines
   - three tabs:
     - **Game-by-game log**
     - **Profile:** links to `/player/:id`
     - **Open in Trade Analyzer:** `/trade` with both players filled in.

Mobile follows the mobile artboard, reusing the existing mobile kit.

### 3.2 Calculation `utils/withWithout.ts` (pure, unit-tested)

- **`splitGames(games, picked, mode)`:** returns `with | without | unused` per
  game. Games where a picked player was `null` (not on the team) are `unused`.
- **`groupLine(lines)`:** per-game averages of the counting stats. FG% = Σfgm/Σfga,
  FT% = Σftm/Σfta, with attempts per game kept for scoring.
- **`zDelta(withLine, withoutLine, pool)`:** turn each group line into a
  `Player`-shaped object and call `scoreAgainstPool(…, 'per_game', equalWeights)`.
- **Pool:** the same reference pool Player Rankings builds with its
  **default** config, taken from `useGetAllPlayersQuery` and
  `computePlayerRankings`. Pull the default config out into a shared constant
  so both pages use exactly the same one, not whatever filters the viewer last
  set on Player Rankings.
- **Footer wording:** "Z Δ = change in fantasy value of his per-game line,
  scored like Player Rankings."

### 3.3 Trade page pre-fill

Add `?get=<playerId>&give=<playerId>` support to `pages/Trade`. It fills
both sides and selects the owning teams. Unknown IDs are ignored.

### 3.4 Wiring

- Flag `FF_WITH_WITHOUT` in `config/featureFlags.ts`.
- Add the route in `App.tsx`, a nav entry under NBA in `navConfig.ts`, and a
  `searchablePages.ts` entry.
- Add RTK Query endpoints in `store/api/fantasyApi.ts`.

### 3.5 Tests

- **`withWithout.ts`:**
  - interleaved absences (games 1 2 3 5 7 played, 4 6 8 sat)
  - all vs. any mode with 2 picks
  - a teammate who sat exactly the without games (row dropped)
  - a picked player traded mid-season (`null` games unused)
  - FG% from totals
  - Z Δ matches `scoreAgainstPool` on hand-built lines.
- **Page:** renders from a fixture response; sorting, filter, expand, the
  Trade link params.

---

## 4. Order of work (suggested PRs)

1. **Stints:** migration, `roster_stints` service, nightly hook, health section,
   tests, validation script. Remove the probe. *Run the validation on staging
   before PR 2.*
2. *(optional)* **DNP entries:** §2.4.
3. **API:** the two endpoints with fixtures and tests.
4. **Frontend:** calculation utils, page (desktop then mobile), Trade pre-fill,
   behind the flag.

---

## 5. Risks and how they're handled

| Risk | Handling |
|---|---|
| Feed missing or late (Wiseman case) | The box appearance opens the stint anyway. |
| Name doesn't match the feed | Matched within one team only. Leftovers become `box_only` + "approx", and are counted in `/health`. |
| Feed blocked or down later | Keep the last good stints; error on `/health`. If Render starts getting 403s, a scheduled GitHub Action could fetch it and write to Postgres. |
| Injured from opening night, never appears | The feed puts him on the team from the start, so his games count as sat. This is the main case the feed exists for. |
| Small samples | Visible "small" tag and the game-by-game log. The page reads as "with vs. without", never "because of". |
| Long one-block absence (e.g. games 1–20) | Not adjusted for. The game strip shows the dates, so the viewer can see the season split. |

## 6. Out of scope (v1)

- Previous seasons.
- The "my fantasy team" mode (roto points with and without a player).
- The noise check.
- Injury-report PDFs as a roster source, and G League labels.
- Opponent or back-to-back adjustments.
