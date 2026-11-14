# Handoff: implement live data updates

You are picking up an approved, fully designed feature for this app
(FastAPI backend in `backend/`, React + RTK Query frontend in `frontend/`).
Your job is to build it, not to redesign it. Everything below was decided with
the owner; do not reopen decisions unless the code makes one impossible, and
then say so explicitly.

## Sources of truth

1. **Plan:** `plans/live_data_updates_design.md` on branch
   `claude/live-data-updates-design-zem7ej` in `AsafShai/fantasyAverageWeb`.
   Read the whole file before writing code. Where an earlier section and a
   later numbered decision disagree, the later decision wins.
2. **UI design (must follow):** https://claude.ai/artifact/APmBcZdJicKURzHzHHEDwi
   — a design canvas with seven artboards: Rankings, Today, Team page,
   Analytics heatmap, Rankings Over Time + date ranges, Mobile standings,
   Share card. Each has a "Moment of the day" prop with four states: Before
   tip-off, Games live, All final / ESPN pending, ESPN official. It defines
   *what* changes on each page, the wording and the states. (The canvas is
   private to the owner; if you cannot open it, ask the owner to share it or
   paste its contents.)
3. **Today's code design:** build inside the existing components, styles and
   patterns in `frontend/src` and `backend/app`. The mockups were rebuilt
   from the production UI but are not code: never copy mockup markup, and
   never take layout or style from the screenshots in `screenshots/` (they
   are outdated). The code is the reference for how things look and are
   built today.

## What to build (summary; the plan file has the detail)

- **Two layers.** ESPN's official totals stay exactly as today and are the
  only thing the DB, estimator and nightly jobs ever see. A live overlay is
  computed in memory on top and never stored.
- **Live data source.** The league standings payload the app already polls
  every 30 s carries tonight's in-progress stat lines
  (`schedule[0].teams[].rosterForCurrentScoringPeriod` entries,
  `statSplitTypeId 5`, `statSourceId 0`, current `scoringPeriodId`). Count
  active slots only (not BE/IR), rebuild ratio categories (FG%, FT%) from
  summed makes/attempts, respect the slot GP caps.
- **Counting rule.** Averages views (values, category ranks, roto points,
  heatmap, Top 5, movers) count finished games only. Totals views, the team
  Daily roster and slot usage include games in progress.
- **"Game is final"** comes from the site scoreboard (`scoreboard_for`, shared
  60 s cache). Call it only on demand, only for the averages view, only for
  games 1 h 45 min past tip (tip times from the cached pro-team schedule),
  never again for a game already seen final, and not at all after the last
  final.
- **Morning hand-over.** Pick the overlay by the same payload's
  `scoringPeriodId` as the baseline; implement guards G1 and G2; log the
  morning reconciliation and expose it in `/health`.
- **Flag.** Backend `LIVE_STANDINGS_ENABLED`, default off. With it off the
  overlay still runs in shadow and logs the reconciliation, and every page
  and response is exactly as today. The frontend has no flag of its own: it
  follows the `live` block in responses.
- **UI.**
  - Tappable live badge on every affected page; it replaces the "ESPN
    updated" note while live or final-pending and opens tonight's games.
  - Existing ▲/▼ movers and "GP +N" mean "tonight" while live.
  - Heatmap: only values, ranks and colours change, plus "+N" on GP. No
    outlines or arrows.
  - Today's Rank movers get a Tonight / vs yesterday switch.
  - Team page: badge in the header plus a short status in each section
    subtitle.
  - Mobile: badge reads "LIVE · 2 of 4", and the averages note lives in the
    tap sheet. Desktop and mobile components both.
  - Share cards get a LIVE / FINAL stamp.
  - Polling every 60 s only while games are live, skipped in hidden tabs.
- **All of plan section 7 is in scope:**
  - the overlay and its safety net;
  - live standings;
  - the live team roster day;
  - date ranges that end today;
  - Tonight movers;
  - a dashed live point on Rankings Over Time;
  - G1 hardening of `_sync_db_if_needed`.
- **Out of scope:** player-level pages (Player Rankings, Players, roster
  season/last-N stats, Trade, FA report, Trends, player game log). They read
  stored game totals and update with the morning job; leave them as they are.

## How to work

- **TDD.** For every change, write the failing test first, make it pass,
  then refactor. Backend: pytest under `backend/tests`. Frontend: the
  existing unit tests and the Playwright e2e specs in `frontend/e2e` (with
  fixtures in `e2e/fixtures`). Start with the tests the plan lists in
  section 7 step 1, plus a test per page proving that with the flag off the
  response is unchanged. Run the same checks as
  `.github/workflows/pr-check.yaml` before every PR, and report results
  faithfully, failures included.
- **Branches and PRs.** Work on branches off `dev`. Every PR targets `dev`;
  nothing goes to `master` directly. You decide how to split the work into
  PRs, independent or stacked (GitHub stacked PRs). Choose what keeps each PR
  reviewable and keeps `dev` green, and say why in the first PR. A natural
  split:
  1. overlay + flag + shadow logging;
  2. backend `live` blocks;
  3. frontend badge + polling + pages;
  4. team Daily roster;
  5. ranges, Tonight movers, race point.
  Each PR must be safe on its own with the flag off.
- **Models.** You decide per thread or session whether Opus or Sonnet does
  the work. Use the stronger model where the reasoning is subtle (overlay
  arithmetic, hand-over guards, ratio and cap rules, memo identity) and the
  faster one where the work is mechanical (wiring a `live` block into more
  routes, UI states that copy an existing pattern, fixtures). State the
  choice and the reason when you start each thread.
- **Progress reporting.** If you create threads in the project, every thread
  must post its progress back to the main project chat: tasks started, done
  and blocked, with test results. When a thread finishes a UI task, it must
  post **live screenshots** of the real app in the main chat before opening
  its PR to `dev`. Run the app locally against mocked or real API data,
  desktop and mobile widths, covering the relevant "Moment of the day"
  states. No PR to `dev` without those screenshots posted first.

## Verification after merge

The real morning hand-over needs live ESPN data, so it is verified after the
code exists, not before:

- **Staging/dev:** flag on, real league and season, watched through a few
  live slates and mornings.
- **Production:** flag off; the shadow reconciliation logs check the real
  hand-overs.
- **Turning it on:** the owner turns the flag on in production once both are
  clean.

Report what could not be verified locally instead of claiming it works.
