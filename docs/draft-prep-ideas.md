# Draft Prep — Research & Idea Bank

Research notes + concept list for adding draft-prep tooling to the app.
Context: 12-team, 8-category **roto** ESPN league. We already own a lot of the
hard machinery (nightly per-stat ML projections, feature store, Monte Carlo
standings estimator, z-score ranker, trade analyzer, injury poller, depth
charts, schedule service) — most ideas below are re-aimed versions of assets we
already have, pointed at draft day instead of in-season.

---

## Part 1 — What the market already does (competitive scan)

### Basketball Monster
- Paid, the "serious" tool. Its core is a live **Draft Tracker**: you mark picks
  as they happen and it re-ranks the board in real time.
- Punt model is the interesting part: three parallel value columns —
  `LeagV` (value with no punt), `PuntV` (value recomputed under your punted
  categories), `Punt+` (the delta). Position value and dynasty value re-rank
  under the punt too.
- Recent versions expanded to showing up to 10 categories per player and
  format-specific values (roto vs H2H vs points).
- Weakness we can exploit: it's generic. It doesn't know *your* league's 11
  opponents, their tendencies, or your keeper situation.

### Hashtag Basketball
- Free tier, huge reach. The famous piece is the **customizable z-score ranker**
  (punt toggles, per-category weights, GP/MPG filters) — we already have our own
  version of this in Player Rankings.
- Also: **ADP page aggregating multiple platforms**, schedule grids (games per
  week, back-to-backs, playoff-week schedule strength), team defense vs.
  position, playing-time trend tracking.
- Weakness: everything is season-long-average based. No uncertainty, no
  simulation, no league-specific context.

### FantasyPros Draft Wizard
- **Mock Draft Simulator** (snake + auction), instant AI opponents, no waiting.
- **Draft Assistant** — live, syncs to your real draft, suggests picks.
- **Pick Predictor** — % chance each player survives to your next pick. This is
  the single most valuable primitive in the whole space and it's cheap to build
  from ADP + variance.
- Consensus rankings from 100+ experts with tiers; keeper support (assign
  keepers by round or by auction dollar).

### Others worth knowing
- **RotoWire / LineupExperts** — auction/salary-cap value generators, ADP pages.
- **Fanwarroom / RotoBaller** — "draft kits": tiered rankings, ADP tracker,
  punt builds, rookie rankings, printable cheat sheets. Mostly packaging.
- **Academic**: Zach Rosenof's papers are the most rigorous thing published on
  category-league drafting.
  - *G-score* (arXiv 2307.02188): z-score is only correct if future performance
    is known exactly. Once you account for week-to-week variance, the right
    static metric divides by a variance term that includes performance
    uncertainty, not just cross-player spread. Beats z-score in simulation
    (mostly H2H).
  - *H-scoring* (arXiv 2409.09884): dynamic — value depends on who you already
    drafted. Beats both.
  - *Roto optimization* (arXiv 2501.00933): roto's objective is intractable
    directly; proposes a tractable approximation, and it turns out to contain an
    implicit reward for **balance** — mathematical backing for "don't punt hard
    in roto." **This is our league's format. This paper is the spine of the
    whole feature.**

---

## Part 2 — Data sources

### Already ours (free, in-repo)
- Nightly ML models → per-stat projections (PTS/REB/AST/STL/BLK/FG3M/FGM/FGA/FTM/FTA)
  plus a reconciler. Gives us **our own projections** — nobody else's terms of
  service apply, and we can output distributions, not just means.
- Feature store, player bio parquet, depth charts, NBA injury-report PDF poller,
  schedule service, Monte Carlo estimator.

### ESPN (unauthenticated, already how we get league data)
- `?view=mDraftDetail` — every pick of a completed draft (already used by
  `draft_report_service`). Includes auction price paid in auction leagues.
- `?view=mSettings` — roster slots, scoring categories, draft type (snake/auction),
  auction budget, keeper rules, draft date/order. Needed to make any tool
  league-accurate instead of hardcoded.
