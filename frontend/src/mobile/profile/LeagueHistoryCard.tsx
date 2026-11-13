import { useGetPlayerLeagueHistoryQuery } from '../../store/api/fantasyApi'
import LoadingSpinner from '../../components/LoadingSpinner'
import LeagueHistoryView from '../../components/leagueHistory/LeagueHistoryView'
import { Card } from '../ui'

/** Phone version of "League history": the same timeline and list of moves. */
export default function LeagueHistoryCard({ playerId }: { playerId: string }) {
  const { data, isLoading, isError } = useGetPlayerLeagueHistoryQuery(playerId, { skip: !playerId })
  return (
    <Card title="League history · this season" aria-label="League history">
      {isLoading ? (
        <div className="mr-pp-loading"><LoadingSpinner /></div>
      ) : isError || !data ? (
        <p className="mr-meta mr-pp-empty">Couldn't load this player's moves from ESPN.</p>
      ) : (
        <LeagueHistoryView history={data} />
      )}
    </Card>
  )
}
