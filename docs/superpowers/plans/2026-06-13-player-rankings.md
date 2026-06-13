# Player Rankings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/player-rankings` page showing z-score based player rankings from 2025-26 ESPN season stats, hidden behind `VITE_SHOW_PLAYER_RANKINGS` env var.

**Architecture:** Backend exposes a thin `GET /api/player-rankings` endpoint reusing the existing `DataProvider.get_players_df(0)` cache. All z-score computation happens client-side in a pure utility function triggered by a "Calculate" button. Two-pass algorithm removes low-quality players from the reference population.

**Tech Stack:** FastAPI + pytest (backend), React + RTK Query + Tailwind + vitest (frontend)

---

## Git Setup (before any task)

Run from repo root (NOT the worktree):
```bash
git fetch origin dev
git checkout dev && git pull origin dev
git checkout -b feat/player-rankings
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/services/player_rankings_service.py` | Create | Fetch players_df, return List[Player] |
| `backend/app/routes/player_rankings.py` | Create | GET /api/player-rankings route |
| `backend/app/main.py` | Modify | Register new router |
| `backend/tests/services/test_player_rankings_service.py` | Create | Service unit tests |
| `backend/tests/routes/test_player_rankings.py` | Create | Route integration tests |
| `frontend/src/vite-env.d.ts` | Modify | Declare VITE_SHOW_PLAYER_RANKINGS |
| `frontend/.env` | Create | Set flag to false |
| `frontend/.env.example` | Create | Document flag |
| `frontend/src/store/api/fantasyApi.ts` | Modify | Add getPlayerRankings endpoint |
| `frontend/src/utils/playerRankings.ts` | Create | Two-pass z-score algorithm |
| `frontend/src/utils/__tests__/playerRankings.test.ts` | Create | Vitest unit tests |
| `frontend/src/pages/PlayerRankings.tsx` | Create | Full page component |
| `frontend/src/App.tsx` | Modify | Add guarded route |
| `frontend/src/components/Layout.tsx` | Modify | Add guarded nav link |

---

## Task 1: Backend — PlayerRankingsService

**Files:**
- Create: `backend/app/services/player_rankings_service.py`
- Create: `backend/tests/services/test_player_rankings_service.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/services/test_player_rankings_service.py
import pandas as pd
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import ResourceNotFoundError
from app.services.player_rankings_service import PlayerRankingsService
from app.models import Player, PlayerStats


def _sample_player(name: str = "P1") -> Player:
    return Player(
        player_name=name,
        pro_team="LAL",
        positions=["PG"],
        stats=PlayerStats(
            pts=20, reb=5, ast=5, stl=1, blk=0.5,
            fgm=8, fga=17, ftm=4, fta=5,
            fg_percentage=0.47, ft_percentage=0.85,
            three_pm=2, minutes=30, gp=70,
        ),
        team_id=1,
        status="ONTEAM",
        injured=False,
    )


@pytest.fixture
def player_rankings_service():
    svc = object.__new__(PlayerRankingsService)
    svc.data_provider = MagicMock()
    svc.response_builder = MagicMock()
    svc.logger = MagicMock()
    return svc


@pytest.mark.asyncio
async def test_get_player_rankings_returns_players(player_rankings_service, sample_stats_calculator_averages_df):
    player_rankings_service.data_provider.get_players_df = AsyncMock(return_value=sample_stats_calculator_averages_df)
    mock_players = [_sample_player("A"), _sample_player("B")]
    player_rankings_service.response_builder.build_all_players_response.return_value = mock_players

    result = await player_rankings_service.get_player_rankings()

    assert result == mock_players
    player_rankings_service.data_provider.get_players_df.assert_called_once_with(0)


@pytest.mark.asyncio
async def test_get_player_rankings_none_df_raises(player_rankings_service):
    player_rankings_service.data_provider.get_players_df = AsyncMock(return_value=None)
    with pytest.raises(ResourceNotFoundError, match="No players found"):
        await player_rankings_service.get_player_rankings()


@pytest.mark.asyncio
async def test_get_player_rankings_empty_df_raises(player_rankings_service):
    player_rankings_service.data_provider.get_players_df = AsyncMock(return_value=pd.DataFrame())
    with pytest.raises(ResourceNotFoundError, match="No players found"):
        await player_rankings_service.get_player_rankings()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/services/test_player_rankings_service.py -v
```
Expected: `ImportError` or `ModuleNotFoundError` on `player_rankings_service`