- `kona_player_info` view + `X-Fantasy-Filter` header — per-player
  `ownership.averageDraftPosition`, `ownership.percentOwned`,
  `ownership.percentChange`, and `draftRanksByRankType` (STANDARD / PPR-equivalent).
  **This is free live ADP straight from the platform we actually draft on** —
  strictly better than a scraped third-party ADP for our purposes.
- `fantasy.espn.com/basketball/livedraftresults` — public live draft trend page.
- Historical: same endpoints with prior `seasonId` → multi-year draft history for
  our own league (leverage for the manager-tendency ideas below).

### Other platforms
- **Sleeper** — fully public, no auth, no token. `GET /v1/players/nba` (~5MB,
  cache daily), plus `/draft/<id>`, `/draft/<id>/picks`, `/league/<id>/drafts`.
  Free ADP-ish signal and a second opinion on player metadata/IDs.
- **Yahoo** — real REST API but OAuth2 + access agreement required. Draft results
  endpoint includes auction price. Worth it only if we ever want cross-platform ADP.
- **NBA.com via `nba_api`** — DraftBoard, CommonPlayerInfo, PlayerCareerStats,
  hustle stats (deflections, screen assists, box outs — good for STL/BLK priors),
  LeagueDashLineups for lineup-combination minutes.
- **balldontlie** — clean REST NBA API, free tier, good fallback/cross-check.

### Public analytics (free, high signal) — *now out of scope, kept for reference*

The projection sources below were researched before the no-projections decision.
They are not needed for any Part 3 idea; left here so we don't re-research them
if scope ever changes.

- **DARKO** (darko.app) — daily-updated per-stat, per-minute projections for every
  player, Kalman-filtered. The best free projection source in existence and it
  outputs *box-score categories*, which is exactly our 8-cat need. Ideal as a
  blend partner / sanity check against our own models.
- **EPM** (dunksandthrees.com/epm) — impact metric, useful as a prior on role and
  minutes retention rather than on raw counting stats.
- **Craftednba** — meta-metrics and role/archetype data.
- ADP aggregators (Hashtag, FantasyPros, RotoWire, FantasySP) — no APIs; HTML
  scrape only, and their ToS is unfriendly. Prefer ESPN's own ADP.

