import { formatEspnUpdated } from '../utils/espnUpdated'

interface EspnUpdatedNoteProps {
  updatedAt?: string | null
  className?: string
}

/** When ESPN last updated the league's stats (its nightly run), not when we fetched them. */
const EspnUpdatedNote = ({ updatedAt, className = '' }: EspnUpdatedNoteProps) => {
  if (!updatedAt) return null
  const label = formatEspnUpdated(updatedAt)
  if (!label) return null
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] text-gray-400 sm:text-xs dark:text-gray-500 ${className}`}
      title={`ESPN last updated stats ${new Date(updatedAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`}
    >
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      ESPN updated {label}
    </span>
  )
}

export default EspnUpdatedNote