- [ ] **Step 3: Implement the service**

```python
# backend/app/services/player_rankings_service.py
import logging
from typing import List
from app.models import Player
from app.exceptions import ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder


class PlayerRankingsService:
    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_player_rankings(self) -> List[Player]:
        players_df = await self.data_provider.get_players_df(0)
        if players_df is None or players_df.empty:
            raise ResourceNotFoundError("No players found")
        return self.response_builder.build_all_players_response(players_df)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/services/test_player_rankings_service.py -v
```
Expected: 3 tests PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/player_rankings_service.py backend/tests/services/test_player_rankings_service.py
git commit -m "feat(backend): add PlayerRankingsService returning all players"
```

---

## Task 2: Backend — Route + Register + Route Tests

**Files:**
- Create: `backend/app/routes/player_rankings.py`
- Create: `backend/tests/routes/test_player_rankings.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the failing route tests**

```python
# backend/tests/routes/test_player_rankings.py
from fastapi.testclient import TestClient
from unittest.mock import patch
from app.main import app
from app.models import Player, PlayerStats

client = TestClient(app)


def _sample_player(name: str = "P1") -> Player:
    return Player(
        player_name=name,
        pro_team="LAL",
        positions=["PG"],
        stats=PlayerStats(
            pts=20, reb=5, ast=5, stl=1, blk=0.5,
            fgm=8, fga=17, ftm=4, fta=5,
            fg_percentage=0.47, ft_percentage=0.85,
            three_pm=2, minutes=30, gp=70,
        ),
        team_id=1,
        status="ONTEAM",
        injured=False,
    )


def test_get_player_rankings_returns_list():
    response = client.get("/api/player-rankings/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_get_player_rankings_player_shape():
    response = client.get("/api/player-rankings/")
    assert response.status_code == 200
    player = response.json()[0]
    assert "player_name" in player
    assert "pro_team" in player
    assert "positions" in player
    assert "stats" in player
    stats = player["stats"]
    for field in ["pts", "reb", "ast", "stl", "blk", "three_pm", "fg_percentage", "ft_percentage", "gp", "minutes"]:
        assert field in stats


@patch("app.services.player_rankings_service.PlayerRankingsService.get_player_rankings")
def test_get_player_rankings_error(mock_get):
    from app.exceptions import ResourceNotFoundError
    mock_get.side_effect = ResourceNotFoundError("No players found")
    response = client.get("/api/player-rankings/")
    assert response.status_code == 404
    assert "No players found" in response.json()["detail"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/routes/test_player_rankings.py -v
```
Expected: 404 or `ImportError` — route not registered yet

- [ ] **Step 3: Create the route**

```python
# backend/app/routes/player_rankings.py
from fastapi import APIRouter, HTTPException, Depends
from typing import List, Annotated
from app.models import Player
from app.exceptions import ResourceNotFoundError
from app.services.player_rankings_service import PlayerRankingsService
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

PlayerRankingsServiceDep = Annotated[PlayerRankingsService, Depends(PlayerRankingsService)]


@router.get("/", response_model=List[Player])
async def get_player_rankings(service: PlayerRankingsServiceDep):
    try:
        return await service.get_player_rankings()
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting player rankings: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve player rankings")
```

- [ ] **Step 4: Register in main.py**

In `backend/app/main.py`, add after the existing imports:
```python
from app.routes.player_rankings import router as player_rankings_router
```

And after the last `app.include_router(...)` line:
```python
app.include_router(player_rankings_router, prefix="/api/player-rankings", tags=["Player Rankings"])
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/routes/test_player_rankings.py -v
```
Expected: 3 tests PASSED