### Injury / availability
- Our existing NBA injury-report PDF poller.
- `nbainjuries` package for historical injury data — used here as a **historical
  record** of games missed (idea #11), not as a predictive durability prior.

---

> **Scope constraint (owner decision).** No live draft assistance — nothing that
> tells you who to pick, ranks a board for you, or runs on the clock. No player
> projections or projection-derived valuation surfaced as a product. Everything
> below is **retrospective, descriptive, or social**: what our league's drafts
> actually did, how they actually turned out, and draft-night tooling that
> records and entertains rather than advises.
>
> Practical upside: this set needs almost no new data. `view=mDraftDetail` across
> past `seasonId`s plus the stats we already store covers nearly all of it. No
> DARKO ingest, no ADP scraping, no model risk, nothing that goes stale or gets
> embarrassingly wrong in public.

## Part 3 — Ideas

### 1. League Draft Archive
- Every draft our league has ever run, in one browsable place: season → round →
  pick, with team names resolved and the current `DraftReport` page generalized
  from "this year" to "any year."
- Pull once per season from `view=mDraftDetail` with a historical `seasonId`,
  persist to Postgres so we stop depending on ESPN keeping old seasons reachable.
- Filters that make it fun rather than a table dump: by manager, by player, by
  round, by NBA team.
- Player-centric view: "Jokic has been drafted 5 times in this league, average
  pick 2.4, by 3 different managers."
- Foundation for essentially every other idea here — build first.

### 2. Hindsight Report Card
- Grade each pick by what it **actually returned**, using realized season stats —
  no projections anywhere in the loop.
- Metric: the player's realized roto/z value that season vs. the average value of
  the pick slot he was taken at. Positive = steal, negative = bust.
- Per team: total surplus, best pick, worst pick, "the pick that cost you the title."
- Per season: league-wide steals and busts leaderboards.
- Honest and unarguable, because it's history rather than a forecast — the exact
  opposite posture from the projection tools.

### 3. Manager Draft DNA
- A profile page per manager, built from every draft they've made:
  - **reach index** — average pick delta vs. ADP (or vs. the league's own
    consensus ordering, so it works even without external ADP),
  - **positional & NBA-team bias** — the guy who always drafts Nuggets, quantified,
  - **category lean** — which cats their drafted rosters consistently over-index,
  - **rookie appetite**, **age curve preference**, **injury-risk appetite**,
  - **loyalty index** — players they draft over and over.
- Head-to-head comparison view, because that's what gets pasted into the group chat.
- Year-over-year drift: has he actually changed, or does he say that every year?

### 4. Draft Slot & Round Economics
- What is pick #1 actually worth *in our league*? Historical realized value by
  draft slot and by overall pick number.
- Round-by-round hit rate: what fraction of round-N picks returned top-N value.
- **The cliff** — where in our drafts value actually falls off, measured, versus
  where everyone assumes it does.
- Slot fairness audit: does drafting 1st vs 12th correlate with final standings
  across our seasons? Settles a recurring argument with data.
- Snake-turn analysis: the 1.12/2.01 back-to-back — worth it here or not?

### 5. League Market vs. The Public Market
- Compare our league's actual pick order to ESPN's public ADP for that season.
- Output: **who our room collectively overrates and underrates**. "This league
  drafts Celtics ~9 picks earlier than the national average."
- Per-manager version of the same: who trades most on hype, who is most contrarian.
- Purely descriptive market comparison — no forecast, no advice.
- Only needs ADP as a historical snapshot; if we start capturing ESPN ADP once a
  season now, this compounds in value every year.

### 6. Draft Replay — "What If"
- Rewind the draft, swap picks, and re-run the season **on actual box scores** —
  realized stats, not projections. Fully deterministic hindsight.
- "If you'd taken Wembanyama instead at 1.04, you finish 2nd instead of 7th."
- Alternate-universe modes: reverse the draft order, redraft in realized-value
  order ("the perfect draft"), or shuffle managers' picks between teams.
- Reuses the roto standings math we already have, fed different rosters.
- Painful, hilarious, and by far the most shareable thing in this list.

### 7. Draft Prediction Game (fits the existing Minigames module)
- Before the draft, every manager submits predictions: first overall pick, first
  guard off the board, where a given player goes, who reaches hardest.
- Auto-scored against the real draft as picks land; live leaderboard on draft night.
- Slots straight into `app/minigames/` and the existing leaderboard table — this
  is the cheapest idea here by a wide margin.
- Side bets and props ("over/under 4.5 rookies drafted") for extra chaos.
- Turns draft night into a shared event without giving anyone an edge.

### 8. Draft Trivia
- Another minigame, sourced entirely from the archive: "Who drafted Sabonis in
  2023?", "What round did Maxey go last year?", "Whose draft is this?" (show a
  roster, guess the manager).
- Difficulty scales naturally as the archive deepens — content generation is free.
- Same leaderboard plumbing as `who_am_i` and `streak`.

### 9. Draft Order Lottery
- Run the draft-order lottery in-app with a provably-fair seed (publish the hash
  beforehand, reveal the seed after) and an animated reveal.
- Configurable weighting: pure random, inverse-standings, or lottery-with-odds.
- Permanent record of every year's order and odds, so nobody re-litigates it.
- Pairs with #4's fairness audit: "here's what the slot you drew has historically
  been worth."

### 10. Draft Night Board (record-keeping only)
- A live page for draft night that **shows the room, not the answers**: pick
  ticker, who's on the clock, the 12-team roster grid filling in, positional
  shape per team.
- Zero recommendations, zero rankings, zero availability probabilities — a
  scoreboard, not a coach.
- Works whether we draft on ESPN (poll `mDraftDetail`) or manually.
- Ends with an auto-generated shareable recap card per team.

### 11. Availability Ledger
- What each draft pick **actually delivered in games played** — historical, not a
  durability forecast.
