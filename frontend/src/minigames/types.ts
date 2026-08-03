export type MinigamePlayer = {
  id: string
  displayName: string
  team: string
  teamAbbr: string
  conference: string
  division: string
  position: string
  photoUrl: string | null
  height: string | null
  nationality: string | null
  age: number | null
  jerseyNumber: string | null
}

export type MinigamePlayerBundle = {
  seasonLabel: string
  source: string
  updatedAt: string
  players: MinigamePlayer[]
}

export type NbaTeamOption = {
  abbr: string
  label: string
}

export type GameSlug = 'hangman' | 'who-he-play-for' | 'who-am-i' | 'now-you-see-me'

export type LeaderboardRow = {
  rank: number
  displayName: string
  bestStreak: number
  hintsUsed?: number | null
}

export type WhoAmIColumnKey =
  | 'team'
  | 'conference'
  | 'division'
  | 'position'
  | 'height'
  | 'age'
  | 'jerseyNumber'
  | 'nationality'

export type WhoAmICellState = 'correct' | 'close' | 'wrong'

export type WhoAmICellFeedback = {
  state: WhoAmICellState
  dir?: 'higher' | 'lower'
}

export type WhoAmIGuessRow = {
  guessedPlayerId: string
  guessedName: string
  display: Record<WhoAmIColumnKey, string>
  feedback: Record<WhoAmIColumnKey, WhoAmICellFeedback>
}

export const WHO_HE_ROUND_SECONDS = 30
export const NOW_YOU_SEE_ME_ROUND_SECONDS = 60
export const WHO_AM_I_MAX_GUESSES = 8
export const HANGMAN_MAX_WRONG = 7

export const HINTS_GAMES: GameSlug[] = ['hangman', 'who-am-i']
