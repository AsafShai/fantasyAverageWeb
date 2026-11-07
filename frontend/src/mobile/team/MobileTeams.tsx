import { Link } from 'react-router'
import type { Team } from '../../types/api'
import { MyTeamMark } from '../../components/MyTeamMark'
import { leadWithMyTeam } from '../../myTeam/display'
import { useMyTeam } from '../../context/MyTeamContext'
import './team.css'

/** Phone Teams list (step 4): same list as today, my team first. */
export default function MobileTeams({ teams }: { teams: Team[] }) {
  const { myTeamId, isMyTeam } = useMyTeam()
  return (
    <div className="mr-root mr-page">
      <div className="mr-page-head">
        <h1 className="mr-h1">Teams</h1>
        <span className="mr-meta">Browse all teams in your fantasy league</span>
      </div>
      <ul className="mr-tm-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {leadWithMyTeam(teams, myTeamId).map((team) => {
          const mine = isMyTeam(team.team_id)
          return (
            <li key={team.team_id}>
              <Link to={`/team/${team.team_id}`} className={`mr-tm-row ${mine ? 'mr-me' : ''}`.trim()}>
                <span className="mr-tm-name">
                  <b>
                    {team.team_name}
                    <MyTeamMark teamId={team.team_id} />
                  </b>
                  <span className="mr-meta">Team #{team.team_id}</span>
                </span>
                <span className="mr-tm-chev" aria-hidden="true">›</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
