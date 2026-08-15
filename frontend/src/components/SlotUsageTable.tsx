import type { SlotUsage } from '../types/api'
import {
  SLOT_NAMES,
  SLOT_CAPS,
  formatCap,
  formatSlotNumber,
  projectSlot,
  slotStatus,
  type PaceContext,
  type SlotName,
} from '../utils/slotProjection'

interface SlotUsageTableProps {
  slotUsage: Record<string, SlotUsage>
  avgPace?: number | null
  gameDaysLeft?: number | null
}

type GapTone = 'neutral' | 'short' | 'lost'

const TRACK_TONE: Record<GapTone, string> = {
  neutral: 'bg-slate-100 dark:bg-slate-700',
  short: 'bg-orange-100 dark:bg-orange-950',
  lost: 'bg-rose-100 dark:bg-rose-950',
}

const NOTE_TONE: Record<GapTone, string> = {
  neutral: 'text-orange-700 dark:text-orange-300',
  short: 'text-orange-700 dark:text-orange-300',
  lost: 'text-rose-600 dark:text-rose-400',
}

const VALUE_TONE: Record<GapTone, string> = {
  neutral: 'text-gray-900 dark:text-gray-50',
  short: 'text-gray-900 dark:text-gray-50',
  lost: 'text-rose-600 dark:text-rose-400',
}

interface ValueCellProps {
  value: number | null
  cap: number
  tone: GapTone
  note: string | null
}

/**
 * The track is the cap and the fill is the value, so the empty part of the track is
 * the gap — tinted by what kind of gap it is. The number sits at the end of the track
 * rather than beside it, which is what keeps the two reading as one object.
 */
function ValueCell({ value, cap, tone, note }: ValueCellProps) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, (value / cap) * 100))
  return (
    <td className="relative px-1.5 py-1.5 text-right align-middle sm:px-2 sm:py-2">
      <span className={`absolute inset-y-1 left-1 right-1 overflow-hidden rounded ${TRACK_TONE[tone]}`}>
        <span className="absolute inset-y-0 left-0 rounded-l bg-blue-200 dark:bg-blue-800" style={{ width: `${width}%` }} />
      </span>
      <span className={`relative block text-[13px] font-extrabold tabular-nums sm:text-[14.5px] ${VALUE_TONE[tone]}`}>
        {formatSlotNumber(value)}
      </span>
      <span className={`relative block text-[9px] font-semibold leading-tight sm:text-[9.5px] ${note ? NOTE_TONE[tone] : 'text-transparent'}`}>
        {note ?? ' '}
      </span>
    </td>
  )
}

function HeadCell({ label, gloss }: { label: string; gloss: string }) {
  return (
    <th scope="col" className="px-1.5 pb-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
      {label}
      <span className="block text-[9px] font-semibold normal-case tracking-normal text-gray-400 dark:text-gray-500">
        {gloss}
      </span>
    </th>
  )
}

export default function SlotUsageTable({ slotUsage, avgPace, gameDaysLeft }: SlotUsageTableProps) {
  const pace: PaceContext = { avgPace, gameDaysLeft }
  const rows = SLOT_NAMES.map(slot => {
    const usage = slotUsage[slot]
    const projection = usage ? projectSlot(usage.games_used, slot, pace) : null
    return { slot, projection, status: projection ? slotStatus(projection, slot, pace) : null }
  })
  const numericPace = typeof avgPace === 'number' && avgPace > 0 ? avgPace : null

  return (
    <div className="rounded-lg bg-white p-4 shadow sm:p-6 dark:bg-gray-800">
      <div className="flex flex-col gap-1 pb-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h2 className="text-lg font-bold text-gray-900 sm:text-xl dark:text-gray-50">Slot usage</h2>
        <p className="text-[11.5px] tabular-nums text-gray-400 dark:text-gray-500">
          {typeof gameDaysLeft === 'number' && (
            <>
              <span className="font-bold text-gray-600 dark:text-gray-300">{gameDaysLeft}</span> game days left
            </>
          )}
          {typeof gameDaysLeft === 'number' && numericPace !== null && ' · '}
          {numericPace !== null && (
            <>
              NBA pace <span className="font-bold text-gray-600 dark:text-gray-300">{numericPace.toFixed(1)}</span>
            </>
          )}
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-600">
            <th scope="col" className="pb-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Slot
            </th>
            <HeadCell label="Used" gloss="games played" />
            <HeadCell label="Projected" gloss="season finish" />
            <HeadCell label="Max" gloss="most still possible" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ slot, projection, status }) => {
            const cap = SLOT_CAPS[slot as SlotName]
            const lost = status?.lost ?? null
            const short = status?.short ?? null
            const behind = status?.behindPace ?? null
            return (
              <tr key={slot} className="border-b border-gray-100 last:border-0 dark:border-gray-700/70">
                <th scope="row" className="py-1.5 pr-1 text-left align-middle sm:py-2">
                  <span className="block text-[12.5px] font-extrabold tracking-wide text-gray-600 dark:text-gray-300">{slot}</span>
                  <span className="block text-[9.5px] font-semibold tabular-nums text-gray-400 dark:text-gray-500">
                    /{formatCap(slot)}
                  </span>
                </th>
                <ValueCell
                  value={projection?.usedTotal ?? null}
                  cap={cap}
                  tone="neutral"
                  note={behind === null ? null : `${formatSlotNumber(behind)} behind pace`}
                />
                <ValueCell
                  value={projection?.estimatedRounded ?? null}
                  cap={cap}
                  tone={short === null ? 'neutral' : 'short'}
                  note={short === null ? null : `${formatSlotNumber(short)} short`}
                />
                <ValueCell
                  value={projection?.maxGamesTotal ?? null}
                  cap={cap}
                  tone={lost === null ? 'neutral' : 'lost'}
                  note={lost === null ? null : `${formatSlotNumber(lost)} lost`}
                />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
