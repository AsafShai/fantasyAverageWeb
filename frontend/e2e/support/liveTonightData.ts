// A 12-team league in the four "moment of the day" states, for the tonight
// specs (PR 5): Rankings / Today movers, Top 5, league averages, heatmap GP,
// date ranges that end today and the Rankings Over Time live point. Numbers
// follow the design canvas artboards so the screenshots read like them.

export type Moment = 'before tip-off' | 'games live' | 'all final, ESPN pending' | 'ESPN official' | 'flag off'
type Key = 'official' | 'live' | 'final'

const OFFICIAL_AT = '2026-11-12T08:15:00Z'
const AS_OF = '2026-11-13T01:42:00Z'
export const SLATE = '2026-11-12'

export const LIVE_BLOCKS: Record<Moment, Record<string, unknown> | undefined> = {
  'before tip-off': { active: false, period: 24, as_of: null, games_total: 4, games_live: 0, games_final: 0, official_updated_at: OFFICIAL_AT },
  'games live': { active: true, period: 24, as_of: AS_OF, games_total: 4, games_live: 2, games_final: 1, official_updated_at: OFFICIAL_AT },
  'all final, ESPN pending': { active: true, period: 24, as_of: AS_OF, games_total: 4, games_live: 0, games_final: 4, official_updated_at: OFFICIAL_AT },
  'ESPN official': { active: false, period: 25, as_of: null, games_total: 0, games_live: 0, games_final: 0, official_updated_at: '2026-11-13T08:15:00Z' },
  'flag off': undefined,
}
const keyOf = (m: Moment): Key => (m === 'games live' ? 'live' : m === 'all final, ESPN pending' ? 'final' : 'official')

const NAMES = ["Asaf's Astounding Team", "Oriel's Otherworldly Team", 'DORELIT', 'Chat GPT', "Roy's Rowdy Team", "Dor's Injured Team",
  "Khachapuri's Team", "Amihai's Awesome Team", 'Trust the process', 'Hapoel Yifat', 'Maccabi Haifa NBA 777', 'Machlins team']
