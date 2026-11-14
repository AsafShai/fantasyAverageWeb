import { createContext } from 'react'
import type { Team } from '../types/api'

export interface MyTeamContextValue {
  teams: Team[]
  myTeam: Team | null
  myTeamId: number | null
  isMyTeam: (teamId: number | null | undefined) => boolean
  setMyTeamId: (teamId: number | null) => void
}

export const EMPTY_MY_TEAM: MyTeamContextValue = {
  teams: [],
  myTeam: null,
  myTeamId: null,
  isMyTeam: () => false,
  setMyTeamId: () => {},
}

export const MyTeamContext = createContext<MyTeamContextValue | null>(null)
