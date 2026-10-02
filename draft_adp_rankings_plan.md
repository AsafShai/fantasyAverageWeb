# Draft pages: ADP view + Rankings view

Split the draft data into two parallel views — **ADP** (what drafters actually did) and
**Rankings** (what a provider says the order should be) — each with its own Blend and its
own user-chosen blend membership. Folds in the four fixes found during research.

Branch: `fix/pre-draft-stat-seasons` (already carries the season fix) — or a fresh
`feat/draft-adp-rankings-views` off `dev` if we want the season fix to merge on its own.

---

## 1. What each provider actually gives us

Measured live, 2026-08-24. Counts are players with a usable value.

| Provider | ADP | # | Rankings | # | Notes |
|---|---|---|---|---|---|
| **ESPN** | `ownership.averageDraftPosition` | ~141 | `draftRanksByRankType.STANDARD` **and `.ROTO`** | 388 / 387 | one call gives both |
| **Yahoo** | `average_pick` | 188 | `player_ranks` `OR` (overall) | 662 | **no auth**, season 2026 = 26/27 |
| **Fantrax** | `ADP` | 280 | none — no such method exists | — | deepest true ADP |
| **Sleeper** | none — none exists | — | `search_rank` | 832 | ρ=0.905 vs real ADP |

Placeholders that must be filtered to `None`, or a missing value reads as a real one:

- **ESPN ADP**: 2080 players have no `ownership` block at all — that's `None`, already correct.
  Of the 1095 that do carry a number, some cluster near `140` (undrafted-default noise) and
  some are real. **Decision: show ESPN's number as-is, no `>=135` cutoff.** ESPN's own average
  already reflects reality — a player barely drafted anywhere *should* show a high ADP, that's
  not wrong, it's the signal. Filtering it would hide real (if weak) data for no benefit.
- **Yahoo ADP**: placeholder is the string `'-'`, interleaved (Rui Hachimura `-` while Adem
  Bona has `112.0`) — a draft-frequency threshold, not depth. `coerce_adp` must map `'-'` to
  `None`, same as it already does for ESPN's `null`. Max real value is `130.0` — verified
  against Yahoo's **entire 662-player pool**, not a partial walk; every sort order agrees the
  list ends there. 190 players have a real `average_pick`; the other 472 get `None`, exactly
  like a site that doesn't rank a player at all. No synthetic fallback, no tie-break — Yahoo
  still counts toward the *Rankings* blend for those 472 via `player_ranks`, just not ADP.
- **Sleeper**: `999`; already filtered at `adp_fetch.py:204`.

Consequence for the UI: **no provider covers both views.** Fantrax has ADP only, Sleeper has
rankings only. Each view shows the providers that have that data type — this is the core of
the feature, not an edge case.

---

## 2. Fixes to land with it

### 2a. ESPN reads the wrong rank list

`fetch_espn` sorts by `sortDraftRanks: STANDARD` and `parse_espn_payload` reads
`draftRanksByRankType.STANDARD`. The league is **8-cat roto**; ESPN publishes a `ROTO` list
and they differ materially — Camara STANDARD 115 / ROTO **61**, Fears 195 / **125**.

Also `std.averageRank` is `null` for all 3175 players, so the `averageRank or rank` fallback
at `adp_fetch.py:84` never takes the first branch. Reads like it averages; it never does.

Fix: fetch both rank types, expose ROTO as the default rankings source, drop the dead
`averageRank` preference.

### 2b. Sleeper is called against its documented limits

Docs: *"use this call sparingly, intended only to be used once per day at most"*, *"save this
information on your own servers"*, ~5 MB.

We call the bare all-players dump on a 30-minute TTL, in memory only — up to 48×/day of a
2.4 MB payload, and Render's cold starts make the real rate worse.

Fix: `?active=true` (docs-sanctioned) + the cache work in §3.
Measured: 2,463,833 → 2,127,193 bytes, 2108 → 1818 players, usable ranked 832 → **829**.
The 3 lost are Kyle Lowry, Dwight Howard, Chris Paul — all `status: RET`. Pure win.

