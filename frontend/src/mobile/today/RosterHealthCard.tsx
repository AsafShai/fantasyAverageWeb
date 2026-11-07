import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { TeamRosterHealth } from '../../types/api'
import { useMyTeam } from '../../context/MyTeamContext'
import { MyTeamMark } from '../../components/MyTeamMark'
import { leadWithMyTeam } from '../../myTeam/display'
import { Card } from '../ui/Card'
import { DataTable, type Column, type SortState } from '../ui/DataTable'

type CountKey = 'available_tonight' | 'probable' | 'questionable' | 'doubtful' | 'out'

const COUNTS: { key: CountKey; short: string; full: string; tone: string }[] = [
  { key: 'available_tonight', short: 'AVAILABLE', full: 'Available', tone: 'mr-today-av' },
  { key: 'probable', short: 'P', full: 'Probable', tone: 'mr-today-pp' },
  { key: 'questionable', short: 'Q', full: 'Questionable', tone: 'mr-today-pq' },
  { key: 'doubtful', short: 'D', full: 'Doubtful', tone: 'mr-today-pd' },
  { key: 'out', short: 'OUT', full: 'Out', tone: 'mr-today-po' },
]

function CountPill({ value, tone }: { value: number; tone: string }) {
  return <span className={`mr-today-cnt ${value === 0 ? 'mr-today-zero' : tone}`}>{value}</span>
}

function Tile({ value, label, warn = false }: { value: number; label: string; warn?: boolean }) {
  return (
    <div className={`mr-today-tile mr-today-edge ${warn ? 'mr-today-warn' : ''}`.trim()}>
      <span className="mr-today-tv mr-num">{value}</span>
      <span className="mr-meta">{label}</span>
    </div>
  )
}

interface RosterHealthCardProps {
  slateDate: string | null
  gamesCount: number
  teams: TeamRosterHealth[]
}

/** Roster health today: tiles + one row per team with colored P/Q/D/OUT counts. */
export function RosterHealthCard({ slateDate, gamesCount, teams }: RosterHealthCardProps) {
  const navigate = useNavigate()
  const { myTeamId, isMyTeam } = useMyTeam()
  const [sort, setSort] = useState<SortState | null>(null)

  const rows = useMemo(() => {
    const ordered = leadWithMyTeam(teams, myTeamId)
    if (!sort) return ordered
    const key = sort.key as 'team' | 'games_tonight' | CountKey
    const cmp = (a: TeamRosterHealth, b: TeamRosterHealth) =>
      key === 'team' ? a.team_name.localeCompare(b.team_name) : a[key] - b[key]
    const copy = [...ordered].sort(cmp)
    return sort.dir === 'asc' ? copy : copy.reverse()
  }, [teams, myTeamId, sort])

  const availableTotal = teams.reduce((s, t) => s + t.available_tonight, 0)
  const outTotal = teams.reduce((s, t) => s + t.out, 0)

  const columns: Column<TeamRosterHealth>[] = [
    {
      key: 'team',
      header: 'TEAM',
      pinned: true,
      align: 'left',
      sortable: true,
      firstDir: 'asc',
      className: 'mr-today-teamcol',
      cell: (t) => (
        <span className="mr-today-name">
          <span className="mr-today-trunc">{t.team_name}</span>
          <MyTeamMark teamId={t.team_id} />
        </span>
      ),
    },
    { key: 'games_tonight', header: 'GAMES', sortable: true, cell: (t) => <b>{t.games_tonight}</b> },
    ...COUNTS.map<Column<TeamRosterHealth>>((c) => ({
      key: c.key,
      header: c.short,
      headerLabel: c.full,
      align: 'center',
      sortable: true,
      cell: (t) => <CountPill value={t[c.key]} tone={c.tone} />,
    })),
  ]

  return (
    <Card
      title="Roster health today"
      action={
        <Link to="/injuries" className="mr-link">
          Injuries ›
        </Link>
      }
    >
      {gamesCount === 0 ? (
        <p className="mr-meta">No NBA games scheduled.</p>
      ) : (
        <div className="mr-today-tiles mr-today-c2">
          <Tile value={gamesCount} label="NBA games" />
          <Tile value={gamesCount * 2} label="teams playing" />
          <Tile value={availableTotal} label="available" />
          <Tile value={outTotal} label="Out tonight" warn />
        </div>
      )}

      {teams.length === 0 ? (
        <p className="mr-meta">Injury report unavailable — rosters will show once the league is set.</p>
      ) : (
        <DataTable
          caption="Roster health today"
          columns={columns}
          rows={rows}
          rowKey={(t) => String(t.team_id)}
          sort={sort}
          onSortChange={setSort}
          isHighlighted={(t) => isMyTeam(t.team_id)}
          onRowClick={(t) => navigate(`/team/${t.team_id}`)}
        />
      )}

      {slateDate && <span className="mr-meta">Slate {slateDate}</span>}
      <Link to="/injuries" className="mr-btn">
        Injury report
      </Link>
    </Card>
  )
}
