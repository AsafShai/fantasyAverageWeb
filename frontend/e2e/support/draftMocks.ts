// Draft Report / FA Report mocks: a 12-team, 13-round draft and a season pool
// with ~90 undrafted players, generated from a fixed seed so captures are stable.

const TEAMS = [
  "Oriel's Otherworldly Team", "Roy's Rowdy Team", 'DORELIT', "Amihai's Awesome Team", 'Maccabi Haifa NBA 777',
  'Hapoel Yifat', 'Chat GPT', 'Machlins team', "Asaf's Astounding Team", "Dor's Injured Team", "Khachapuri's Team",
  'Trust the process',
]
const FIRST = ['Nikola', 'Victor', 'Luka', 'Shai', 'Giannis', 'Jayson', 'Cade', 'Cooper', 'Anthony', 'Jalen', 'Tyrese', 'Donovan', 'Karl', 'Kevin', 'Scottie', 'Austin', 'Chet', 'Jamal', 'Alperen', 'Domantas', 'Josh', 'Stephen', 'Amen', 'Evan', 'Bam', 'LaMelo', 'Kawhi', 'Devin', 'Lauri', 'Trae', 'Deni', 'Trey', 'Derrick', 'Walker', 'Brandon', 'James', 'Darius', 'Jaren', 'Dyson', 'Duncan', 'Kris', 'Wendell', 'Jaxson', 'Alex', 'Matisse', 'Ziaire', 'Naji', 'Mo', 'Aaron', 'Max']
const LAST = ['Jokic', 'Wembanyama', 'Doncic', 'Gilgeous', 'Antetokounmpo', 'Tatum', 'Cunningham', 'Flagg', 'Edwards', 'Johnson', 'Maxey', 'Mitchell', 'Towns', 'Durant', 'Barnes', 'Reaves', 'Holmgren', 'Murray', 'Sengun', 'Sabonis', 'Giddey', 'Curry', 'Thompson', 'Mobley', 'Adebayo', 'Ball', 'Leonard', 'Booker', 'Markkanen', 'Young', 'Avdija', 'Murphy', 'White', 'Kessler', 'Miller', 'Harden', 'Garland', 'Jackson', 'Daniels', 'Robinson', 'Dunn', 'Carter', 'Hayes', 'Caruso', 'Thybulle', 'Williams', 'Marshall', 'Bamba', 'Wiggins', 'Strus']
const PRO = ['DEN', 'SAS', 'LAL', 'OKC', 'MIL', 'BOS', 'DET', 'DAL', 'MIN', 'ATL', 'PHI', 'CLE', 'NYK', 'HOU', 'TOR', 'ORL', 'MIA', 'GSW', 'IND', 'UTA']

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

export function draftMocks() {
  const r = rng(42)
  const names = new Set<string>()
  while (names.size < 250) names.add(`${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`)
  const all = [...names]

  // Better players get drafted earlier, with noise so some picks are steals and busts.
  const players = all.map((name, i) => {
    const q = Math.max(0.15, 1 - i / 260 + (r() - 0.5) * 0.5)
    const gp = i % 23 === 5 ? 0 : i % 19 === 3 ? 2 + Math.floor(r() * 6) : 10 + Math.floor(r() * 8)
    const per = (base: number) => Math.round(base * q * gp * (0.7 + r() * 0.6))
    const fga = per(17)
    const fta = per(6)
    return {
      player_name: name,
      pro_team: PRO[i % PRO.length],
      positions: ['PG', 'SG', 'SF', 'PF', 'C'].slice(i % 4, (i % 4) + 2),
      team_id: i < 156 ? (i % 12) + 1 : 0,
      status: i < 156 ? 'ONTEAM' : 'FREEAGENT',
      player_id: 4000 + i,
      stats: {
        pts: per(26), reb: per(10), ast: per(7), stl: per(1.6), blk: per(1.2), three_pm: per(2.8),
        fgm: Math.round(fga * (0.42 + r() * 0.12)), fga, ftm: Math.round(fta * (0.7 + r() * 0.2)), fta,
        fg_percentage: 0.47, ft_percentage: 0.8, minutes: gp * Math.round(20 + 16 * q), gp,
      },
    }
  })

  const picks = []
  for (let round = 1; round <= 13; round += 1) {
    for (let k = 0; k < 12; k += 1) {
      const pick = (round - 1) * 12 + k + 1
      const slot = round % 2 === 1 ? k : 11 - k
      // Shuffle a little inside each round so the board isn't perfectly ordered.
      const idx = Math.min(155, pick - 1 + (round > 1 && k % 3 === 0 ? 2 : 0) - (round > 1 && k % 3 === 2 ? 2 : 0))
      picks.push({ pick, round, team_id: slot + 1, team_name: TEAMS[slot], player_name: '' , _idx: idx })
    }
  }
  const used = new Set<number>()
  for (const p of picks) {
    let i = p._idx
    while (used.has(i)) i = (i + 1) % 156
    used.add(i)
    p.player_name = all[i]
  }

  const teams = TEAMS.map((name, i) => ({ team_id: i + 1, name, abbrev: name.replace(/[^A-Z]/g, '').slice(0, 3) || name.slice(0, 3).toUpperCase() }))
  const moves = all.slice(160, 230).filter((_, i) => i % 3 !== 2).map((name, i) => ({
    id: `fa${i}`,
    kind: i % 4 === 0 ? 'waiver' : 'add',
    at: new Date(Date.UTC(2026, 9, 20 + (i % 18), 14 + (i % 6))).toISOString(),
    team_id: (i % 12) + 1,
    other_team_id: null,
    trade_id: null,
    added: [{ player_id: 4160 + i, name }],
    dropped: [],
  }))

  return {
    '/league/draft-report': { picks: picks.map(({ _idx, ...p }) => (void _idx, p)) },
    '/players': { players, total_count: players.length, page: 1, limit: 1200, has_more: false },
    '/league/activity': {
      season_id: 2027, season_over: false, latest_date: '2026-11-06', categories: [], trades: [], released: [],
      pending_trades: [], last_updated: '2026-11-06T12:00:00Z', teams, moves,
    },
  }
}