### 2c. `SiteAdp.rank` means the wrong thing

Today `rank` is **derived** — `assign_ranks` sorting that site's ADP (`adp_service.py:364`).
The Rankings view needs the provider's *published* list. Two different numbers, one name.

Fix: keep the derived one as `adp_rank`, add `rank` for the provider's own ranking.
This is a breaking rename in the API payload — see §6.

### 2d. Blend has no scale normalization

`compute_blend` is a plain arithmetic mean of raw values. It works today only because I
measured Sleeper's bias against real ADP at **+0.4 to +2.9** across every band — the scales
happen to align. That is luck, not design, and it will not hold when ranks (1–662) are
blended with ADP (1–130). **Rankings Blend and ADP Blend must never mix units.** Two blends,
computed independently, is the design — not a nicety.

---

## 3. Cache redesign — 24h flat, per provider, persisted

**Answer on 24h: yes, one TTL for every provider — simpler than per-provider tiers, and
Sleeper's own limit (≤1/day) is the binding constraint anyway, so nothing else needs to be
faster.** But 24h does nothing until the underlying bugs are fixed.

Current state: three caches (`_cached`, `_last_year_cache`, `_projection_cache`) all reading
one `_CACHE_TTL = 30 min`. `adp_fetch.py` has no caching at all. All three providers live in
**one combined entry** built by a single `asyncio.gather`.

| Bug | Why 24h makes it worse |
|---|---|
| **In-memory only** — no `cache_manager`, no `db_service` persistence | Render free tier cold-starts after ~15 min idle. A 24h TTL on a process that dies every 15 min buys nothing; every wake re-pulls all providers. |
| **Partial failures are cached** — `fetch_live_adp_payload` omits failed sites and the result is cached anyway | At 30 min a Sleeper blip costs half an hour. At 24h it costs a **day** of a silently missing provider. |
| **One entry for all providers** | Any expiry re-fetches everything together — including Sleeper's 2.4 MB dump, every time, even though it alone needs the long TTL. |

Design:

- **Per-provider cache entries**, keyed by provider, each with its own `fetched_at`. The
  combined response is a *composition* of provider entries, not one cached blob — this is
  what lets a failed provider retry on its own schedule without waiting on the others.
- **Persist to Neon.** New table `adp_provider_cache(provider, payload jsonb, fetched_at,
  source_url)`. Survives cold starts — this is what actually delivers the 24h; without it a
  15-minute cold start makes any TTL moot.
- **One TTL, 24h, for every provider.** No tiering — simplest thing that satisfies Sleeper's
  documented limit and comfortably covers the others.
- **Failure TTL `15 min`** — a failed provider retries soon instead of being silently absent
  for a day. This is the one place a second number is worth it: 24h of *no data* is a much
  worse outcome than 24h of *slightly stale* data.
- **Serve stale on failure.** If a refresh fails and a persisted entry exists, serve it and
  surface its age rather than dropping the provider from the blend silently.
- **Expose freshness.** Per-provider `fetched_at` in the response so the UI can show
  "ESPN 3h ago" and the user knows what they're drafting on.
- **Manual refresh.** `POST /api/adp/refresh?provider=` for the user drafting *today* who
  doesn't want to wait out 24h. Without this, a day-long TTL is a real downgrade during a
  live draft window.

Migration: `backend/migrations/` SQL file, applied manually per project convention.

---

## 4. Data model — additive only, nothing renamed

Every existing field keeps its name and meaning. Rankings adds new fields **alongside**.

Backend `backend/app/models/adp.py`:

```
SiteAdp                        # per provider, per player
  adp:      float | None       # unchanged — true ADP, sentinel-filtered
  rank:     int | None         # unchanged — derived from this provider's adp
  ranking:  int | None         # NEW: the provider's own published ranking

AdpPlayer
  espn / fantrax / sleeper: SiteAdp    # unchanged
  yahoo: SiteAdp                       # NEW provider
  blend:      float | None             # unchanged — ADP blend
  blend_rank: int | None               # unchanged — ordinal of `blend`
  spread:     float | None             # unchanged
  ranking_blend:      float | None     # NEW: mean of provider rankings
  ranking_blend_rank: int | None       # NEW: ordinal of ranking_blend
  ranking_spread:     float | None     # NEW
```

Why additive: `blend` / `blend_rank` / `<site>_adp` / `<site>_rank` are the CSV export headers
(`AdpPage.tsx:238-254`) and the **Chrome extension parses that CSV**
(`extension/src/lib/parseCsv.ts`). Renaming would break "Apply on ESPN" mid-draft, silently,
for zero benefit. No rename, no extension change, no schema version needed.

`ProviderMeta` (new): `key`, `label`, `has_adp`, `has_rankings`, `fetched_at`, `source_url`,
`player_count`. Returned in `AdpResponse.providers` so the frontend stops hardcoding
`ADP_SITES` and learns capability from the server.

**Capability matrix is server-owned.** The frontend must not hardcode "Fantrax has no
rankings" — when Fantrax ships a rankings endpoint, or a provider goes down, only the
backend changes.

**ESPN rank type**: fetch ROTO, use ROTO, expose it as plain "ESPN". No STANDARD column —
the league is roto, and a second ESPN entry is noise. `rank_type` is not surfaced in the UI;
sites are labelled by name only ("ESPN", "Yahoo"), never "ESPN Roto" or "Yahoo OR".

---

## 5. Backend work

| File | Change |
|---|---|
| `services/adp_fetch.py` | ESPN: parse `ROTO` + `STANDARD` ranks and `ownership.averageDraftPosition` with the `>=135` guard; drop dead `averageRank` branch. Sleeper: `?active=true`. **New** `fetch_yahoo` — `pub-api-ro.fantasysports.yahoo.com`, paginated `start`/`count=25`, `out=draft_analysis,ranks`, `'-'` guard. |
| `services/adp_cache.py` | **New.** Per-provider get/put, TTL policy, stale-on-failure, Neon persistence. |
| `services/adp_service.py` | Split `fetch_live_adp_payload` into per-provider refreshes. `compute_blend` / `compute_spread` take a **metric** (`adp` \| `rank`) and a provider tuple. `parse_sites` → `parse_providers`, extended with a per-view selection. |
| `models/adp.py` | §4. |
| `routes/adp.py` | `metric=adp\|rank` param; `providers=` per view; `POST /adp/refresh`. |
| `migrations/` | `adp_provider_cache` table. |
| `tests/` | Sentinel filtering per provider (ESPN 135 cliff, Yahoo `'-'`, Sleeper 999); blend never mixes units; stale-on-failure; capability matrix drives which providers appear per view. |

Yahoo pagination note: 662 players at 25/page ≈ 27 requests per refresh. With a 6h TTL and
persistence that's ~108 requests/day — fine, but it must be a *background* refresh, never
inline on a user request. Sequential with a small delay, not 27 parallel.

---

## 6. Compatibility — no breaking change

Nothing is renamed, so:

- **CSV export headers are unchanged** — `blend`, `blend_rank`, `<site>_adp`, `<site>_rank`.
- **The Chrome extension needs no change.** `extension/src/lib/parseCsv.ts` and `rankMoves.ts`
  keep working against the same columns.
- **Old clients keep working** — new fields are additive and ignored by anything that doesn't
  ask for them.

Only genuinely new surface: the `yahoo` provider object, the three `ranking_*` fields, and
`AdpResponse.providers`.

**Verified** — the extension is not exposed to the ADP page's CSV at all. It parses the
*Pre-Draft Rankings* export, whose contract is a fixed five-column prefix:

```
RANKINGS_CSV_HEADERS = ['rank', 'id', 'name', 'team', 'positions']   // + 'espn_id'
```

declared identically in `frontend/src/utils/draftCsv.ts:3` and `extension/src/lib/parseCsv.ts:1`.
`isRankingsHeader` checks those five **positionally**, then finds `espn_id` by name. The ADP
page's `blend`/`<site>_adp` columns are a different export the extension never reads.

So the constraint is narrower than feared but sharper: **do not insert a column before
`positions` in the pre-draft export.** Appending after `espn_id` is safe. Since those two
constant declarations are duplicated across two packages, any change must land in both — a
test asserting they match would be cheap insurance.

---

## 7. Frontend work

| File | Change |
|---|---|
| `utils/adp.ts` | Drop hardcoded `ADP_SITES`; consume `providers` from the response. Add `metric` type. |
| `pages/draft/AdpPage.tsx` | View toggle **ADP \| Rankings**. Columns, sort keys, and the provider checkbox row all become metric-aware. Provider list filtered by capability for the active view. |
| `pages/draft/PreDraftRankingsPage.tsx` | Board can start from either blend. Source selector; switching marks the board dirty so the user saves deliberately. |
| `pages/draft/DraftBoardPage.tsx` | Metric selector; pool ordering follows it. |

### Ripple onto the other two draft pages

**Pre-Draft Rankings** (`/draft/rankings`) — starting order comes from the blend. Today the
board is seeded from `blend_rank` via `mergeIdsIntoRankings`, and the rows show *Blend rank*
/ *Blend ADP* plus a `DeltaBadge` against `blend_rank`.

- Source selector chooses which blend seeds the board.
- Switching source is an **edit**: it goes through the existing dirty/save flow, never a
  silent reorder of a saved board.
- New cross-metric delta column — with two blends, "Δ vs Blend ADP" while ordered by rank (and
  vice versa) shows reach/value at a glance. This column is only possible once both exist.

> **Backend gap, easy to miss:** this page is fed by `/adp/index`, and `AdpIndexPlayer` is a
> *slimmed separate model* carrying only `blend` / `blend_rank`. Rankings order requires adding
> `ranking_blend` to `AdpIndexPlayer` and `to_index_player` as well — changing `AdpPlayer`
> alone will not surface it here.

**Draft Board** (`/draft/board`) — calls `useGetAdpQuery({sort:'blend', sort_dir:'asc',
page_size: teams*rounds})` and lays the top N into a snake grid. So it silently inherits
whichever blend is used for sorting.

- Needs `sort` to accept `ranking_blend` server-side, plus a metric selector.
- **Default stays ADP.** A draft board predicts *where players actually go* — that is exactly
  what ADP measures. Rankings answer "where they *should* go", which is a useful alternate
  view but the wrong default for a board.

**Shared:** all three pages read the same provider/blend selection, so the show-vs-blend
choice must live in one place (a shared hook or store slice), not be re-implemented per page.
**One checkbox per site, unchanged semantics.** Checked = column shown *and* counted in
Blend, exactly as today (`AdpPage.tsx:297-312`, "Blend uses checked sites"). To blend Yahoo +
Fantrax only, uncheck ESPN. No second control, no popover — the existing Sites row is the
whole UI.

**The selection appears on all three draft pages**, not just ADP/Rankings. The blend seeds
the Pre-Draft board order and the Draft Board pool, so forcing the user to another page to
change what feeds them is wrong. Same control, same state — changing it anywhere updates
everywhere.

**Sites with no data for the active view are not rendered.** Fantrax is absent from the
Rankings view, Sleeper from the ADP view — no greyed-out chip, no "n/a" row. Driven by
`ProviderMeta.has_adp` / `has_rankings`.

**Labels are site names only** — "ESPN", "Yahoo", "Fantrax", "Sleeper". No "ESPN Roto",
no "Yahoo OR". Which underlying list a site uses is an implementation detail.

### Persistence