- [ ] **Step 6: Run full backend test suite**

```bash
cd backend && python -m pytest -v
```
Expected: all existing tests still PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/routes/player_rankings.py backend/tests/routes/test_player_rankings.py backend/app/main.py
git commit -m "feat(backend): add GET /api/player-rankings endpoint"
```

---

## Task 3: Frontend — Env Var + RTK Query Endpoint

**Files:**
- Create: `frontend/.env`
- Create: `frontend/.env.example`
- Modify: `frontend/src/vite-env.d.ts`
- Modify: `frontend/src/store/api/fantasyApi.ts`

No tests for this task — RTK Query wiring is verified by the page rendering correctly.

- [ ] **Step 1: Create env files**

```bash
# frontend/.env
VITE_SHOW_PLAYER_RANKINGS=false
```

```bash
# frontend/.env.example
VITE_API_BASE_URL=http://localhost:8000/api
VITE_SHOW_PLAYER_RANKINGS=false
```

- [ ] **Step 2: Declare env var type**

Replace contents of `frontend/src/vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_SHOW_PLAYER_RANKINGS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 3: Add RTK Query endpoint**

In `frontend/src/store/api/fantasyApi.ts`, add `PlayerRankings` to the `tagTypes` array:
```typescript
tagTypes: ['Rankings', 'Team', 'League', 'Heatmap', 'Shots', 'Teams', 'TradeSuggestions', 'Players', 'Estimator', 'PlayerRankings'],
```

Add this endpoint inside the `endpoints: (builder) => ({` block, after the last endpoint and before the closing `})`:
```typescript
getPlayerRankings: builder.query<Player[], void>({
  query: () => '/player-rankings/',
  providesTags: ['PlayerRankings'],
  keepUnusedDataFor: 300,
}),
```

Add `Player` to the imports at the top of the file (it's already imported via `PaginatedPlayers` destructuring — just add it to the existing import):
```typescript
import type { LeagueRankings, TeamDetail, LeagueSummary, HeatmapData, LeagueShotsData, TeamPlayers, Team, TradeSuggestionsResponse, PaginatedPlayers, TimePeriod, RankingsOverTimeResponse, OverTimeSource, NbaTeamInfo, TeamDepthChart, Player } from '../../types/api';
```

Add `useGetPlayerRankingsQuery` to the exports at the bottom:
```typescript
export const {
  useGetRankingsQuery,
  useGetTeamDetailQuery,
  useGetLeagueSummaryQuery,
  useGetHeatmapDataQuery,
  useGetLeagueShotsQuery,
  useGetTeamsListQuery,
  useGetTeamPlayersQuery,
  useGetTradeSuggestionsQuery,
  useGetAllPlayersQuery,
  useGetRankingsOverTimeQuery,
  useGetEstimatorResultsQuery,
  useGetNbaTeamsListQuery,
  useGetNbaTeamDepthChartQuery,
  useGetPlayerRankingsQuery,
} = fantasyApi;
```

- [ ] **Step 4: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/.env frontend/.env.example frontend/src/vite-env.d.ts frontend/src/store/api/fantasyApi.ts
git commit -m "feat(frontend): add VITE_SHOW_PLAYER_RANKINGS flag and getPlayerRankings RTK endpoint"
```

---

## Task 4: Frontend — Z-Score Utility + Tests

**Files:**
- Create: `frontend/src/utils/playerRankings.ts`
- Create: `frontend/src/utils/__tests__/playerRankings.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/utils/__tests__/playerRankings.test.ts
import { describe, it, expect } from 'vitest'
import { computePlayerRankings, CATEGORIES } from '../playerRankings'
import type { Player } from '../../types/api'
import type { RankingsConfig } from '../playerRankings'

function makePlayer(overrides: {
  name?: string
  pts?: number
  reb?: number
  ast?: number
  stl?: number
  blk?: number
  three_pm?: number
  fg_percentage?: number
  ft_percentage?: number
  gp?: number
  minutes?: number
  positions?: string[]
}): Player {
  return {
    player_name: overrides.name ?? 'Player',
    pro_team: 'LAL',
    positions: overrides.positions ?? ['PG'],
    stats: {
      pts: overrides.pts ?? 20,
      reb: overrides.reb ?? 5,
      ast: overrides.ast ?? 5,
      stl: overrides.stl ?? 1,
      blk: overrides.blk ?? 0.5,
      three_pm: overrides.three_pm ?? 2,
      fg_percentage: overrides.fg_percentage ?? 0.47,
      ft_percentage: overrides.ft_percentage ?? 0.85,
      fgm: 8, fga: 17, ftm: 4, fta: 5,
      minutes: overrides.minutes ?? 30,
      gp: overrides.gp ?? 70,
    },
    team_id: 1,
    status: 'ONTEAM',
  }
}

const defaultWeights = Object.fromEntries(CATEGORIES.map(c => [c, 1])) as Record<typeof CATEGORIES[number], number>

const defaultConfig: RankingsConfig = {
  calcMode: 'per_game',
  minGp: 0,
  minMin: 0,
  position: null,
  weights: defaultWeights,
}

function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) =>
    makePlayer({ name: `P${i}`, pts: i + 1, gp: 70 })
  )
}