const CATS = ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS']
const FIELDS = ['fg_percentage', 'ft_percentage', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts']

// Per team: [GP, FG%, FT%, 3PM, REB, AST, STL, BLK, PTS] as roto points.
const P: Record<Key, number[][]> = {
  official: [[102,4,6,2,5,2,12,6,2],[121,10,7,1,6,7,7,8,3],[112,12,5,11,8,9,8,9,10],[112,5,9,4,1,1,5,5,1],[127,9,4,7,3,3,9,12,12],[107,2,8,10,10,11,10,2,9],[113,11,12,8,9,4,11,11,6],[129,1,3,6,4,5,3,7,5],[112,7,1,9,11,10,4,3,8],[123,6,11,3,12,6,1,10,7],[113,3,2,12,7,12,6,4,11],[111,8,10,5,2,8,2,1,4]],
  live: [[102,4,6,2,5,2,12,6,2],[121,11,8,1,6,7,7,8,3],[112,12,5,11,8,9,8,9,10],[114,5,7,4,1,1,5,5,1],[127,9,4,7,3,3,9,12,12],[109,2,9,9,10,11,10,2,9],[114,10,12,8,11,4,11,11,6],[129,1,3,6,4,5,2,7,5],[113,7,1,10,9,10,4,4,8],[124,6,11,3,12,6,1,10,7],[113,3,2,12,7,12,6,3,11],[112,8,10,5,2,8,3,1,4]],
  final: [[104,3,5,2,5,1,12,6,2],[122,10,8,1,6,6,6,8,3],[113,12,6,11,8,9,8,9,10],[115,6,7,3,1,2,5,5,1],[128,9,4,7,3,3,9,12,12],[110,2,9,9,10,11,10,2,9],[115,11,12,8,11,4,11,11,6],[130,1,3,6,4,5,3,7,5],[113,7,1,10,9,10,4,4,7],[127,5,11,4,12,7,1,10,8],[115,4,2,12,7,12,7,3,11],[112,8,10,5,2,8,2,1,4]],
}
// Per team per category values (FG%/FT% in percent).
const V: Record<Key, number[][]> = {
  official: [[46.14,80.19,1.37,5.58,3.25,1.26,0.6,14.81],[47.7,80.38,1.27,5.6,3.88,1.04,0.65,15.4],[48.94,79.7,1.95,5.98,4.17,1.07,0.72,18.03],[46.63,80.78,1.66,4.79,3.15,0.99,0.55,13.81],[47.53,79.1,1.8,5.32,3.3,1.08,0.86,18.98],[44.0,80.75,1.87,6.06,4.58,1.08,0.48,17.82],[47.71,83.4,1.81,6.05,3.34,1.14,0.82,17.24],[43.74,78.49,1.78,5.48,3.78,0.95,0.64,16.04],[47.02,75.69,1.87,6.08,4.24,0.97,0.51,17.35],[46.67,82.77,1.65,6.61,3.8,0.93,0.76,17.32],[45.76,76.4,1.96,5.96,4.84,1.02,0.51,18.27],[47.34,81.07,1.7,5.14,4.1,0.95,0.45,15.94]],
  live: [[46.14,80.19,1.37,5.58,3.25,1.26,0.6,14.81],[47.7,80.38,1.27,5.6,3.88,1.04,0.65,15.4],[48.94,79.7,1.95,5.98,4.17,1.07,0.72,18.03],[46.57,80.35,1.68,4.78,3.23,0.97,0.56,13.89],[47.53,79.1,1.8,5.32,3.3,1.08,0.86,18.98],[44.12,80.69,1.85,6.06,4.55,1.1,0.48,17.8],[47.65,83.4,1.82,6.1,3.36,1.15,0.82,17.19],[43.74,78.49,1.78,5.48,3.78,0.95,0.64,16.04],[46.89,75.51,1.88,6.05,4.21,0.97,0.52,17.34],[46.6,82.81,1.66,6.63,3.84,0.94,0.75,17.3],[45.76,76.4,1.96,5.96,4.84,1.02,0.51,18.27],[47.32,80.82,1.72,5.18,4.07,0.96,0.46,15.95]],
  final: [[46.24,79.64,1.35,5.62,3.24,1.28,0.62,14.73],[47.72,80.21,1.3,5.61,3.88,1.03,0.66,15.44],[48.78,79.41,1.95,6.03,4.2,1.09,0.73,18.04],[46.66,80.06,1.68,4.83,3.27,0.99,0.56,13.97],[47.52,78.98,1.8,5.33,3.34,1.09,0.87,18.95],[44.06,80.51,1.85,6.09,4.57,1.11,0.49,17.74],[47.75,83.4,1.84,6.11,3.39,1.17,0.82,17.23],[43.67,78.33,1.78,5.46,3.77,0.96,0.65,16.02],[46.89,75.51,1.88,6.05,4.21,0.97,0.52,17.34],[46.53,82.82,1.71,6.65,3.88,0.95,0.76,17.36],[45.84,76.46,1.95,6.02,4.84,1.04,0.52,18.21],[47.32,80.82,1.72,5.18,4.07,0.96,0.46,15.95]],
}

const team = (i: number) => ({ team_id: i + 1, team_name: NAMES[i] })
const total = (r: number[]) => r.slice(1).reduce((a, b) => a + b, 0)
const places = (rows: number[][]) => { const t = rows.map(total); return t.map(x => 1 + t.filter(y => y > x).length) }

function rankingRows(k: Key) {
  const place = places(P[k])
  return P[k].map((r, i) => {
    const stats: Record<string, number> = {}
    const row: Record<string, unknown> = { team: team(i), gp: r[0], total_points: total(r), rank: place[i] }
    CATS.forEach((c, j) => {
      const v = j < 2 ? V[k][i][j] / 100 : V[k][i][j]
      stats[c] = v
      row[FIELDS[j]] = v
    })
    row.category_ranks = Object.fromEntries(CATS.map((c, j) => [c, r[j + 1]]))
    row.stats = stats
    return row
  }).sort((a, b) => (b.total_points as number) - (a.total_points as number))
}

const withBlock = (m: Moment, body: Record<string, unknown>) => (LIVE_BLOCKS[m] ? { ...body, live: LIVE_BLOCKS[m] } : body)

export function rankings(m: Moment) {
  const rows = rankingRows(keyOf(m))
  return withBlock(m, { averages_rankings: rows, totals_rankings: rows, categories: [...CATS, 'TOTAL_POINTS'], last_updated: AS_OF })
}

export function rangeRankings(m: Moment, url: string) {
  const live = keyOf(m) !== 'official'
  const start = live ? '2026-11-06' : '2026-11-05'
  const end = live ? SLATE : '2026-11-11'
  const q = new URL(url).searchParams
  const rows = rankingRows(keyOf(m))
  const body = { averages_rankings: rows, totals_rankings: rows, categories: [...CATS, 'TOTAL_POINTS'], last_updated: AS_OF,
    date_range_start: q.get('start_date'), date_range_end: q.get('end_date'), actual_start_date: start, actual_end_date: end }
  return m === 'ESPN official' ? body : withBlock(m, body)
}

// Last night's moves, as the morning shows them before tip-off.
const PRE = { total: [-2, 5, -1, 0, 1, -1, 3, -4, -0.5, -7, 2, 5], place: [-1, 0, 0, 0, 1, 0, 1, -1, 0, -3, 1, 2], gp: [5, 8, 9, 6, 8, 5, 6, 9, 6, 10, 7, 5] }

export function rankChanges(m: Moment) {
  const k = keyOf(m)
  if (k === 'official') {
    return withBlock(m, { previous_period: 22, latest_period: 23, teams: NAMES.map((n, i) => ({
      team_id: i + 1, team_name: n, rank_delta: PRE.place[i], total_delta: PRE.total[i], gp_delta: PRE.gp[i], categories: {} })) })
  }
  const pb = places(P.official), pc = places(P[k])
  return withBlock(m, { previous_period: 23, latest_period: 24, teams: P[k].map((r, i) => {
    const b = P.official[i]
    return {
      team_id: i + 1, team_name: NAMES[i], rank_delta: pb[i] - pc[i], total_delta: total(r) - total(b), gp_delta: r[0] - b[0],
      categories: Object.fromEntries(CATS.map((c, j) => [c, r[j + 1] - b[j + 1]])),
    }
  }) })
}

const mover = (name: string, category: string, delta: number) => ({ team_id: NAMES.indexOf(name) + 1, team_name: name, category, delta })
const YEST = [['Hapoel Yifat', 'TOTAL', -7], ['Machlins team', 'TOTAL', 5], ["Oriel's Otherworldly Team", 'TOTAL', 5], ["Amihai's Awesome Team", 'TOTAL', -4], ['Hapoel Yifat', 'FG%', -3], ["Khachapuri's Team", 'TOTAL', 3], ["Amihai's Awesome Team", '3PM', -2], ['Hapoel Yifat', 'STL', -2]] as const
const TONIGHT_LIVE = [["Oriel's Otherworldly Team", 'TOTAL', 2], ['Chat GPT', 'TOTAL', -2], ['Chat GPT', 'FT%', -2], ["Khachapuri's Team", 'REB', 2], ['Trust the process', 'REB', -2], ["Khachapuri's Team", 'TOTAL', 1], ['Machlins team', 'TOTAL', 1], ["Amihai's Awesome Team", 'TOTAL', -1]] as const
const TONIGHT_FINAL = [["Asaf's Astounding Team", 'TOTAL', -3], ['Hapoel Yifat', 'TOTAL', 2], ["Khachapuri's Team", 'TOTAL', 2], ["Khachapuri's Team", 'REB', 2], ['Trust the process', 'REB', -2], ['Chat GPT', 'FT%', -2], ['DORELIT', 'TOTAL', 1], ['Chat GPT', 'TOTAL', -1]] as const

export function todayHub(m: Moment, base: Record<string, unknown>) {
  const k = keyOf(m)
  const body: Record<string, unknown> = { ...base, slate_date: SLATE, games_count: 4, movers: YEST.map(([n, c, d]) => mover(n, c, d)) }
  if (k !== 'official') body.tonight_movers = (k === 'live' ? TONIGHT_LIVE : TONIGHT_FINAL).map(([n, c, d]) => mover(n, c, d))
  return withBlock(m, body)
}

const AVG: Record<Key, number[]> = {
  official: [0.466, 0.799, 1.72, 5.72, 3.87, 1.04, 0.63, 16.75, 9.31],
  live: [0.466, 0.798, 1.72, 5.72, 3.88, 1.04, 0.63, 16.75, 9.37],
  final: [0.465, 0.797, 1.73, 5.74, 3.89, 1.05, 0.64, 16.76, 9.46],
}
const averages = (k: Key) => ({ team: { team_id: 0, team_name: 'League' }, ...Object.fromEntries(FIELDS.map((f, j) => [f, AVG[k][j]])), gp: AVG[k][8] })

export function summary(m: Moment, base: Record<string, unknown>) {
  const k = keyOf(m)
  const body: Record<string, unknown> = { ...base, total_teams: 12, league_averages: averages(k), espn_updated_at: OFFICIAL_AT }
  delete body.data_date
  if (k !== 'official') body.league_averages_official = averages('official')
  return withBlock(m, body)
}

export function heatmap(m: Moment) {
  const k = keyOf(m)
  return withBlock(m, {
    teams: NAMES.map((_, i) => team(i)),
    categories: [...CATS, 'GP'],
    data: V[k].map((v, i) => [...v.map((x, j) => (j < 2 ? x / 100 : x)), P[k][i][0]]),
    normalized_data: P[k].map(r => [...r.slice(1).map(p => (p - 6.5) / 5.5), 0]),
    ranks_data: P[k].map(r => [...r.slice(1), 0]),
    ...(k !== 'official' ? { gp_tonight: P[k].map((r, i) => r[0] - P.official[i][0]) } : {}),
  })
}

const DAYS = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']
export function overTime(m: Moment) {
  const k = keyOf(m)
  const base = P.official.map(total)
  // A gentle week of history ending at this morning's official totals.
  const data = DAYS.flatMap((date, d) => NAMES.map((n, i) => ({
    date, team_id: i + 1, team_name: n, rk_total: base[i] + Math.round(Math.sin(i * 1.7 + d) * 3) - (6 - d === 0 ? 0 : 0), gp: P.official[i][0] - (6 - d) * 2,
  })))
  data.filter(p => p.date === DAYS[6]).forEach(p => { p.rk_total = base[p.team_id - 1] })
  const body: Record<string, unknown> = { data, categories: [], reverse_categories: [] }
  if (k !== 'official') {
    body.live_points = P[k].map((r, i) => ({ date: SLATE, team_id: i + 1, team_name: NAMES[i], rk_total: total(r), gp: r[0] }))
  }
  return withBlock(m, body)
}
