import type { SlotUsage } from '../types/api'
import {
  SLOT_NAMES,
  SLOT_MULTIPLICITY,
  SLOT_CAPS,
  formatCap,
  formatRateDelta,
  formatSlotNumber,
  projectSlot,
  type PaceContext,
} from '../utils/slotProjection'

interface SlotUsageTableProps {
  slotUsage: Record<string, SlotUsage>
  avgPace?: number | null
  gameDaysLeft?: number | null
}

interface Segment {
  key: 'played' | 'onTrack' | 'possible' | 'gone'
  value: number
  className: string
}

const SEGMENT_STYLES = {
  played: 'bg-blue-700',
  onTrack: 'bg-blue-300',
  possible: 'bg-slate-200',
  gone: 'bg-red-500',
} as const

function segmentTooltip(segment: Segment, values: { played: number; estimated: number; max: number; cap: number; gameDaysLeft: number | null }) {
  if (segment.key === 'played') return `Played ${formatSlotNumber(values.played)} of ${formatSlotNumber(values.cap)}`
  if (segment.key === 'onTrack') return `On track to add ${formatSlotNumber(segment.value)} → est ${formatSlotNumber(values.estimated)}`
  if (segment.key === 'possible') return `Still possible +${formatSlotNumber(segment.value)} → max reachable ${formatSlotNumber(values.max)}`
  const days = values.gameDaysLeft === null ? 'the remaining game days' : `${values.gameDaysLeft} game days remain`
  return `Gone — ${formatSlotNumber(segment.value)}. Only ${days}, so the cap can no longer be reached.`
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  )
}