- "Team X drafted 4 players who missed 25+ games; that's where the season went."
- Per-round view: are late-round picks actually healthier, or just less used?
- Reuses our injury data as a historical record rather than a predictive input.

### 12. Keeper Ledger
- Record of every keeper decision: who was kept, at what round/price, and what
  they returned that season.
- Retrospective surplus per keeper — was it a good keep, decided after the fact.
- Multi-year: which managers get the keeper call right consistently.
- Record-keeping, not valuation — no "who should you keep" recommendation.

### 13. Roster Construction Fingerprints
- Descriptive post-draft anatomy of each team: positional shape, NBA-team
  concentration, age distribution, total scheduled games, back-to-back exposure.
- Cross-season: which construction shapes have actually won this league?
- All computed from picks + schedule + realized stats — nothing forward-looking.

### 14. Draft Recap Writer
- LLM-generated narrative recap after the draft, grounded in the archive:
  "Manager 3 reached three rounds early on his fourth Nugget in five years."
- Every claim traces back to a number in our data — the model is a writer over
  our facts, not an analyst making calls.
- End-of-season companion piece: how the recap aged, using #2's hindsight grades.
- Reuses the OpenAI wiring that's already in the repo but currently dormant.

### 15. The Record Book
- All-time draft leaderboards: biggest steal ever, biggest bust ever, best draft
  class, worst first round, longest streak of hitting on round-1 picks.
- Per-manager career draft stats, presented like a sports reference page.
- Annual awards, auto-issued at season end from #2's grades.
- Cheap to build once the archive and hindsight grades exist, and it's the thing
  that makes the league feel like it has a history.

---

## Part 4 — Suggested sequencing

1. **Draft Archive** (#1) — persist multi-season `mDraftDetail`. Everything
   depends on it, and it's a day of work.
2. **Hindsight Report Card** (#2) — join picks to realized stats. This is the
   analytical core.
3. **Prediction Game** (#7) — cheapest, most fun, drops into the existing
   minigames module.
4. **Manager DNA** (#3) and **Slot Economics** (#4) — the two analysis pages that
   come almost free once 1+2 exist.
5. Then: Replay (#6) for the wow factor, Record Book (#15) and Recap (#14) for
   the season-long hook, Draft Night Board (#10) and Lottery (#9) as draft-day
   infrastructure.

Note on timing: #2, #3, #4 and #5 all get better with every season captured, and
worse the longer we wait to start capturing — ESPN's historical endpoints and
public ADP snapshots are not guaranteed to stay available. Archiving early is
the one thing here that's time-sensitive.

---

## References
- Basketball Monster draft tracker & punt values — https://basketballmonster.com/drafttrackertutorials.aspx
- Hashtag Basketball ADP — https://hashtagbasketball.com/fantasy-basketball-adp
- FantasyPros Draft Wizard — https://draftwizard.fantasypros.com/basketball/draft-tools/
- ESPN live draft results — https://fantasy.espn.com/basketball/livedraftresults
- ESPN endpoint reference (views, X-Fantasy-Filter) — https://ffscrapr.ffverse.com/articles/espn_getendpoint.html
- espn-api (Python, basketball support) — https://github.com/cwendt94/espn-api
- Sleeper API docs — https://docs.sleeper.com/
- Yahoo Fantasy Sports API — https://developer.yahoo.com/fantasysports/guide/
- nba_api — https://github.com/swar/nba_api
- balldontlie — https://nba.balldontlie.io/
- DARKO — https://www.darko.app/about
- EPM (Dunks & Threes) — https://dunksandthrees.com/epm
- Historical injury data — https://github.com/mxufc29/nbainjuries
- Rosenof, *Static quantification of player value* (G-score) — https://arxiv.org/abs/2307.02188
- Rosenof, *Dynamic quantification* (H-scoring) — https://arxiv.org/html/2409.09884
- Rosenof, *Optimizing for Rotisserie Fantasy Basketball* — https://arxiv.org/abs/2501.00933
- Auction value / inflation mechanics — https://www.rotowire.com/basketball/article/how-fantasy-basketball-auction-values-work-97124
