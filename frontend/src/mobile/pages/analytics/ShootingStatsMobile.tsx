import { Link } from 'react-router'
import DataDateBadge from '../../../components/DataDateBadge'
import { MyTeamMark } from '../../../components/MyTeamMark'
import type { TeamShotStats } from '../../../types/api'
import { Card, DataTable, type Column, type SortState } from '../../ui'
import './analytics.css'

type Tone = 'good' | 'mid' | 'bad'

interface ShootingStatsMobileProps {
  /** Already sorted by the page. */
  shots: TeamShotStats[]
  dataDate?: string
  sort: SortState
  onSort: (sort: SortState) => void
  isMyTeam: (teamId: number) => boolean
  /** Same green / yellow / red vs league average as desktop. */
  pctTone: (pct: number, type: 'fg' | 'ft') => Tone
}

const pct = (v: number) => (v * 100).toFixed(2) + '%'

/** League Analytics → Shooting Stats on a phone: one pinned-team table, same columns and colors. */
export function ShootingStatsMobile({ shots, dataDate, sort, onSort, isMyTeam, pctTone }: ShootingStatsMobileProps) {
  const num = (key: 'fgm' | 'fga' | 'ftm' | 'fta' | 'gp', header: string): Column<TeamShotStats> => ({
    key,
    header,
    sortable: true,
    cell: (t) => t[key],
  })
  const columns: Column<TeamShotStats>[] = [
    {
      key: 'team',
      header: 'Team',
      pinned: true,
      sortable: true,
      cell: (t) => (
        <>
          <Link to={`/team/${t.team.team_id}`}>{t.team.team_name}</Link>
          <MyTeamMark teamId={t.team.team_id} />
        </>
      ),
    },
    num('fgm', 'FGM'),
    num('fga', 'FGA'),
    {
      key: 'fg_percentage',
      header: 'FG%',
      sortable: true,
      cell: (t) => <span className={`mr-pct mr-pct-${pctTone(t.fg_percentage, 'fg')}`}>{pct(t.fg_percentage)}</span>,
    },
    num('ftm', 'FTM'),
    num('fta', 'FTA'),
    {
      key: 'ft_percentage',
      header: 'FT%',
      sortable: true,
      cell: (t) => <span className={`mr-pct mr-pct-${pctTone(t.ft_percentage, 'ft')}`}>{pct(t.ft_percentage)}</span>,
    },
    num('gp', 'GP'),
  ]

  return (
    <Card className="mr-shots">
      <div className="mr-shots-head">
        <h2 className="mr-h2">League Shooting Statistics</h2>
        {dataDate && <DataDateBadge dataDate={dataDate} />}
      </div>
      <p className="mr-meta" style={{ margin: 0 }}>
        Field goal and free throw shooting stats for all teams. Tap a column header to sort.
      </p>
      <DataTable
        caption="League Shooting Statistics"
        columns={columns}
        rows={shots}
        rowKey={(t) => String(t.team.team_id)}
        sort={sort}
        onSortChange={onSort}
        isHighlighted={(t) => isMyTeam(t.team.team_id)}
        empty="No shooting data"
      />
    </Card>
  )
}