function ValueChip({ label, value, dotClass, className = 'bg-gray-100 text-gray-600' }: {
  label: string
  value: string | number
  dotClass?: string
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${className}`}>
      {dotClass && <span className={`h-2 w-2 rounded-sm ${dotClass}`} />}
      <span>{label}</span>
      <b className="tabular-nums">{value}</b>
    </span>
  )
}

function formatVsPace(used: number, avgPace: number | null | undefined): string {
  if (typeof avgPace !== 'number' || !Number.isFinite(avgPace) || avgPace <= 0) {
    return used === 0 ? '— 0' : '—'
  }
  const delta = formatRateDelta(used, avgPace)
  return delta === 'on pace' ? '0.0' : delta
}

export default function SlotUsageTable({ slotUsage, avgPace, gameDaysLeft }: SlotUsageTableProps) {
  const pace: PaceContext = { avgPace, gameDaysLeft }
  const columns = SLOT_NAMES.map(slot => {
    const usage = slotUsage[slot]
    return { slot, projection: usage ? projectSlot(usage.games_used, slot, pace) : null }
  })
  const numericPace = typeof avgPace === 'number' && avgPace > 0 ? avgPace : null
  const pacePercent = numericPace === null ? null : Math.min(100, (numericPace / 82) * 100)

  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Slot pace</h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            A report of games already used, the NBA-pace projection, and the remaining ceiling. The cap is a limit, not a target.
          </p>
        </div>
        <div className="text-xs text-gray-500 sm:text-right">
          NBA pace{' '}
          {numericPace === null ? (
            <span className="font-semibold text-gray-600">not available yet</span>
          ) : (
            <>
              <span className="font-semibold text-gray-700">{numericPace.toFixed(1)}</span> GP/team
            </>
          )}
          {typeof gameDaysLeft === 'number' && <span> · {gameDaysLeft} days left</span>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Legend className="bg-blue-700" label="Played" />
        <Legend className="bg-blue-300" label="On track to add" />
        <Legend className="bg-gray-200" label="Still possible" />
        <Legend className="bg-red-500" label="Gone" />
        {pacePercent !== null && (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
            <span className="h-3 w-0.5 bg-blue-900" /> NBA pace marker
          </span>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <div className="hidden items-center gap-3 sm:flex">
          <div className="w-16 shrink-0" />
          <div className="relative h-4 flex-1">
            {pacePercent !== null && (
              <span
                className="absolute -top-2 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white shadow-sm"
                style={{ left: `${pacePercent}%`, transform: pacePercent > 88 ? 'translateX(-100%)' : 'translateX(-50%)' }}
              >
                NBA pace {numericPace?.toFixed(1)}
              </span>
            )}
          </div>
          <div className="w-16 shrink-0" />
        </div>

        {columns.map(({ slot, projection }) => {
          if (!projection) return null
          const cap = SLOT_CAPS[slot]
          const played = Math.min(projection.usedTotal, cap)
          const estimated = projection.estimatedRounded ?? played
          const max = projection.maxGamesTotal ?? (typeof gameDaysLeft === 'number'
            ? Math.min(played + gameDaysLeft * SLOT_MULTIPLICITY[slot], cap)
            : cap)
          const onTrack = Math.max(0, estimated - played)
          const possible = Math.max(0, max - Math.max(played, estimated))
          const gone = Math.max(0, cap - max)
          const segments: Segment[] = [
            { key: 'played', value: played, className: SEGMENT_STYLES.played },
            { key: 'onTrack', value: onTrack, className: SEGMENT_STYLES.onTrack },
            { key: 'possible', value: possible, className: SEGMENT_STYLES.possible },
            { key: 'gone', value: gone, className: SEGMENT_STYLES.gone },
          ]
          const visibleSegments = segments.filter(segment => segment.value > 0)
          const values = { played, estimated, max, cap, gameDaysLeft: typeof gameDaysLeft === 'number' ? gameDaysLeft : null }
          const paceMarkerPercent = pacePercent === null
            ? null
            : Math.min(100, (numericPace! * SLOT_MULTIPLICITY[slot] / cap) * 100)
          const paceTooltip = numericPace === null
            ? `NBA pace is not available yet${projection.used === 0 ? ' · 0 games used.' : '.'}`
            : slot === 'UTIL'
              ? `${numericPace.toFixed(1)} × 3 = ${(numericPace * SLOT_MULTIPLICITY[slot]).toFixed(1)} · ${projection.usedTotal >= numericPace * 3 ? 'ahead' : 'behind'} by ${Math.abs(projection.usedTotal - numericPace * 3).toFixed(1)}.`
              : `NBA pace ${numericPace.toFixed(1)} · ${projection.used >= numericPace ? 'ahead' : 'behind'} by ${Math.abs(projection.used - numericPace).toFixed(1)}.`
          const paceChip = formatVsPace(projection.used, avgPace)
          return (
            <div key={slot} className="grid grid-cols-1 gap-1 sm:grid-cols-[4rem_minmax(0,1fr)_4rem] sm:items-center sm:gap-3">
              <div className="flex items-center justify-between sm:block">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-700">{slot}</div>
                {slot === 'UTIL' && <div className="text-[10px] text-gray-400">× 3 slots</div>}
              </div>
              <div className="relative">
                <div className="relative flex h-[18px] overflow-visible rounded-full border border-slate-600 bg-gray-50">
                  {visibleSegments.map((segment, index) => (
                    <span
                      key={segment.key}
                      title={segmentTooltip(segment, values)}
                      className={`group relative h-full min-w-[2px] ${segment.className} ${index === 0 ? 'rounded-l-full' : ''} ${index === visibleSegments.length - 1 ? 'rounded-r-full' : ''}`}
                      style={{ width: `${(segment.value / cap) * 100}%` }}
                    >
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-max max-w-[16rem] -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-[10px] font-normal text-white shadow-lg group-hover:block group-focus:block">
                        {segmentTooltip(segment, values)}
                      </span>
                    </span>
                  ))}
                  {paceMarkerPercent !== null && (
                    <span
                      aria-label={`NBA pace ${numericPace?.toFixed(1)}`}
                      title={paceTooltip}
                      className="pointer-events-auto absolute bottom-[-6px] top-[-6px] z-20 w-0.5 -translate-x-px rounded-sm bg-slate-900 shadow-[0_0_0_1.5px_white] after:absolute after:-left-[3px] after:-top-1 after:h-[7px] after:w-[7px] after:rounded-full after:bg-slate-900 after:shadow-[0_0_0_1.5px_white]"
                      style={{ left: `${paceMarkerPercent}%` }}
                    />
                  )}
                </div>
              </div>
              <div className="hidden text-right text-xs text-gray-500 sm:block">cap {formatCap(slot)}</div>
              <div className="flex flex-wrap gap-1.5 py-0.5 sm:col-start-2">
                <ValueChip label="played" value={formatSlotNumber(played)} dotClass="bg-blue-700" className="bg-blue-50 text-blue-800" />
                <ValueChip label="est" value={formatSlotNumber(estimated)} dotClass="bg-blue-300" className="bg-blue-100 text-blue-800" />
                <ValueChip label="max reachable" value={formatSlotNumber(max)} dotClass="bg-slate-300" className="bg-slate-100 text-slate-700" />
                {gone > 0 && <ValueChip label="gone" value={formatSlotNumber(gone)} dotClass="bg-red-700" className="bg-red-500 text-white" />}
                <span className={`inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white ${numericPace === null ? 'opacity-75' : ''}`}>
                  vs pace <b className="ml-1 tabular-nums">{paceChip}</b>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
