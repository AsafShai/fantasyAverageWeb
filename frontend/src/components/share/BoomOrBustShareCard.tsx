import type { SurpriseRow } from '../../types/api'
import { SurpriseTable } from '../boomOrBust/SurpriseTable'
import type { ShareCardTheme } from './ShareCard'

interface BoomOrBustShareCardProps extends ShareCardTheme {
  /** "Tuesday, Oct 20, 2026" */
  dateLabel: string
  games: number
  /** The rows the page shows, already filtered by the viewer's sliders; the
   * image takes the first SHARE_ROWS of each. */
  booms: SurpriseRow[]
  busts: SurpriseRow[]
  thresholds: { good: number; bad: number }
}

/** Wide enough for the page's own table at its real size: 13 columns with
 * headshots and the score bar measure ~925 px with the longest names, and
 * the card pads 17 px a side. */
export const CARD_WIDTH = 980
/** The image shows the top of each table only: five rows read well on a phone. */
export const SHARE_ROWS = 5

const Section = ({ title, rows, kind, rule }: { title: string; rows: SurpriseRow[]; kind: 'good' | 'bad'; rule: string }) => {
  const shown = rows.slice(0, SHARE_ROWS)
  const count = rows.length > SHARE_ROWS ? `top ${SHARE_ROWS} of ${rows.length}` : `${rows.length}`
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white whitespace-nowrap">
          {title} <span className="text-sm font-normal text-gray-500 dark:text-gray-400 whitespace-nowrap">({count})</span>
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{rule}</span>
      </div>
      <SurpriseTable rows={shown} kind={kind} share />
    </div>
  )
}

/**
 * The page's own two cards, as they look on the site, in one image: the same
 * table component the page renders (headshots, graded green/red marks, score
 * bars), under a small title bar, the top SHARE_ROWS of each. Tailwind styles
 * apply because the card is rendered in the page's document; `dark` follows
 * the site theme through the html element's class. The card is at least
 * CARD_WIDTH wide and grows with the table (wider system fonts), never
 * scrolls: the PNG is taken at the card's full size.
 */
export const BoomOrBustShareCard = ({ dateLabel, games, booms, busts, thresholds }: BoomOrBustShareCardProps) => (
  <div
    className="overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans"
    style={{ minWidth: CARD_WIDTH, width: 'max-content' }}
  >
    <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-violet-700 px-5 py-4 text-white">
      <div className="flex items-center justify-between text-xs font-semibold opacity-90 whitespace-nowrap">
        <span className="whitespace-nowrap">🏀 Fantasy League</span>
        <span className="whitespace-nowrap">last night</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight whitespace-nowrap">💥 Boom or Bust</div>
      <div className="mt-0.5 text-sm text-blue-100 whitespace-nowrap">{dateLabel} · {games} game{games === 1 ? '' : 's'}</div>
    </div>
    <div className="space-y-4 p-4">
      <Section title="💥 Booms" rows={booms} kind="good" rule={`score ≥ ${thresholds.good.toFixed(1)}`} />
      <Section title="💩 Busts" rows={busts} kind="bad" rule={`score ≤ −${thresholds.bad.toFixed(1)}`} />
      <p className="px-1 text-xs text-gray-500 dark:text-gray-400">
        Score = how unexpected the night was against the player's own history and what the model expected for his minutes.
        Green = above his norm, red = below; deeper colour, bigger gap.
      </p>
    </div>
  </div>
)
