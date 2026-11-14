import { useEffect, useMemo, type ReactNode } from 'react'
import { useGetTeamsListQuery } from '../store/api/fantasyApi'
import { usePersistedState } from '../hooks/usePersistedState'
import { MyTeamContext, type MyTeamContextValue } from './myTeamContextValue'

export function MyTeamProvider({ children }: { children: ReactNode }) {
  const { data: teams = [], isSuccess } = useGetTeamsListQuery()
  const [storedId, setStoredId] = usePersistedState<number | null>('myTeam.id', null)

  const myTeam = useMemo(
    () => teams.find(team => team.team_id === storedId) ?? null,
    [teams, storedId],
  )

  useEffect(() => {
    if (isSuccess && storedId != null && myTeam == null) setStoredId(null)
  }, [isSuccess, storedId, myTeam, setStoredId])

  const value = useMemo<MyTeamContextValue>(() => {
    const myTeamId = myTeam?.team_id ?? null
    return {
      teams,
      myTeam,
      myTeamId,
      isMyTeam: (teamId) => teamId != null && teamId === myTeamId,
      setMyTeamId: setStoredId,
    }
  }, [teams, myTeam, setStoredId])

  return <MyTeamContext.Provider value={value}>{children}</MyTeamContext.Provider>
}
