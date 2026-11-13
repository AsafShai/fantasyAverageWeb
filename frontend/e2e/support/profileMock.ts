import type { Page } from '@playwright/test'
import { API_BASE_URL } from './mockApi'

// Player profile data for the e2e specs: one player (id 3908809) with a bio,
// season stats, a game log, a trends log and a next-game projection, plus a
// pool of 150 generated players so rank and z-scores look like the real page.

export const PROFILE_ID = 3908809

// [date, opponent, home, team pts, opp pts, min, pts, reb, ast, stl, blk, tov, fgm, fga, 3pm, 3pa, ftm, fta, +/-]
type G = [string, string, boolean, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]
const GAMES: G[] = [
  ['2026-11-04', 'OKC', false, 116, 124, 33, 27, 3, 6, 1, 0, 2, 10, 20, 3, 8, 4, 4, -6],
  ['2026-11-02', 'OKC', true, 112, 117, 36, 17, 5, 11, 0, 0, 3, 6, 15, 2, 7, 3, 4, -3],
  ['2026-10-31', 'MIL', false, 136, 111, 24, 15, 4, 3, 0, 0, 2, 6, 12, 2, 5, 1, 2, 18],
  ['2026-10-29', 'ATL', false, 111, 114, 33, 22, 3, 3, 1, 0, 0, 8, 17, 3, 8, 3, 4, -1],
  ['2026-10-28', 'WAS', true, 121, 111, 31, 19, 5, 7, 2, 0, 5, 7, 15, 2, 6, 3, 3, 9],
  ['2026-10-26', 'MIN', true, 127, 125, 38, 26, 5, 7, 2, 1, 3, 9, 18, 4, 9, 4, 5, 4],
  ['2026-10-24', 'BKN', true, 125, 121, 35, 22, 5, 4, 1, 1, 4, 8, 16, 3, 7, 3, 4, 7],
  ['2026-10-22', 'PHI', false, 106, 114, 35, 32, 10, 3, 2, 1, 5, 8, 15, 4, 9, 12, 14, -10],
]

const sum = (i: number) => GAMES.reduce((a, g) => a + (g[i] as number), 0)

function line(div: number) {
  const fgm = sum(12), fga = sum(13), ftm = sum(16), fta = sum(17)
  const r = (v: number) => Math.round((v / div) * 10) / 10
  return {
    pts: r(sum(6)), reb: r(sum(7)), ast: r(sum(8)), stl: r(sum(9)), blk: r(sum(10)),
    fgm: r(fgm), fga: r(fga), ftm: r(ftm), fta: r(fta), three_pm: r(sum(14)), minutes: r(sum(5)),
    fg_percentage: fgm / fga, ft_percentage: ftm / fta, gp: GAMES.length,
  }
}

/** Players list: the profile player on team 1, plus a deterministic pool. */
function playersList() {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const pos = [['PG'], ['SG'], ['SF'], ['PF'], ['C'], ['PG', 'SG'], ['SF', 'PF'], ['PF', 'C']]
  const pool = Array.from({ length: 150 }, (_, i) => {
    const gp = 8, scale = 0.4 + rnd() * 0.9, fga = Math.round(80 + rnd() * 100), fta = Math.round(10 + rnd() * 40)
    const fgm = Math.round(fga * (0.4 + rnd() * 0.15)), ftm = Math.round(fta * (0.65 + rnd() * 0.25))
    return {
      player_id: 5000 + i, player_name: `Pool Player ${i + 1}`, pro_team: 'NBA', positions: pos[i % pos.length],
      team_id: (i % 12) + 1, status: i % 3 === 0 ? 'FREEAGENT' : 'ONTEAM', fantasy_team_name: i % 3 === 0 ? null : `Team ${(i % 12) + 1}`,
      stats: {
        pts: Math.round(130 * scale), reb: Math.round(50 * scale * (0.5 + rnd())), ast: Math.round(35 * scale * (0.5 + rnd())),
        stl: Math.round(8 * scale * (0.5 + rnd())), blk: Math.round(5 * scale * (0.3 + rnd() * 1.4)),
        fgm, fga, ftm, fta, fg_percentage: fgm / fga, ft_percentage: ftm / fta,
        three_pm: Math.round(16 * scale * rnd()), minutes: Math.round(240 * (0.6 + scale * 0.4)), gp,
      },
    }
  })
  const me = {
    player_id: PROFILE_ID, player_name: 'Donovan Mitchell', pro_team: 'CLE', positions: ['PG', 'SG'],
    team_id: 1, status: 'ONTEAM', fantasy_team_name: 'Trust the process', stats: line(1),
  }
  const players = [me, ...pool]
  return { players, total_count: players.length, page: 1, limit: 1200, has_more: false }
}

const pct = (made: number, att: number) => (sum(made) / sum(att)) * 100

function trendLog() {
  const games = [...GAMES].reverse().map((g) => ({
    game_date: g[0], matchup: `CLE ${g[2] ? 'vs.' : '@'} ${g[1]}`, min: g[5], usg: 24 + (g[6] % 5),
    fgm: g[12], fga: g[13], ftm: g[16], fta: g[17], fg3m: g[14], fg3a: g[15],
    pts: g[6], reb: g[7], ast: g[8], stl: g[9], blk: g[10], tov: g[11],
  }))
  return {
    player_id: PROFILE_ID, player_name: 'Donovan Mitchell', season: '2026-27', window_days: 15, window_start: '2026-10-21',
    season_gp: 8, season_mpg: 33.1, season_usg: 25.8,
    // percentages in percent units, as the backend sends them
    season_pct: { 'FG%': pct(12, 13), 'FT%': pct(16, 17), '3P%': pct(14, 15) }, baseline_pct: { 'FG%': 47.0, 'FT%': 86.0, '3P%': 37.0 },
    league_pct: { 'FG%': 47.1, 'FT%': 78.0, '3P%': 36.0 }, league_usg: 20, baseline_seasons: 0, games,
  }
}

