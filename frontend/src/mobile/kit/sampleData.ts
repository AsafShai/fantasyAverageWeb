// Real league data from Nov 6 (same snapshot the approved design uses).
export const CATS = ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS'] as const

export interface TeamRow {
  id: number
  name: string
  rank: number
  points: number
  gp: number
  avg: number[]
  /** Rank change since yesterday (positive = moved up). */
  rankDelta: number
  /** Total points change since yesterday. */
  pointsDelta: number
  gpDelta: number
}

const raw: [number, string, number, number, number, number[]][] = [
  [9, 'Khachapuri’s Team', 1, 65, 83, [0.4833, 0.8208, 1.70, 6.11, 3.33, 1.16, 0.89, 17.70]],
  [4, 'DORELIT', 2, 63, 83, [0.4874, 0.7833, 1.92, 5.86, 3.92, 1.05, 0.81, 17.08]],
  [12, 'Hapoel Yifat🏀', 3, 60, 86, [0.4684, 0.8338, 1.59, 6.64, 3.84, 0.99, 0.66, 17.62]],
  [8, "Dor's Injured Team", 4, 59, 83, [0.4413, 0.7886, 1.89, 6.20, 4.77, 1.17, 0.45, 18.18]],
  [13, 'Maccabi Haifa NBA 777', 5, 57, 81, [0.4524, 0.7614, 1.84, 6.47, 5.15, 1.05, 0.52, 18.74]],
  [6, "Roy's Rowdy Team", 6, 56, 93, [0.4692, 0.7840, 1.70, 5.28, 3.31, 1.24, 0.83, 18.42]],
  [11, 'Trust the process', 7, 51, 81, [0.4666, 0.7660, 1.99, 6.14, 4.10, 0.94, 0.54, 17.36]],
  [15, 'Machlins team', 8, 50, 77, [0.4834, 0.8188, 1.73, 5.22, 4.18, 0.96, 0.45, 16.87]],
  [1, "Asaf's Astounding Team", 9, 43, 76, [0.4701, 0.7718, 1.45, 5.59, 3.34, 1.24, 0.61, 15.26]],
  [3, "Oriel's Otherworldly Team", 10, 42, 86, [0.4709, 0.7909, 1.24, 5.63, 3.77, 1.16, 0.47, 15.15]],
  [10, "Amihai's Awesome Team 🏆", 10, 42, 93, [0.4366, 0.7861, 1.90, 5.72, 3.49, 0.92, 0.70, 16.28]],
  [5, 'Chat GPT', 12, 36, 77, [0.4534, 0.7992, 1.62, 4.78, 3.30, 1.17, 0.60, 13.69]],
]
// [rank change, points change, games played since yesterday]
const moves: Record<number, [number, number, number]> = {
  1: [0, 0, 0], 3: [1, 5, 1], 4: [0, -3, 3], 5: [0, 1, 2], 6: [0, 2, 1], 8: [0, 1, 0],
  9: [0, -6, 2], 10: [0, 1, 1], 11: [0, -2, 2], 12: [0, 0, 1], 13: [0, 0, 1], 15: [0, 1, 4],
}

export const TEAMS: TeamRow[] = raw.map(([id, name, rank, points, gp, avg]) => ({
  id, name, rank, points, gp, avg,
  rankDelta: moves[id][0], pointsDelta: moves[id][1], gpDelta: moves[id][2],
}))

export const MY_TEAM_ID = 11
