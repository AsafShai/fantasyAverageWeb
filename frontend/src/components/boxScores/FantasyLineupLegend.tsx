import { FANTASY_LINEUP_DOT_CLASS, FANTASY_LINEUP_LABEL, type FantasyLineupState } from './fantasyLineup'

const ITEMS: FantasyLineupState[] = ['started', 'bench', 'ir']

/**
 * One-line key for fantasy dots on box scores, Lines of the night, and My players.
 */
export default function FantasyLineupLegend({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-gray-500 dark:text-gray-400 ${className}`}>
      <span className="font-medium text-gray-600 dark:text-gray-300">Fantasy lineup</span>
      {' '}
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 align-middle">
        {ITEMS.map(state => (
          <span key={state} className="inline-flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${FANTASY_LINEUP_DOT_CLASS[state]}`}
              aria-hidden
            />
            {FANTASY_LINEUP_LABEL[state]}
          </span>
        ))}
      </span>
      <span className="max-sm:block sm:before:content-['·'] sm:before:mx-2">
        During live games, the <span className="whitespace-nowrap">sky-blue dot in the box</span> means on the court; the green dot by a fantasy team means active lineup.
      </span>
    </p>
  )
}