export const PROJ_LINE = { pts: 22.6, reb: 4.6, ast: 5.2, three_pm: 2.8, stl: 1.1, blk: 0.4, fgm: 8.1, fga: 16.9, fg_pct: 0.479, ftm: 3.6, fta: 4.3, ft_pct: 0.837 }

/** Routes every profile request; returns the minutes sent to /projections/predict. */
export async function mockProfileApis(page: Page, opts: { gameDate?: string } = {}) {
  const predicted: number[] = []
  const players = playersList()
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '').replace(/\/$/, '')
    if (path === '/players') return route.fulfill({ json: players })
    if (path === `/nba-players/${PROFILE_ID}`)
      return route.fulfill({
        json: {
          id: String(PROFILE_ID), display_name: 'Donovan Mitchell', team: 'Cleveland Cavaliers', team_abbr: 'CLE',
          conference: 'East', division: 'Central', position: 'Guard', photo_url: null,
          height: `6' 2"`, nationality: 'USA', age: 30, jersey_number: '45',
        },
      })
    if (path === `/nba-players/${PROFILE_ID}/stats`)
      return route.fulfill({ json: { player_id: PROFILE_ID, totals: line(1), averages: line(GAMES.length), has_data: true } })
    if (path === `/nba-players/${PROFILE_ID}/games`)
      return route.fulfill({
        json: {
          player_id: PROFILE_ID, current_season: '2026-27',
          games: GAMES.map((g, i) => ({
            game_id: `40${i}`, season: '2026-27', game_date: g[0], opponent: g[1], is_home: g[2], team_pts: g[3], opp_pts: g[4],
            minutes: g[5], pts: g[6], reb: g[7], ast: g[8], stl: g[9], blk: g[10], tov: g[11],
            fgm: g[12], fga: g[13], fg3m: g[14], fg3a: g[15], ftm: g[16], fta: g[17], plus_minus: g[18],
          })),
        },
      })
    if (path === `/trends/player/${PROFILE_ID}/gamelog`) return route.fulfill({ json: trendLog() })
    if (path === `/projections/player/${PROFILE_ID}`)
      return route.fulfill({
        json: {
          player_name: 'Donovan Mitchell', team: 'CLE', game_date: opts.gameDate ?? '2026-10-21', opponent: 'PHI', is_home: true,
          scheduled: true, default_minutes: 33, status: 'green', reason: '', stats: PROJ_LINE,
        },
      })
    if (path === '/projections/predict') {
      const body = route.request().postDataJSON() as { minutes: number }
      predicted.push(body.minutes)
      return route.fulfill({ json: { stats: { ...PROJ_LINE, pts: 25.4 } } })
    }
    if (path === `/league/players/${PROFILE_ID}/history`) return route.fulfill({ json: leagueHistory() })
    return route.fallback()
  })
  return { predicted }
}

/** League history: drafted, dropped, claimed for 3 hours, then traded. */
export function leagueHistory() {
  const p = (player_id: number, name: string) => ({ player_id, name })
  const base = { from_team_id: null, pick: null, round: null, swapped: [], in_trade: false, trade_sides: [], trade_drops: [] }
  return {
    season_id: 2027,
    player_id: PROFILE_ID,
    teams: [
      { team_id: 1, name: 'Trust the process', abbrev: 'TTP' },
      { team_id: 4, name: 'DORELIT', abbrev: 'DOR' },
      { team_id: 8, name: "Dor's Injured Team", abbrev: 'DIT' },
    ],
    moves: [
      { ...base, id: 'd', kind: 'draft', at: '2026-10-15T20:08:00Z', team_id: 4, pick: 26, round: 3 },
      { ...base, id: 'r', kind: 'drop', at: '2026-10-20T04:20:00Z', team_id: 4 },
      { ...base, id: 'w', kind: 'waiver', at: '2026-10-21T07:27:00Z', team_id: 8, swapped: [p(7001, 'Aday Mara')] },
      { ...base, id: 'f', kind: 'drop', at: '2026-10-21T10:27:00Z', team_id: 8, swapped: [p(7002, 'Adem Bona')] },
      { ...base, id: 'a', kind: 'add', at: '2026-10-22T09:00:00Z', team_id: 4 },
      {
        ...base, id: 't', kind: 'trade', at: '2026-10-28T13:12:00Z', team_id: 1, from_team_id: 4,
        trade_sides: [
          { team_id: 1, players: [p(PROFILE_ID, 'Donovan Mitchell'), p(7003, 'Peyton Watson')] },
          { team_id: 4, players: [p(7004, 'Andrew Wiggins'), p(7005, 'Josh Giddey')] },
        ],
        trade_drops: [{ team_id: 1, players: [p(7006, 'Keon Ellis')] }],
      },
    ],
    stints: [
      { team_id: 4, start: '2026-10-15T20:08:00Z', end: '2026-10-20T04:20:00Z' },
      { team_id: 8, start: '2026-10-21T07:27:00Z', end: '2026-10-21T10:27:00Z' },
      { team_id: 4, start: '2026-10-22T09:00:00Z', end: '2026-10-28T13:12:00Z' },
      { team_id: 1, start: '2026-10-28T13:12:00Z', end: null },
    ],
    last_updated: '2026-11-05T12:00:00Z',
  }
}
