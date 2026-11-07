import { Link, useLocation } from 'react-router'
import { useMobileRedesign } from '../mobile/flag'
import { openSheetState, searchWithPlayer } from '../mobile/player/playerParam'

interface PlayerNameLinkProps {
  name: string
  playerId?: number | string | null
  className?: string
}

/**
 * Links to /player/:id when an ESPN athlete id is available; plain text otherwise.
 * On a phone with the mobile redesign on, the name opens the player sheet over
 * the current page instead (`?player=:id`, closed by browser back).
 */
const PlayerNameLink = ({ name, playerId, className }: PlayerNameLinkProps) => {
  const location = useLocation()
  const mobile = useMobileRedesign()
  const id = playerId != null && String(playerId).trim() !== '' ? String(playerId) : null
  if (!id) {
    return <span className={className}>{name}</span>
  }
  const cls = className ?? 'text-blue-700 dark:text-blue-300 hover:underline font-medium'
  if (mobile) {
    return (
      <Link
        to={{ pathname: location.pathname, search: searchWithPlayer(location.search, id), hash: location.hash }}
        state={openSheetState(location.state)}
        className={cls}
      >
        {name}
      </Link>
    )
  }
  return (
    <Link
      to={`/player/${id}`}
      state={{ from: `${location.pathname}${location.search}` }}
      className={cls}
    >
      {name}
    </Link>
  )
}

export default PlayerNameLink
