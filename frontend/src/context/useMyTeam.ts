import { useContext } from 'react'
import { EMPTY_MY_TEAM, MyTeamContext, type MyTeamContextValue } from './myTeamContextValue'

export function useMyTeam(): MyTeamContextValue {
  return useContext(MyTeamContext) ?? EMPTY_MY_TEAM
}
