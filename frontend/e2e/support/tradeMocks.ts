import type { Page } from '@playwright/test'
import { API_BASE_URL } from './mockApi'

// Trade Analyzer data: a few fantasy teams with rosters and category ranks,
// plus free agents in the all-players list.

const CATS = ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS']

export const TRADE_TEAMS = [
  { team_id: 1, team_name: 'Trust the process' },
  { team_id: 2, team_name: 'DORELIT' },
  { team_id: 3, team_name: "Khachapuri's" },
]

interface Line { pts: number; reb: number; ast: number; stl: number; blk: number; tpm: number; fgm: number; fga: number; ftm: number; fta: number; min: number }

function player(id: number, name: string, team: string, pos: string[], teamId: number, gp: number, l: Line, status: 'ONTEAM' | 'FREEAGENT' | 'WAIVERS' = 'ONTEAM') {
  const t = (v: number) => Math.round(v * gp)
  const fgm = t(l.fgm), fga = t(l.fga), ftm = t(l.ftm), fta = t(l.fta)
  return {
    player_id: id, player_name: name, pro_team: team, positions: pos, team_id: status === 'ONTEAM' ? teamId : 0, status,
    has_data: true,
    stats: {
      pts: t(l.pts), reb: t(l.reb), ast: t(l.ast), stl: t(l.stl), blk: t(l.blk), three_pm: t(l.tpm),
      fgm, fga, ftm, fta, fg_percentage: fga ? fgm / fga : 0, ft_percentage: fta ? ftm / fta : 0, minutes: t(l.min), gp,
    },
  }
}

const L = (pts: number, reb: number, ast: number, stl: number, blk: number, tpm: number, fgm: number, fga: number, ftm: number, fta: number, min: number): Line =>
  ({ pts, reb, ast, stl, blk, tpm, fgm, fga, ftm, fta, min })

export const TRADE_ROSTERS: Record<number, ReturnType<typeof player>[]> = {
  1: [
    player(4432582, 'Josh Giddey', 'CHI', ['PG', 'SG'], 1, 9, L(9.2, 4.6, 7.6, 1.0, 0.4, 1.0, 3.5, 9.0, 1.2, 1.8, 29.1)),
    player(4065648, 'Jayson Tatum', 'BOS', ['SF', 'PF'], 1, 8, L(26.4, 8.6, 5.9, 1.1, 0.6, 3.1, 9.0, 20.1, 5.3, 6.2, 36.0)),
    player(3907387, 'Domantas Sabonis', 'SAC', ['C'], 1, 9, L(19.1, 13.9, 6.2, 0.8, 0.4, 0.4, 7.8, 13.0, 3.1, 4.2, 34.6)),
  ],
  2: [
    player(6442, 'Jrue Holiday', 'POR', ['PG', 'SG'], 2, 8, L(13.4, 4.6, 6.4, 1.2, 0.4, 1.6, 5.0, 11.2, 1.8, 2.1, 30.5)),
    player(3136776, "D'Angelo Russell", 'DAL', ['PG'], 2, 9, L(14.2, 3.1, 5.6, 0.9, 0.3, 2.4, 5.1, 12.4, 1.6, 2.0, 27.3)),
  ],
  3: [
    player(3134907, 'Kyle Kuzma', 'MIL', ['SF', 'PF'], 3, 9, L(15.0, 6.0, 2.2, 0.6, 0.4, 1.8, 5.8, 13.0, 1.6, 2.3, 30.0)),
  ],
}

export const FREE_AGENTS = [
  player(4592691, 'Ziaire Williams', 'LAL', ['SG', 'SF'], 0, 9, L(10.7, 3.0, 2.0, 1.5, 0.3, 1.6, 4.0, 7.5, 1.0, 1.1, 24.2), 'FREEAGENT'),
  player(4397424, 'Ziaire Twin', 'NYK', ['PF'], 0, 7, L(6.1, 4.0, 1.0, 0.5, 0.6, 0.4, 2.4, 5.1, 0.9, 1.4, 18.0), 'WAIVERS'),
]

const RANKS: Record<number, number[]> = { 1: [5, 2, 12, 9, 9, 2, 5, 7], 2: [8, 6, 3, 11, 4, 1, 10, 6], 3: [1, 12, 7, 2, 10, 8, 3, 9] }

function teamDetail(id: number) {
  const team = TRADE_TEAMS.find((t) => t.team_id === id)!
  return {
    team, espn_url: 'https://fantasy.espn.com', players: TRADE_ROSTERS[id],
    category_ranks: Object.fromEntries(CATS.map((c, i) => [c, RANKS[id][i]])),
    data_date: '2026-11-06',
  }
}

/** Registered after the default mocks, so these win. */
export async function mockTradeApi(page: Page) {
  const all = [...Object.values(TRADE_ROSTERS).flat().map((p) => ({ ...p, fantasy_team_name: TRADE_TEAMS.find((t) => t.team_id === p.team_id)?.team_name })), ...FREE_AGENTS]
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '').replace(/\/$/, '')
    if (path === '/teams') return route.fulfill({ json: TRADE_TEAMS })
    const m = path.match(/^\/teams\/(\d+)$/)
    if (m && TRADE_ROSTERS[Number(m[1])]) return route.fulfill({ json: teamDetail(Number(m[1])) })
    if (path === '/players') return route.fulfill({ json: { players: all, total_count: all.length, page: 1, limit: 1200, has_more: false } })
    return route.fallback()
  })
}
