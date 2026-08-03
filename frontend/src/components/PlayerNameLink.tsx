import { Link, useLocation } from 'react-router'

interface PlayerNameLinkProps {
  name: string
  playerId?: number | string | null
  className?: string
}

/** Links to /player/:id when an ESPN athlete id is available; plain text otherwise. */
const PlayerNameLink = ({ name, playerId, className }: PlayerNameLinkProps) => {
  const location = useLocation()
  const id = playerId != null && String(playerId).trim() !== '' ? String(playerId) : null
  if (!id) {
    return <span className={className}>{name}</span>
  }
  return (
    <Link
      to={`/player/${id}`}
      state={{ from: `${location.pathname}${location.search}` }}
      className={
        className ??
        'text-blue-700 dark:text-blue-300 hover:underline font-medium'
      }
    >
      {name}
    </Link>
  )
}

export default PlayerNameLink
