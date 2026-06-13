# Player Rankings Page — Design Spec

**Date:** 2026-06-13  
**Status:** Approved  
**Feature flag:** `VITE_SHOW_PLAYER_RANKINGS=true`

---

## Goal

Z-score based player rankings page using 2025-26 season stats already available via ESPN API. Hidden behind an env-var feature flag (site is live, next season starts in ~4 months).

---

## Data Source

**Backend endpoint:** `GET /api/player-rankings`

- Calls `data_provider.get_players_df(stat_split_type_id=0)` — already cached in-memory (5-min TTL), no new ESPN integration needed
- Returns all ~500 players (ONTEAM + FREEAGENT + WAIVERS) with raw stats
- No filtering, no z-scores — frontend owns all calculation

**Response fields per player:**
```
name, pro_team, positions, gp, min, fg_pct, ft_pct, three_pm, reb, ast, stl, blk, pts, fgm, fga, ftm, fta
```

**New files:**
- `backend/app/routes/player_rankings.py`
- `backend/app/services/player_rankings_service.py` (thin — just extracts columns from players_df)
- Register in `backend/app/main.py`

---

## Calculation (client-side, triggered by "Calculate" button)

### Inputs
- All ~500 players from backend (fetched once on page load)
- User settings: calc mode (totals/per-game), min GP, min MIN, position filter, category weights, punts

### Two-pass z-score algorithm

```
Step 1 — apply filters: min GP, min MIN, position
Step 2 — if filtered pool >= 300:
    Pass 1: compute z-scores on filtered pool → sort by total_z → take top 300
    Pass 2: recompute z-scores using top 300 as reference pool
  else (< 300 after filters):
    Single pass on filtered pool
Step 3 — apply weights + punts:
    total_z = Σ(cat_z × weight)  for non-punted cats
Step 4 — sort by total_z desc, display top 200
```

### Totals vs Per Game (calc mode)
- **Per game:** counting stats divided by GP before z-score (PTS/GP, REB/GP, etc.)
- **Totals:** raw season totals used as-is
- FG% and FT% are always rates — unaffected by this toggle

### Category order (matches app convention)
FG%, FT%, 3PM, REB, AST, STL, BLK, PTS

---

## UI

### Controls panel (above table)

```
Calc mode:    [ Totals | Per Game ]     ← affects z-score calc, applied on Calculate
Display mode: [ Totals | Per Game ]     ← instant, only changes raw value columns

Min GP: [____]   Min MIN: [____]   Position: [All ▾]

Category weights (slider 0–2, default 1.0) + punt toggle:
  FG% [━━━●━━] 1.0  [PUNT]
  FT% [━━━●━━] 1.0  [PUNT]
  3PM [━━━●━━] 1.0  [PUNT]
  REB [━━━●━━] 1.0  [PUNT]
  AST [━━━●━━] 1.0  [PUNT]
  STL [━━━●━━] 1.0  [PUNT]
  BLK [━━━●━━] 1.0  [PUNT]
  PTS [━━━●━━] 1.0  [PUNT]

                    [ Calculate ]
```

- PUNT sets that category's weight to 0, grays its z-score column in table
- Calc mode change does NOT auto-recalc — user must press Calculate

### Results table (top 200, sortable by any column)

```
Rank | Z Score | Player | Team | Pos | GP | FG% | FT% | 3PM | REB | AST | STL | BLK | PTS | FG%_z | FT%_z | 3PM_z | REB_z | AST_z | STL_z | BLK_z | PTS_z
```

- Raw stats block first, z-score block after
- Raw values shown according to **display mode** toggle (independent of calc mode)
- Z scores remain from last Calculate press
- Punted category z-score columns grayed out
- Z Score column = weighted total z-score, sits next to Rank

---

## Feature Flag

- `VITE_SHOW_PLAYER_RANKINGS=true` in `frontend/.env` and `frontend/.env.production`
- Route `/player-rankings` and nav link both hidden when flag is false
- Default: false (hidden on live site until next season)

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `backend/app/routes/player_rankings.py` | Create |
| `backend/app/services/player_rankings_service.py` | Create |
| `backend/app/main.py` | Register new router |
| `frontend/src/pages/PlayerRankings.tsx` | Create |
| `frontend/src/store/api/fantasyApi.ts` | Add endpoint |
| `frontend/src/types/api.ts` | Add types |
| `frontend/src/App.tsx` | Add guarded route |
| `frontend/src/components/Layout.tsx` | Add guarded nav link |
| `frontend/.env` | Add `VITE_SHOW_PLAYER_RANKINGS=false` |
| `frontend/.env.example` | Document flag |

---

## Out of Scope

- Advanced impact-z formula for FG%/FT% (the other project's unfinished formula)
- Next-season projections / MPG adjustments
- Saving/sharing weight presets
- Integration with trade analyzer or draft board
