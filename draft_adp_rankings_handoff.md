# Handoff: ADP/Rankings work

Branch: `fix/pre-draft-stat-seasons` (off `dev`) → [PR #222](https://github.com/AsafShai/fantasyAverageWeb/pull/222).
Feature branch `feat/draft-adp-rankings-views` is **stacked on top of it** (based on `8dd9bc6`, not on `dev`),
so its PR targets `fix/pre-draft-stat-seasons` and will retarget itself to `dev` once #222 merges.

## ADP vs Rankings feature — built (2026-08-25)

All six stages from the plan landed on `feat/draft-adp-rankings-views`:

- **Two parallel metrics.** `SiteAdp.ranking` (provider's published list) sits alongside `adp`;
  `AdpPlayer` gained `ranking_blend` / `ranking_blend_rank` / `ranking_spread` and a `yahoo` slot.
  Nothing was renamed, so the CSV export and the Chrome extension are untouched.
- **ESPN now splits the two.** `adp` comes from `ownership.averageDraftPosition`, `ranking` from
  the ROTO draft rank. Sleeper's `search_rank` moved to `ranking` (it never was an ADP).
- **Yahoo provider added** — public API, no auth, 662 players at `count=100` (7 requests, sequential,
  behind the cache). 174 real `average_pick` values (max 130.0), 662 `OR` ranks, `'-'` → `None`.
- **Capability matrix is server-owned** — `AdpResponse.providers`; the frontend hides Fantrax on the
  Rankings view and Sleeper on the ADP view from that, with a static fallback only before first response.
- **`POST /api/adp/refresh?provider=`** forces a re-fetch, clearing memory + the Neon row.
- **`row_version` on `adp_provider_cache`** (migration `add_adp_provider_cache_row_version.sql`,
  applied 2026-08-25) — payloads written under the old 4-field row shape are discarded, not misread.
- **Frontend:** shared `useBlendSites(metric)` hook (one localStorage key per view), ADP/Rankings
  toggle on the ADP page, Order-by selector on the Draft Board and Pre-Draft board, cross-metric
  "Δ vs Blend ADP/Rank" column, blend-site checkboxes on all three pages in one consistent layout.

Verified live: 709 backend tests, 232 frontend tests, tsc clean, lint at baseline. Both views and all
three pages checked in the browser at desktop and 375px.

## Done and shipped

**Commit `835660b`** (earlier session) — draft-board season resolution.
Pre-tipoff, actuals now correctly show last season, projections show the season
being drafted. Was showing `26/27` (0 games) and `27/28` (ESPN 404s) before.

**Commit `8dd9bc6`** (this session) — three independent fixes:

1. **Per-provider persisted cache** — new `backend/app/services/adp_cache.py` +
   `adp_provider_cache` Neon table (migration applied). Each of ESPN/Fantrax/Sleeper
   gets its own entry: 24h TTL, 15min retry on failure, serves stale rather than
   dropping a provider on a blip. Fixes Sleeper's documented "≤1 fetch/day, persist
   it yourself" requirement, which the old 30-min in-memory combined cache violated
   (worse in practice — Render cold-starts wipe memory every ~15 min idle).
   Verified live: cold-start reads 386 ESPN rows from Neon in 0.78s, zero API calls.

2. **ESPN reads ROTO, not STANDARD** — this league is 8-cat roto; the two lists
   disagree materially (Camara: 115 vs 61). `fetch_espn`/`parse_espn_payload` switched.
   Sleeper fetch adds `?active=true` (docs-sanctioned, drops retired players).

3. **Last-season actuals now come from ESPN, not Neon** — `load_last_year_stats`
   (DB) + `load_espn_projections` (ESPN) merged into one `load_espn_stat_splits()`.
   ESPN's `kona_player_info` payload carries the prior season's per-game splits in
   the *same* request used for projections (verified byte-identical to the old DB
   numbers: Jokic 65 GP / 27.7 / 12.9 / 10.7 either way). One ESPN call now does the
   job of one DB query + one ESPN call. `DBService`/`get_season_anchor_date`/
   `StatTimePeriod` imports and `last_year_from_agg_row` removed from `adp_service.py`
   entirely — no DB dependency left in this file.

Full backend suite green (696 passed). No frontend changes needed — all three fixes
are response-compatible (same field names/shapes, values corrected underneath).

## Reference: the plan and mockup this was built from

- **`draft_adp_rankings_plan.md`** (repo root) — full plan. Two independent data types
  (ADP vs provider rankings), each with its own Blend, user-selectable per-provider
  blend membership (one checkbox, shown+blended together — not split), shared across
  all three draft pages (`/draft/rankings` ADP+Rankings toggle page, Pre-Draft
  Rankings source selector, Draft Board metric selector). Additive API changes only
  — nothing renamed, so the Chrome extension's CSV parsing needs no change (verified:
  it reads the Pre-Draft export by a fixed 5-column prefix, not the ADP page's export).
- **`draft_adp_rankings_mockup.html`** (repo root) — interactive, uses the real
  page's actual CSS classes/markup shape, live-computed blends, all three pages wired
  with shared state. Open directly in a browser to click through it.

### Settled during planning (see plan §9 "Settled")
- ESPN Rankings = ROTO only, no Standard column.
- Sleeper blended by default in Rankings (ρ=0.905 vs real ADP, justified).
- Single-site Blend rows show the value as-is, no minimum-provider threshold.
- Pre-Draft board and Draft Board both default to **ADP** (not Rankings) blend.
- Yahoo confirmed viable as a 4th provider: no-auth public API, real ADP
  (`ownership.averageDraftPosition`, caps at pick 130, 190 real values across a
  confirmed-complete 662-player pool) + real rankings (`player_ranks` `OR` type,
  662 players). Fantrax has ADP only (no rankings method exists on their API).
  Sleeper has rankings only (`search_rank`; no ADP anywhere in their API/GraphQL).

### Resolved during the build
1. Fantrax/Yahoo name matching — both run through the existing fuzzy pipeline
   (`name_matching.py`). Measured: 641 of Yahoo's 662 rows join to an ESPN id; the rest
   keep a synthetic `name:` id, same as Fantrax-only players.
2. Yahoo ADP depth caps at 130 — **show as-is** (Asaf's call). No weighting, no synthetic
   fill; Yahoo still contributes to the Rankings blend for the players it has no ADP for.
   Live count moved since planning: 174 real `average_pick` values, not 190.

### Open: ESPN's undrafted ADP default (decided "leave for now", 2026-08-25)

ESPN reports an `averageDraftPosition` for anyone drafted even once and parks everyone
else just under 140. Measured on the live payload: 589 of 1095 values sit at 139.x–140.2,
365 more at 135–139, and only 141 fall below 135. It is shown as published — a `>=135`
cutoff was tried and reverted, because values run continuously up from ~125 (largest gap
above pick 100 is 2.97 picks), so any numeric threshold cuts through real data.

`ownership.percentOwned` *does* separate cleanly, if this is ever revisited:

| Rule | Players | Lowest ADP among them | Real values (ADP < 135) hit |
|---|---|---|---|
| `percentOwned == 0` | 35 | 139.96 | 0 |
| `percentOwned < 1%` | 820 | 139.66 | 0 |
| `percentOwned < 2%` | 870 | 139.24 | 0 |

Every player with an ADP below 135 is owned in **at least 17.4%** of leagues (Klay
Thompson), so the corridor between real and default is wide. The 35 at exactly 0% are
provable: ESPN publishes no ROTO rank for any of them and most have `proTeamId = 0`.

**Known consequence, unfixed by choice:** `mark_fringe` treats "has an ADP anywhere" as
proof of relevance, so ESPN's fabricated 140 keeps out-of-league players on the board —
Cole Swider, Oshae Brissett, Lamar Stevens, DJ Steward and Moses Brown all show
`fringe = false` despite no team, no games, and no ESPN rank. Fixing it needs either the
0%-owned ADP cut or dropping the ADP signal from `mark_fringe`.

### Known behaviour worth remembering
- An existing user's saved `draft.adp.visibleSites` does **not** auto-include Yahoo — a new
  provider stays unchecked until they tick it. Sleeper is filtered out of that list
  automatically since it has no ADP.
- ESPN returns 1095 ADP values, including the undrafted-default cluster near 140. Kept
  as-is per plan §1; it does pull deep players' ADP blend upward.
- 26/27 ESPN projections are still empty upstream, so the pre-draft "26/27 proj" toggle
  shows dashes. Pre-existing, not caused by this work.

## Branch / environment notes

```bash
git checkout feat/draft-adp-rankings-views
```

The stack is `dev` ← `fix/pre-draft-stat-seasons` (#222) ← `feat/draft-adp-rankings-views`.
Merge #222 first; GitHub then retargets the feature PR to `dev` automatically.

Migration `backend/migrations/add_adp_provider_cache_row_version.sql` is applied on Neon
(2026-08-25). Until a provider next refreshes, its row still reads `row_version = 1` and is
discarded on load — expected, it just means one extra fetch per provider.

`draft_adp_rankings_plan.md` remains the design record; `draft_adp_rankings_mockup.html`
is the UI it was built against, though the final layout moved every picker into the
existing settings card (right-aligned on the blend-sites row) rather than a separate strip.
