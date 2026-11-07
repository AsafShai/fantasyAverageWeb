import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { RankMover } from '../../types/api'
import { useMyTeam } from '../../context/MyTeamContext'
import { MyTeamMark } from '../../components/MyTeamMark'
import { Card } from '../ui/Card'
import { MultiSelectSheet } from './MultiSelectSheet'
import { arrowDelta, groupMovers, partLabel } from './groupMovers'

/** Rank movers vs yesterday, one line per team ("▼6 Khachapuri's · STL −3 · 3PM −2"). */
export function RankMoversCard({ movers }: { movers: RankMover[] }) {
  const navigate = useNavigate()
  const { myTeamId, isMyTeam } = useMyTeam()
  const [teams, setTeams] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])

  const teamOptions = useMemo(
    () => Array.from(new Set(movers.map((m) => m.team_name))).sort((a, b) => a.localeCompare(b)),
    [movers],
  )
  const categoryOptions = useMemo(
    () => Array.from(new Set(movers.map((m) => m.category))).sort((a, b) => a.localeCompare(b)),
    [movers],
  )
  const groups = useMemo(
    () =>
      groupMovers(
        movers.filter(
          (m) =>
            (teams.length === 0 || teams.includes(m.team_name)) &&
            (categories.length === 0 || categories.includes(m.category)),
        ),
        myTeamId,
      ),
    [movers, teams, categories, myTeamId],
  )

  return (
    <Card
      title="Rank movers"
      action={
        <Link to="/rankings?view=rankings" className="mr-link">
          Rankings ›
        </Link>
      }
    >
      <div className="mr-today-frow">
        <span className="mr-meta">vs yesterday</span>
        {movers.length > 0 && (
          <>
            <MultiSelectSheet id="today-mover-teams" label="teams" title="Teams" options={teamOptions} selected={teams} onChange={setTeams} />
            <MultiSelectSheet
              id="today-mover-cats"
              label="categories"
              title="Categories"
              options={categoryOptions}
              selected={categories}
              onChange={setCategories}
            />
          </>
        )}
      </div>

      {movers.length === 0 ? (
        <p className="mr-meta">Movers appear after the second scoring period.</p>
      ) : groups.length === 0 ? (
        <p className="mr-meta">No movers match the selected filters.</p>
      ) : (
        <ul className="mr-today-movers mr-noscroll" aria-label="Rank movers by team">
          {groups.map((g) => {
            const dir = g.total == null || g.total === 0 ? 'same' : g.total > 0 ? 'up' : 'down'
            return (
              <li key={g.team_id}>
                <button
                  type="button"
                  className={`mr-today-mvr ${isMyTeam(g.team_id) ? 'mr-me' : ''}`.trim()}
                  onClick={() => navigate(`/team/${g.team_id}`)}
                >
                  <span className={`mr-today-md mr-num mr-today-${dir}`} aria-label={g.total ? `Total ${g.total > 0 ? 'up' : 'down'} ${Math.abs(g.total)}` : 'Total unchanged'}>
                    {arrowDelta(g.total)}
                  </span>
                  <span className="mr-today-mt">
                    <b className="mr-today-name">
                      <span className="mr-today-trunc">{g.team_name}</span>
                      <MyTeamMark teamId={g.team_id} />
                    </b>
                    <span className="mr-meta">{g.parts.map(partLabel).join(' · ') || 'categories unchanged'}</span>
                  </span>
                  <span className="mr-today-chev" aria-hidden="true">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {movers.length > 0 && (
        <Link to="/rankings?view=rankings" className="mr-btn">
          All changes in Rankings
        </Link>
      )}
    </Card>
  )
}
