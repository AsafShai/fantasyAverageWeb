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

### Public analytics (free, high signal)
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
- `nbainjuries` package for historical injury data → build a **games-missed prior
  per player** (durability is a top-3 draft-value factor and almost nobody models
  it explicitly).

---

## Part 3 — Ideas

Each idea: what it is, why it wins, what it costs.

---

### 1. Roto-Native Draft Board (the flagship)
- Rankings computed from **our own projections**, not from last year's averages.
- Value metric is the roto objective from Rosenof's roto paper, not plain z-score:
  a player's value is their **marginal effect on expected roto points**, given
  what the rest of the league looks like.
- Balance-aware by construction — the roto objective implicitly penalizes
  lopsided teams, which is correct for our format and is the opposite of what
  every punt-centric tool tells you.
- Three columns side by side so the difference is visible and teachable:
  `Z` (classic, what Hashtag shows), `G` (variance-adjusted), `Roto-V` (ours).
  Sorting by each gives visibly different boards — that contrast *is* the product.
- Cost: medium. Projections exist; the metric is a formula on top of them.

---

### 2. H-Score Live Draft Assistant ("who should I take right now")
- Input: our draft slot, the picks already made (typed, pasted, or auto-synced
  from `mDraftDetail` if we're drafting on ESPN).
- Output at every pick: top-N recommendations where value is **dynamic** — it
  re-scores every remaining player conditional on the roster we've already built.
- Shows *why*: "Sabonis +2.1 roto pts — you're 11th in REB, he's the last
  elite-REB/AST source before your next turn."
- Category-need meter: current projected roto rank in each of the 8 cats,
  updating live as picks land.
- "Reach or wait?" verdict per player, computed from the pick predictor (#3).
- Cost: medium-high. This is the piece Basketball Monster charges for.

---

### 3. Pick Survival Predictor
- For every player: **P(still available at my next pick)**, from ESPN ADP mean +
  an estimated ADP standard deviation.
- Turns the draft board into an expected-value problem: don't take the best
  player, take the one whose (value × probability-of-being-gone) is highest.
- Derived view: **"Last Chance" tier alerts** — "you have 2 of the remaining 4
  elite-BLK sources reachable; after pick 47 there are none."
- ADP variance can be estimated from our own league's multi-year draft history +
  ESPN's live draft results spread, not just guessed.
- Cost: low. Highest value-to-effort ratio in this whole document.

---

### 4. Monte Carlo Mock Draft Simulator (reuse the estimator)
- We already run Monte Carlo standings projections. Point that same engine at a
  *drafted* roster instead of a real one: draft a team in the simulator, then
  immediately see "you finish 3rd, 68% chance top-4, weakest cat is FT%."
- AI opponents drafted three ways so you can rehearse different rooms:
  - **ADP bots** (they take best-available by ESPN ADP),
  - **archetype bots** (punt-FT%, punt-AST, balanced, stars-and-scrubs),
  - **clone bots** — trained on our actual league's past drafts (see #6).
- Run it 1,000 times headless: "from pick 7, which first-round pick maximizes
  expected roto points across all simulated rooms?" — an answer no public tool
  gives you.
- Full-season loop: simulated draft → simulated season → final standings
  distribution. End-to-end, this is genuinely novel.
- Cost: high, but ~60% of the machinery already exists.

---

### 5. Punt Explorer / Build Optimizer
- Pick 0–3 punt categories → the whole board re-ranks (BBM's `PuntV`/`Punt+`
  columns, but free and roto-aware).
- Inverted, and more interesting: **let the tool find the punts**. Given our draft
  slot and ADP, brute-force all category-subset builds and rank them by expected
  roto finish. Output: "from pick 9, punt-FT% is +4.2 roto pts; punt-AST is -1.1."
- Roto-specific honesty: show *why punting is usually wrong in roto* (you cap
  yourself at ~1 point in that cat × 12 teams) and when it isn't.
- Build feasibility check: "this punt build needs 4 of these 9 players; ADP says
  you'll get 2.3 of them."
- Cost: medium.

---

### 6. League Manager Tendency Profiles ("scouting the room")
- Pull our league's draft history for every past season (`mDraftDetail` +
  prior `seasonId`s) and build a profile per manager:
  - reach/value tendency vs. ADP (average pick delta),
  - positional bias, team bias (the guy who always drafts Nuggets),
  - category lean (does he consistently end up punting FT%?),
  - rookie appetite, injury-risk appetite.
- Feeds the mock simulator's clone bots → mock drafts that feel like *our* draft.
- Live during the draft: "Manager 4 has taken a guard in round 1 five years
  running and needs AST — Fox likely goes before your turn."
- Nobody sells this. It's only possible because we have league API access.
- Cost: medium. Data is a single endpoint away.

---

### 7. Keeper / Dynasty Value Calculator
- Value = projected production − draft cost, expressed in roto points per
  round (or per auction dollar).
- Multi-year: discount a 34-year-old's future, credit a second-year breakout,
  with an explicit aging curve.
- Output the clean verdict list: "Keep (surplus +3.4 rd), Toss-up, Let go."
- Extension: **keeper-adjusted ADP** — once the league's keepers are known, the
  real draft board shifts; recompute ADP with kept players removed. Every public
  ADP is wrong for a keeper league and this fixes it in one pass.
- Cost: low-medium.

---

### 8. Auction Mode
- Convert roto values → dollar values (value over replacement, scaled so total
  value = total league budget).
- **Live inflation tracker**: remaining dollars ÷ remaining value. When the room
  overspends early, everyone left gets cheaper — the tool should say so in real
  time and tell you to sit on your hands.
- Nomination strategy: which player to throw out to drain other teams' budgets
  away from the guys you actually want.
- Max-bid calculator per player given your remaining budget and roster slots.
- Cost: medium. Only worth building if we ever run an auction league.

---

### 9. Availability / Durability Model
- Every ranking site projects per-game production and then quietly multiplies by
  a hand-waved games estimate. Model it properly instead:
  - historical games-missed rate, injury type/recurrence, age, minutes load,
    back-to-back history, plus the "load management" tier for stars.
- Output a **games-played distribution**, not a point estimate — feeds directly
  into the Monte Carlo sim, where it matters most (a 55-game superstar and a
  78-game very-good player are genuinely close in roto).
- Draft-board toggle: "risk-adjusted" vs "if healthy" rankings — the gap between
  the two orderings is itself a great screen for finding value.
- Cost: medium-high (needs historical injury data ingestion).

---

### 10. Projection Consensus & Disagreement Finder
- Blend our nightly models with DARKO (and any other free source we can ingest)
  into a consensus, weighted by each source's past accuracy per stat.
- The valuable output is the **disagreement view**: players where our model and
  the field diverge most. That list *is* our sleeper/bust list, and it's derived,
  not vibes.
- "Our model likes him +18 spots vs ESPN's rank" is a compelling, shareable
  column and doubles as a public accuracy scoreboard for our own models.
- Track it forward: at season's end, show who was right. Free credibility.
- Cost: low-medium. Mostly an ingest + alignment job (player ID mapping is the
  real work).

---

### 11. Role & Opportunity Change Detector (offseason edition)
- Draft value is mostly about **minutes and usage next year**, not stats last year.
- Diff this year's depth charts against last year's to find vacated production:
  "the Nets lost 41 shots/game — who absorbs them?"
- Sources: our depth-chart service + roster moves + summer-league/preseason
  minutes.
- Output: **projected-minutes delta leaderboard** — biggest gainers/losers of
  opportunity, which is the real sleeper list.
- Pairs perfectly with #10: divergence + role change = highest-conviction targets.
- Cost: medium.

---

### 12. Schedule-Aware Drafting
- We have a schedule service already. For roto, total **games played** across the
  season is a real, unexploited edge — a player on a team with more
  4-game weeks accumulates more counting stats.
- Draft board column: projected total games, and a "games-adjusted" value.
- Second-half / playoff-week schedule strength for H2H formats if we ever run one.
- Back-to-back load as an input to the durability model (#9).
- Cost: low. The data is already in the repo.

---

### 13. Tiers + Cheat Sheet Generator
- Auto-tier the board by clustering on value gaps (not fixed bucket sizes) — tiers
  are how you actually draft: "3 guys left in this tier, I can wait one more pick."
- One-page printable/exportable cheat sheet with our rankings, tiers, ADP delta,
  punt-fit markers, and blank slots to cross off.
- Personalized version: "your board from pick 7," pre-annotated with the pick
  predictor's likely-available names at each of your turns.
- Cost: low. Great polish item, and the most likely thing to actually get used on
  draft night by someone not staring at a laptop.

---

### 14. Post-Draft Instant Grade (extends the existing Draft Report page)
- The moment the draft ends, run the estimator on all 12 drafted rosters:
  projected roto standings, per-category ranks, biggest steal/reach per team.
- Per-team weakness call-out → immediately suggests waiver targets and feeds the
  existing trade analyzer with "you need REB, they need FT% — here's the trade."
- "Draft grade" is a fun social artifact and turns the tool into a season-long
  hook rather than a one-day thing.
- Cost: low. Mostly wiring existing services to the existing DraftReport page.

---

### 15. Wildcard ideas
- **Draft-day war room**: a single live page — board, my roster, category meters,
  pick timer, room tendencies — designed for one screen at draft time.
- **Voice/hotkey pick entry** so you can log picks without breaking eye contact
  with the draft room.
- **"What if I'd taken X" replay**: after the season, replay the draft swapping
  one pick and re-simulate the year. Painful, hilarious, extremely shareable.
- **Trade-up/trade-down calculator** for leagues that allow pick trading, priced
  in expected roto points.
- **LLM draft-room chatter**: one-line, opinionated blurbs per player generated
  from the model's own numbers ("we're 14% above consensus on his STL because
  of a projected usage jump") — the model explaining itself, not scraped punditry.
- **Multi-league mode**: same board, different scoring settings pulled from
  `mSettings`, so the tool generalizes beyond our one private league.

---

## Part 4 — Suggested sequencing

1. **ADP ingest** (ESPN `kona_player_info`) + **projections → roto value** (#1).
   Everything else depends on these two.
2. **Pick survival predictor** (#3) — cheapest big win.
3. **Live draft assistant** (#2) on top of 1+2.
4. **Mock draft simulator** (#4) reusing the estimator.
5. Then breadth: punt explorer (#5), manager profiles (#6), durability (#9),
   consensus/divergence (#10).

Roughly: items 1, 3, 12, 13, 14 are low-cost and high-visibility; 2, 4, 6, 9 are
the ones no competitor can copy, because they need our league's data and our own
projection models.

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