Yes — localStorage, via the existing `usePersistedState` hook the draft pages already use
(`draft.adp.visibleSites`, `draft.adp.sortBy`, `draft.board.league`, …). Nothing new to build.

Keys, **per view** so an ADP choice never clobbers a Rankings choice:

| Key | Holds |
|---|---|
| `draft.adp.visibleSites` | existing key, existing meaning — ADP-view site selection |
| `draft.rank.visibleSites` | new — Rankings-view site selection |

Reusing `draft.adp.visibleSites` keeps every current user's saved selection working. Two
details it must handle, both already handled by today's code and worth preserving:

- **Unknown keys are filtered** (`AdpPage.tsx:152-158`) — needed now more than before, since
  a stored list may contain `yahoo` after a rollback, or `sleeper` when the ADP view can't
  use it.
- **Empty falls back to all sites** — otherwise a user who unchecks everything gets a
  permanently blank page that survives reload, with no obvious way out.

Since the value is now read by three pages, it belongs in **one shared hook**
(`useBlendSites(metric)`), not `usePersistedState` called separately in each page — three
copies of the same key drift.

Pre-draft board: switching source recomputes the starting order, so it must go through the
existing dirty/save flow — never silently reorder a saved board.

---

## 8. Staging

1. **Cache + persistence** (§3) — standalone, no UI change, immediately stops the Sleeper
   overuse. Ship first, verify in isolation per the perf-change rule.
2. **ESPN ROTO + sentinel guards** (§2a) — data correctness, still single-view.
3. **Model split + two blends** (§4, §6) — backend and frontend together.
4. **Rankings view UI** (§7) — the visible feature.
5. **Yahoo provider** (§5) — additive once the provider abstraction exists.
6. **Pre-draft source selector + extension CSV** (§6, §7).

Stages 1–2 are independently shippable and fix real bugs. Stage 3 is the breaking one.

---

## 9. Open questions

1. ~~Fantrax name matching~~ — **resolved**: `backend/app/utils/name_matching.py` already does
   fuzzy name matching (`clean_fantasy_scraped_name`, `lookup_catalog_espn_id`) for Fantrax and
   Sleeper today, since neither carries an ESPN id. Yahoo joins the same pipeline — no new
   mechanism needed.
2. ~~Yahoo ADP depth~~ — **resolved**: re-walked the full pool (all sort orders agree it ends
   at 662 players — this is the entire Yahoo NBA pool, not a walk limit). 190 have a real
   `average_pick`; the other 472 have none because Yahoo doesn't report one, not because we
   stopped looking. Show real ADP where Yahoo has it, `—` where it doesn't — same as every
   other site's missing-value handling. No synthetic rank or tie-break; Yahoo still
   contributes to the Rankings blend for those 472 via `player_ranks`, just not to ADP.
3. **Does the pre-draft board default to ADP or Rankings blend** for a fresh user?
   → **Resolved: ADP.** Matches the Draft Board's default (§7) for the same reason — ADP is
   what drafters actually did, closer to how a live draft plays out than an expert ranking.

### Settled

- ESPN uses **ROTO only** — no Standard column.
- **Nothing is renamed**; rankings fields are additive, CSV and extension untouched.
- **One checkbox per site**, same semantics as today, shown on all three draft pages, backed
  by localStorage per view.
- Sites with no data for the active view are **hidden entirely** — no greyed chips, no n/a rows.
- Labels are **site names only** — no "ESPN Roto", no "Yahoo OR".
- **Sleeper is blended by default** in the Rankings view. ρ=0.905 against real ADP with
  +0.4→+2.9 median bias justifies it, and it is the deepest rankings source at 832 players.
  It remains uncheckable like any other site.
- **Single-site Blend rows show the value as is** — no minimum-provider threshold, no `—`.
  A player only one site lists (Hachimura: Fantrax alone) still gets a Blend equal to that
  value. `Spread` naturally shows `—`, which is the signal that it is unaveraged.
