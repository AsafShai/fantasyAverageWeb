import { useSectionOpen } from '../../hooks/useSectionOpen'
import { useGetNbaPlayerSeasonsQuery } from '../../store/api/fantasyApi'
import type { PlayerSeasonLine } from '../../types/api'
import { PAST_SEASON_COLS, shortSeasonLabel } from '../../utils/pastSeasons'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Card, DataTable, type Column } from '../ui'

/** Phone version of "Previous seasons": per-game averages, season column pinned. */
export default function PastSeasonsCard({ playerId }: { playerId: string }) {
  const [open, toggle] = useSectionOpen('past-seasons')
  const { data, isLoading, isError } = useGetNbaPlayerSeasonsQuery(playerId, { skip: !playerId })
  const seasons = data?.seasons ?? []

  const columns: Column<PlayerSeasonLine>[] = [
    { key: 'season', header: 'Season', pinned: true, cell: (s) => shortSeasonLabel(s) },
    { key: 'team', header: 'Team', cell: (s) => s.teams.join('/') || '—' },
    ...PAST_SEASON_COLS.map((c): Column<PlayerSeasonLine> => ({
      key: c.key,
      header: c.label,
      align: 'center',
      cell: c.value,
    })),
  ]

  return (
    <Card title="Previous seasons · per game" aria-label="Previous seasons" fold={{ open, onToggle: toggle }}>
      {isLoading ? (
        <div className="mr-pp-loading"><LoadingSpinner /></div>
      ) : isError ? (
        <p className="mr-meta mr-pp-empty">Couldn't load previous seasons from ESPN.</p>
      ) : seasons.length === 0 ? (
        <p className="mr-meta mr-pp-empty">No previous NBA seasons.</p>
      ) : (
        <DataTable caption="Previous seasons, per game" columns={columns} rows={seasons} rowKey={(s) => String(s.season)} />
      )}
    </Card>
  )
}
