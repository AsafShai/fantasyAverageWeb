// League-sized mock data (12 teams) for the League Analytics and Standings
// Estimator phone specs. Deterministic: a tiny seeded generator, no Math.random.

export const TEAMS = [
  'Khachapuri’s Team', 'DORELIT', 'Hapoel Yifat', 'Roy\'s Rowdy Team', 'Maccabi Haifa NBA 777', 'Dor\'s Injured Team',
  'Trust the process', 'Machlins team', 'Amihai\'s Awesome Team', 'Oriel\'s Otherworldly Team', 'Asaf\'s Astounding Team', 'Chat GPT',
].map((team_name, i) => ({ team_id: i + 1, team_name }))

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const CATS = ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS', 'GP']
const BASE: Record<string, [number, number]> = {
  'FG%': [0.43, 0.05], 'FT%': [0.75, 0.08], '3PM': [1.2, 0.8], REB: [4.6, 1.6], AST: [2.6, 1.2],
  STL: [0.75, 0.3], BLK: [0.5, 0.3], PTS: [12.5, 3], GP: [70, 25],
}

function ranksFor(values: number[]) {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const ranks: number[] = []
  order.forEach(([, i], r) => { ranks[i] = r + 1 })
  return ranks
}

export function heatmap() {
  const r = rng(7)
  const cols = CATS.map((c) => TEAMS.map(() => BASE[c][0] + BASE[c][1] * r()))
  const ranks = cols.map(ranksFor)
  const norm = cols.map((col) => {
    const lo = Math.min(...col), hi = Math.max(...col)
    return col.map((v) => (v - lo) / (hi - lo))
  })
  return {
    teams: TEAMS,
    categories: CATS,
    data: TEAMS.map((_, t) => CATS.map((c, k) => (c === 'GP' ? Math.round(cols[k][t]) : cols[k][t]))),
    normalized_data: TEAMS.map((_, t) => CATS.map((_c, k) => norm[k][t])),
    ranks_data: TEAMS.map((_, t) => CATS.map((_c, k) => ranks[k][t])),
    data_date: '2026-10-18',
  }
}

export function shots() {
  const r = rng(11)
  return {
    last_updated: '2026-10-18T08:00:00Z',
    data_date: '2026-10-18',
    shots: TEAMS.map((team) => {
      const fga = 800 + Math.round(450 * r())
      const fgm = Math.round(fga * (0.43 + 0.06 * r()))
      const fta = 230 + Math.round(200 * r())
      const ftm = Math.round(fta * (0.72 + 0.12 * r()))
      return { team, fgm, fga, fg_percentage: fgm / fga, ftm, fta, ft_percentage: ftm / fta, gp: 160 + Math.round(60 * r()) }
    }),
  }
}

const RK = ['rk_fg_pct', 'rk_ft_pct', 'rk_three_pm', 'rk_reb', 'rk_ast', 'rk_stl', 'rk_blk', 'rk_pts'] as const

export function overTime() {
  const r = rng(3)
  const days = 24
  const level = TEAMS.map(() => 30 + 50 * r())
  const data = []
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.UTC(2026, 8, 25 + d)).toISOString().slice(0, 10)
    for (const [i, t] of TEAMS.entries()) {
      level[i] = Math.max(12, Math.min(90, level[i] + (r() - 0.5) * 8))
      const point: Record<string, unknown> = { date, ...t, rk_total: Math.round(level[i] * 10) / 10, gp: d * 6 + i }
      for (const k of RK) point[k] = Math.max(1, Math.min(12, Math.round(level[i] / 7.5 + (r() - 0.5) * 3)))
      point.values = { PTS: 100 + level[i], REB: 40 + level[i] / 3, 'FG%': 0.45 + level[i] / 2000 }
      data.push(point)
    }
  }
  return { data, categories: ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS'], reverse_categories: [] }
}

const KEYS = ['fg_pct', 'ft_pct', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts'] as const

export function estimator() {
  const r = rng(5)
  const strength = TEAMS.map((_, i) => 12 - i + r() * 2)
  const rankings = TEAMS.map((t, i) => {
    const row: Record<string, number | string> = { ...t, rank: i + 1, projected_total_gp: 780 + Math.round(60 * r()) }
    let total = 0
    for (const k of KEYS) {
      const v = Math.max(1, Math.min(12, strength[i] * 0.6 + r() * 5))
      row[`expected_pts_${k}`] = v
      total += v
    }
    row.total_expected_pts = total
    return row
  })
  const predictions = TEAMS.map((t) => ({
    ...t, as_of_date: '2026-10-18', projected_total_gp: 780 + Math.round(60 * r()), nba_avg_pace: 99.4,
    estimated_final_fg_pct: 44 + 5 * r(), variance_fg_pct: 4 + 6 * r(),
    estimated_final_ft_pct: 76 + 6 * r(), variance_ft_pct: 12 + 30 * r(),
    estimated_final_three_pm: 950 + 700 * r(), variance_three_pm: 30000 + 90000 * r(),
    estimated_final_reb: 3600 + 1400 * r(), variance_reb: 90000 + 200000 * r(),
    estimated_final_ast: 2000 + 900 * r(), variance_ast: 40000 + 90000 * r(),
    estimated_final_stl: 600 + 250 * r(), variance_stl: 3000 + 9000 * r(),
    estimated_final_blk: 350 + 250 * r(), variance_blk: 2000 + 9000 * r(),
    estimated_final_pts: 9500 + 3000 * r(), variance_pts: 400000 + 900000 * r(),
  }))
  const rank_probabilities = TEAMS.flatMap((t, i) => {
    const w = TEAMS.map((_, p) => Math.exp(-((p - i) ** 2) / 8) * (0.6 + r()))
    const sum = w.reduce((a, b) => a + b, 0)
    return w.map((x, p) => ({ ...t, rank: p + 1, prob: x / sum }))
  })
  return { as_of_date: '2026-10-18', elapsed_ms: 812, predictions, rankings, rank_probabilities }
}

export const INSIGHTS_API = {
  '/analytics/heatmap': heatmap(),
  '/league/shots': shots(),
  '/analytics/over-time': overTime(),
  '/estimator/results': estimator(),
}