describe('computePlayerRankings', () => {
  it('returns at most 200 players even with large pool', () => {
    const players = makePlayers(400)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBeLessThanOrEqual(200)
  })

  it('returns all players when pool < 200', () => {
    const players = makePlayers(10)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBe(10)
  })

  it('sorts by totalZ descending', () => {
    const players = [
      makePlayer({ name: 'Low', pts: 5 }),
      makePlayer({ name: 'High', pts: 40 }),
      makePlayer({ name: 'Mid', pts: 20 }),
    ]
    const result = computePlayerRankings(players, defaultConfig)
    expect(result[0].player.player_name).toBe('High')
    expect(result[result.length - 1].player.player_name).toBe('Low')
  })

  it('minGp filter excludes low-GP players', () => {
    const players = [
      makePlayer({ name: 'Active', gp: 60 }),
      makePlayer({ name: 'Injured', gp: 5 }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, minGp: 20 })
    expect(result.some(r => r.player.player_name === 'Injured')).toBe(false)
    expect(result.some(r => r.player.player_name === 'Active')).toBe(true)
  })

  it('minMin filter excludes low-minutes players', () => {
    const players = [
      makePlayer({ name: 'Starter', minutes: 30 }),
      makePlayer({ name: 'GLeague', minutes: 5 }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, minMin: 15 })
    expect(result.some(r => r.player.player_name === 'GLeague')).toBe(false)
  })

  it('position filter excludes players not at that position', () => {
    const players = [
      makePlayer({ name: 'Guard', positions: ['PG', 'SG'] }),
      makePlayer({ name: 'Big', positions: ['PF', 'C'] }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, position: 'PG' })
    expect(result.some(r => r.player.player_name === 'Big')).toBe(false)
    expect(result.some(r => r.player.player_name === 'Guard')).toBe(true)
  })

  it('punted category (weight=0) contributes 0 to totalZ', () => {
    const players = [
      makePlayer({ name: 'A', pts: 40, ast: 1 }),
      makePlayer({ name: 'B', pts: 5, ast: 20 }),
    ]
    const puntPts = { ...defaultWeights, pts: 0 }
    const result = computePlayerRankings(players, { ...defaultConfig, weights: puntPts })
    expect(result[0].player.player_name).toBe('B')
    expect(result[0].zScores.pts).toBeDefined()
  })

  it('per_game mode divides counting stats by GP', () => {
    const players = [
      makePlayer({ name: 'HighVolume', pts: 2000, gp: 100 }),
      makePlayer({ name: 'LowGames', pts: 600, gp: 20 }),
    ]
    const perGameResult = computePlayerRankings(players, { ...defaultConfig, calcMode: 'per_game' })
    const totalsResult = computePlayerRankings(players, { ...defaultConfig, calcMode: 'totals' })
    expect(perGameResult[0].player.player_name).toBe('LowGames')
    expect(totalsResult[0].player.player_name).toBe('HighVolume')
  })

  it('fg_percentage is not divided by GP in per_game mode', () => {
    const players = [
      makePlayer({ name: 'A', fg_percentage: 0.6, gp: 10 }),
      makePlayer({ name: 'B', fg_percentage: 0.4, gp: 80 }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, calcMode: 'per_game' })
    expect(result[0].player.player_name).toBe('A')
  })

  it('two-pass: pool >= 300 uses top-300 as second reference', () => {
    const players = makePlayers(350)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result.length).toBeGreaterThan(0)
  })

  it('single pass when filtered pool < 300', () => {
    const players = makePlayers(50)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBe(50)
  })

  it('each player has zScores for all categories', () => {
    const players = makePlayers(5)
    const result = computePlayerRankings(players, defaultConfig)
    for (const ranked of result) {
      for (const cat of CATEGORIES) {
        expect(ranked.zScores[cat]).toBeDefined()
        expect(typeof ranked.zScores[cat]).toBe('number')
      }
    }
  })

  it('returns empty array when all players filtered out', () => {
    const players = makePlayers(5)
    const result = computePlayerRankings(players, { ...defaultConfig, minGp: 999 })
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/utils/__tests__/playerRankings.test.ts
```
Expected: `Cannot find module '../playerRankings'`

- [ ] **Step 3: Implement the utility**

```typescript
// frontend/src/utils/playerRankings.ts
import type { Player } from '../types/api'

export type RankingCategory = 'fg_pct' | 'ft_pct' | 'three_pm' | 'reb' | 'ast' | 'stl' | 'blk' | 'pts'

export const CATEGORIES: RankingCategory[] = ['fg_pct', 'ft_pct', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts']

export const CATEGORY_LABELS: Record<RankingCategory, string> = {
  fg_pct: 'FG%',
  ft_pct: 'FT%',
  three_pm: '3PM',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  pts: 'PTS',
}

const COUNTING_CATS = new Set<RankingCategory>(['three_pm', 'reb', 'ast', 'stl', 'blk', 'pts'])

export interface RankingsConfig {
  calcMode: 'totals' | 'per_game'
  minGp: number
  minMin: number
  position: string | null
  weights: Record<RankingCategory, number>
}

export interface RankedPlayer {
  player: Player
  zScores: Record<RankingCategory, number>
  totalZ: number
}

function getCatValue(player: Player, cat: RankingCategory, calcMode: 'totals' | 'per_game'): number {
  const s = player.stats
  const gp = Math.max(s.gp, 1)
  const raw: Record<RankingCategory, number> = {
    fg_pct: s.fg_percentage,
    ft_pct: s.ft_percentage,
    three_pm: s.three_pm,
    reb: s.reb,
    ast: s.ast,
    stl: s.stl,
    blk: s.blk,
    pts: s.pts,
  }
  return calcMode === 'per_game' && COUNTING_CATS.has(cat) ? raw[cat] / gp : raw[cat]
}

function zScoreArray(values: number[]): number[] {
  if (values.length === 0) return []
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const stdev = Math.sqrt(variance)
  return values.map(v => (stdev === 0 ? 0 : (v - mean) / stdev))
}

function totalZArray(pool: Player[], calcMode: 'totals' | 'per_game', weights: Record<RankingCategory, number>): number[] {
  const catZs = CATEGORIES.map(cat => zScoreArray(pool.map(p => getCatValue(p, cat, calcMode))))
  return pool.map((_, i) => CATEGORIES.reduce((sum, cat, ci) => sum + catZs[ci][i] * weights[cat], 0))
}

export function computePlayerRankings(players: Player[], config: RankingsConfig): RankedPlayer[] {
  const { calcMode, minGp, minMin, position, weights } = config

  const filtered = players.filter(p =>
    p.stats.gp >= minGp &&
    p.stats.minutes >= minMin &&
    (position === null || p.positions.includes(position))
  )

  if (filtered.length === 0) return []

  let referencePool: Player[]
  if (filtered.length >= 300) {
    const pass1Z = totalZArray(filtered, calcMode, weights)
    referencePool = filtered
      .map((p, i) => ({ p, z: pass1Z[i] }))
      .sort((a, b) => b.z - a.z)
      .slice(0, 300)
      .map(x => x.p)
  } else {
    referencePool = filtered
  }

  const catZs = CATEGORIES.map(cat =>
    zScoreArray(referencePool.map(p => getCatValue(p, cat, calcMode)))
  )

  return referencePool
    .map((p, i) => {
      const zScores = Object.fromEntries(
        CATEGORIES.map((cat, ci) => [cat, catZs[ci][i]])
      ) as Record<RankingCategory, number>
      const totalZ = CATEGORIES.reduce((sum, cat) => sum + zScores[cat] * weights[cat], 0)
      return { player: p, zScores, totalZ }
    })
    .sort((a, b) => b.totalZ - a.totalZ)
    .slice(0, 200)
}

export function getRawValue(player: Player, cat: RankingCategory, displayMode: 'totals' | 'per_game'): number {
  return getCatValue(player, cat, displayMode)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/utils/__tests__/playerRankings.test.ts
```
Expected: all tests PASSED

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/playerRankings.ts frontend/src/utils/__tests__/playerRankings.test.ts
git commit -m "feat(frontend): add two-pass z-score player rankings utility"
```

---

## Task 5: Frontend — PlayerRankings Page

**Files:**
- Create: `frontend/src/pages/PlayerRankings.tsx`

- [ ] **Step 1: Create the page component**

```tsx
// frontend/src/pages/PlayerRankings.tsx
import { useState, useMemo } from 'react'
import { useGetPlayerRankingsQuery } from '../store/api/fantasyApi'
import {
  computePlayerRankings,
  getRawValue,
  CATEGORIES,
  CATEGORY_LABELS,
  type RankingCategory,
  type RankedPlayer,
  type RankingsConfig,
} from '../utils/playerRankings'

const DEFAULT_WEIGHTS = Object.fromEntries(CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

export default function PlayerRankings() {
  const { data: players = [], isLoading, error } = useGetPlayerRankingsQuery()

  const [calcMode, setCalcMode] = useState<'totals' | 'per_game'>('per_game')
  const [displayMode, setDisplayMode] = useState<'totals' | 'per_game'>('per_game')
  const [minGp, setMinGp] = useState(0)
  const [minMin, setMinMin] = useState(0)
  const [position, setPosition] = useState<string | null>(null)
  const [weights, setWeights] = useState<Record<RankingCategory, number>>({ ...DEFAULT_WEIGHTS })
  const [sortCol, setSortCol] = useState<'totalZ' | RankingCategory>('totalZ')
  const [sortAsc, setSortAsc] = useState(false)
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([])
  const [hasCalculated, setHasCalculated] = useState(false)

  const isPunted = (cat: RankingCategory) => weights[cat] === 0

  const togglePunt = (cat: RankingCategory) => {
    setWeights(w => ({ ...w, [cat]: w[cat] === 0 ? 1 : 0 }))
  }

  const handleCalculate = () => {
    const config: RankingsConfig = { calcMode, minGp, minMin, position, weights }
    setRankedPlayers(computePlayerRankings(players, config))
    setHasCalculated(true)
    setSortCol('totalZ')
    setSortAsc(false)
  }

  const sortedPlayers = useMemo(() => {
    if (!rankedPlayers.length) return []
    return [...rankedPlayers].sort((a, b) => {
      const aVal = sortCol === 'totalZ' ? a.totalZ : a.zScores[sortCol]
      const bVal = sortCol === 'totalZ' ? b.totalZ : b.zScores[sortCol]
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [rankedPlayers, sortCol, sortAsc])

  const handleSort = (col: typeof sortCol) => {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  const fmt = (n: number, decimals = 2) => n.toFixed(decimals)
  const fmtPct = (n: number) => (n * 100).toFixed(1) + '%'

  const rawDisplay = (ranked: RankedPlayer, cat: RankingCategory) => {
    const val = getRawValue(ranked.player, cat, displayMode)
    return cat === 'fg_pct' || cat === 'ft_pct' ? fmtPct(val) : fmt(val, 1)
  }

  if (isLoading) return <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading player data...</div>
  if (error) return <div className="p-8 text-center text-red-500">Failed to load players.</div>

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Player Rankings</h1>

        {/* Controls */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-6 space-y-4">

          {/* Mode toggles + filters row */}
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Calc mode</label>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                {(['totals', 'per_game'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setCalcMode(m)}
                    className={`px-3 py-1.5 ${calcMode === m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                  >
                    {m === 'totals' ? 'Totals' : 'Per Game'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Display mode</label>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                {(['totals', 'per_game'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setDisplayMode(m)}
                    className={`px-3 py-1.5 ${displayMode === m ? 'bg-purple-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                  >
                    {m === 'totals' ? 'Totals' : 'Per Game'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Min GP</label>
              <input
                type="number" min={0} value={minGp}
                onChange={e => setMinGp(Math.max(0, Number(e.target.value)))}
                className="w-20 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Min MIN (season)</label>
              <input
                type="number" min={0} value={minMin}
                onChange={e => setMinMin(Math.max(0, Number(e.target.value)))}
                className="w-24 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Position</label>
              <select
                value={position ?? ''}
                onChange={e => setPosition(e.target.value || null)}
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              >
                <option value="">All</option>
                {ALL_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Category weights */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CATEGORIES.map(cat => (
              <div key={cat} className={`flex items-center gap-2 p-2 rounded-lg border ${isPunted(cat) ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-8">{CATEGORY_LABELS[cat]}</span>
                <input
                  type="range" min={0} max={2} step={0.1}
                  value={isPunted(cat) ? 0 : weights[cat]}
                  disabled={isPunted(cat)}
                  onChange={e => setWeights(w => ({ ...w, [cat]: Number(e.target.value) }))}
                  className="flex-1 accent-blue-600"
                />
                <span className="text-xs text-gray-500 w-6">{isPunted(cat) ? '—' : weights[cat].toFixed(1)}</span>
                <button
                  onClick={() => togglePunt(cat)}
                  className={`text-xs px-1.5 py-0.5 rounded font-medium ${isPunted(cat) ? 'bg-red-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
                >
                  {isPunted(cat) ? 'PUNT' : 'punt'}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {players.length} players loaded · Blue toggle = calc mode · Purple = display mode
            </p>
            <button
              onClick={handleCalculate}
              disabled={players.length === 0}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
            >
              Calculate
            </button>
          </div>
        </div>

        {/* Results table */}
        {!hasCalculated && (
          <div className="text-center text-gray-400 dark:text-gray-500 py-16">
            Set your weights and press Calculate to rank players.
          </div>
        )}

        {hasCalculated && sortedPlayers.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 py-16">
            No players match the current filters.
          </div>
        )}

        {hasCalculated && sortedPlayers.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 sticky left-0 bg-gray-50 dark:bg-gray-900">Rank</th>
                  <Th col="totalZ" label="Z Score" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Player</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Team</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Pos</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">GP</th>
                  {CATEGORIES.map(cat => (
                    <th key={`raw-${cat}`} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {CATEGORY_LABELS[cat]}
                    </th>
                  ))}
                  {CATEGORIES.map(cat => (
                    <Th key={`z-${cat}`} col={cat} label={`${CATEGORY_LABELS[cat]}_z`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((ranked, idx) => (
                  <tr key={ranked.player.player_name + idx} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 sticky left-0 bg-white dark:bg-gray-800 text-center font-mono text-xs">{idx + 1}</td>
                    <td className="px-3 py-2 text-center font-semibold text-blue-600 dark:text-blue-400">{fmt(ranked.totalZ)}</td>
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{ranked.player.player_name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{ranked.player.pro_team}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{ranked.player.positions.join(', ')}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{ranked.player.stats.gp}</td>
                    {CATEGORIES.map(cat => (
                      <td key={`raw-${cat}`} className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                        {rawDisplay(ranked, cat)}
                      </td>
                    ))}
                    {CATEGORIES.map(cat => (
                      <td key={`z-${cat}`} className={`px-3 py-2 text-right font-mono text-xs ${isPunted(cat) ? 'text-gray-300 dark:text-gray-600' : ranked.zScores[cat] >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {fmt(ranked.zScores[cat])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Th({ col, label, sortCol, sortAsc, onSort, punted }: {
  col: 'totalZ' | RankingCategory
  label: string
  sortCol: string
  sortAsc: boolean
  onSort: (col: 'totalZ' | RankingCategory) => void
  punted?: boolean
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2 text-right text-xs font-semibold cursor-pointer select-none ${punted ? 'text-gray-300 dark:text-gray-600' : active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
    >
      {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PlayerRankings.tsx
git commit -m "feat(frontend): add PlayerRankings page with controls and z-score table"
```

---

## Task 6: Frontend — Feature Flag + Routing + Nav

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Add guarded route in App.tsx**

Add import at top of `frontend/src/App.tsx`:
```typescript
import PlayerRankings from './pages/PlayerRankings'
```

Add the feature flag constant after the existing imports:
```typescript
const SHOW_PLAYER_RANKINGS = import.meta.env.VITE_SHOW_PLAYER_RANKINGS === 'true'
```

Add the guarded route inside the `<Route path="/" element={<Layout />}>` block, before the `<Route path="*" .../>` line:
```tsx
{SHOW_PLAYER_RANKINGS && <Route path="player-rankings" element={<PlayerRankings />} />}
```

- [ ] **Step 2: Add guarded nav link in Layout.tsx**

In `frontend/src/components/Layout.tsx`, add the flag after imports:
```typescript
const SHOW_PLAYER_RANKINGS = import.meta.env.VITE_SHOW_PLAYER_RANKINGS === 'true'
```

Add to the `navItems` array (inside the component, after the `nba-teams` entry):
```typescript
...(SHOW_PLAYER_RANKINGS ? [{ path: '/player-rankings', label: 'Rankings', icon: '📋' }] : []),
```

- [ ] **Step 3: Type-check + run tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: no TypeScript errors, all tests PASSED

- [ ] **Step 4: Verify flag works**

Enable the flag temporarily:
```bash
# In frontend/.env, change to:
VITE_SHOW_PLAYER_RANKINGS=true
```

Start dev server and visit `http://localhost:5173/player-rankings`. Verify:
- Page loads without error
- "Loading player data..." appears then player list populates
- Calculate button triggers ranking computation
- Punt toggles gray out z-score columns
- Sort works on any column
- Display mode toggle changes raw values without recalculating

Revert flag to `false` after verifying.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx frontend/.env
git commit -m "feat(frontend): add guarded /player-rankings route and nav link behind VITE_SHOW_PLAYER_RANKINGS"
```

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Backend GET /api/player-rankings returning all players | Task 1 + 2 |
| Reuses get_players_df(0) cache | Task 1 |
| Frontend z-score calculation (basic formula) | Task 4 |
| Two-pass algorithm (≥300 pool) | Task 4 |
| Per game / totals calc mode toggle | Task 4 + 5 |
| Display mode toggle (independent) | Task 5 |
| Category weight sliders 0-2 | Task 5 |
| Punt toggle per category | Task 5 |
| Min GP filter | Task 4 + 5 |
| Min MIN filter | Task 4 + 5 |
| Position filter | Task 4 + 5 |
| Calculate button (not auto) | Task 5 |
| Table: Rank, Z Score near Rank | Task 5 |
| Table: raw stats block then z-score block | Task 5 |
| Category order: FG%, FT%, 3PM, REB, AST, STL, BLK, PTS | Task 4 + 5 |
| Sortable by any column | Task 5 |
| Punted columns grayed in table | Task 5 |
| Top 200 shown | Task 4 |
| VITE_SHOW_PLAYER_RANKINGS env var feature flag | Task 3 + 6 |
| Route + nav hidden when flag false | Task 6 |
