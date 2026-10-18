import { Link } from 'react-router'
import { useMyTeam } from '../context/MyTeamContext'

export function MyTeamSelect({
  fullWidth = false,
  onNavigate,
}: {
  fullWidth?: boolean
  onNavigate?: () => void
}) {
  const { teams, myTeam, myTeamId, setMyTeamId } = useMyTeam()

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${fullWidth ? 'w-full px-2 py-2' : 'shrink-0'}`}>
      {myTeam && (
        <Link
          to={`/team/${myTeam.team_id}`}
          onClick={onNavigate}
          title={myTeam.team_name}
          className={`truncate text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300 ${
            fullWidth ? 'min-w-0 flex-1' : 'max-w-[7rem]'
          }`}
        >
          {myTeam.team_name}
        </Link>
      )}
      <select
        aria-label="My team"
        value={myTeamId ?? ''}
        onChange={(event) => {
          const value = event.target.value
          setMyTeamId(value === '' ? null : Number(value))
        }}
        className={`truncate rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 ${
          fullWidth ? 'min-w-0 flex-1' : 'max-w-[9rem]'
        }`}
      >
        <option value="">{myTeam ? 'Clear' : 'Select my team'}</option>
        {teams.map(team => (
          <option key={team.team_id} value={team.team_id}>
            {team.team_name}
          </option>
        ))}
      </select>
    </div>
  )
}
