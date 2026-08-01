import type { SlotUsage } from '../types/api'
import {
  SLOT_NAMES,
  TONE_CLASS,
  canColor,
  estimatedTone,
  formatCap,
  formatRateDelta,
  formatSlotNumber,
  maxTone,
  projectSlot,
  rateTone,
  type PaceContext,
} from '../utils/slotProjection'

interface SlotUsageTableProps {
  slotUsage: Record<string, SlotUsage>
  avgPace?: number | null
  gameDaysLeft?: number | null
}

const ROW_LABELS = {
  rate: 'Rate',
  max: 'Max',
  estimated: 'Est.',
} as const

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-3 h-3 rounded-sm inline-block ${className}`} />
      <span>{label}</span>
    </span>
  )
}

export default function SlotUsageTable({ slotUsage, avgPace, gameDaysLeft }: SlotUsageTableProps) {
  const pace: PaceContext = { avgPace, gameDaysLeft }
  const colored = canColor(pace)

  const columns = SLOT_NAMES.map(slot => {
    const usage = slotUsage[slot]
    return { slot, usage, projection: usage ? projectSlot(usage.games_used, slot, pace) : null }
  })

  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Slot Usage</h2>
          <p className="text-xs text-gray-500 mt-1">
            Rate is per slot. Max and Est. are the whole column — UTIL cap (246+2).
          </p>
        </div>
        <div className="text-xs text-gray-500 space-y-1 sm:text-right">
          {typeof avgPace === 'number' && (
            <div>
              NBA <span className="font-medium text-gray-700">{avgPace.toFixed(1)}</span> GP/team
              {typeof gameDaysLeft === 'number' && (
                <span> · <span className="font-medium text-gray-700">{gameDaysLeft}</span> days left</span>
              )}
            </div>
          )}
          {!colored && (
            <div className="text-gray-400">Too early — colors start at 10 GP/team.</div>
          )}
        </div>
      </div>

      {colored && (
        <div className="space-y-1 text-xs text-gray-600 mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-gray-500 w-10">Rate</span>
            <LegendSwatch className="bg-green-100" label="<5%" />
            <LegendSwatch className="bg-yellow-100" label="5–10%" />
            <LegendSwatch className="bg-orange-100" label="10–15%" />
            <LegendSwatch className="bg-red-100" label="15%+" />
            <span className="text-gray-400">off the NBA rate, either way</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-gray-500 w-10">Max</span>
            <LegendSwatch className="bg-green-100" label="still reachable" />
            <LegendSwatch className="bg-red-100" label="gone" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-gray-500 w-10">Est.</span>
            <LegendSwatch className="bg-green-100" label="82+" />
            <LegendSwatch className="bg-yellow-100" label="80–82" />
            <LegendSwatch className="bg-orange-100" label="78–80" />
            <LegendSwatch className="bg-red-100" label="<78" />
            <span className="text-gray-400">per slot</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase border border-gray-200 bg-gray-50" />
              {columns.map(({ slot }) => (
                <th
                  key={slot}
                  className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase border border-gray-200 bg-gray-50"
                >
                  {slot}
                  {slot === 'UTIL' && (
                    <div className="text-gray-400 font-normal normal-case">×3 slots</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 border border-gray-200 bg-gray-50 whitespace-nowrap">
                {ROW_LABELS.rate}
                <div className="font-normal text-gray-400 normal-case">used · vs NBA</div>
              </th>
              {columns.map(({ slot, projection }) => {
                if (!projection) return <EmptyCell key={slot} />
                const tone = rateTone(projection.rate, pace)
                return (
                  <td
                    key={slot}
                    className={`px-4 py-3 text-center text-sm font-medium border border-gray-200 ${TONE_CLASS[tone]}`}
                  >
                    <div>{formatSlotNumber(projection.used)}</div>
                    <div className="text-xs font-normal opacity-80">
                      {formatRateDelta(projection.used, avgPace)}
                    </div>
                  </td>
                )
              })}
            </tr>
            <tr>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 border border-gray-200 bg-gray-50 whitespace-nowrap">
                {ROW_LABELS.max}
                <div className="font-normal text-gray-400 normal-case">still reachable</div>
              </th>
              {columns.map(({ slot, projection }) => {
                if (!projection) return <EmptyCell key={slot} />
                const tone = maxTone(projection.maxGamesTotal, slot, pace)
                return (
                  <td
                    key={slot}
                    className={`px-4 py-3 text-center text-sm font-medium border border-gray-200 ${TONE_CLASS[tone]}`}
                  >
                    {formatSlotNumber(projection.maxGamesTotal)}
                    <span className="opacity-50">/{formatCap(slot)}</span>
                  </td>
                )
              })}
            </tr>
            <tr>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 border border-gray-200 bg-gray-50 whitespace-nowrap">
                {ROW_LABELS.estimated}
                <div className="font-normal text-gray-400 normal-case">projected</div>
              </th>
              {columns.map(({ slot, projection }) => {
                if (!projection) return <EmptyCell key={slot} />
                const tone = estimatedTone(projection.estimatedRounded, slot, pace)
                return (
                  <td
                    key={slot}
                    className={`px-4 py-3 text-center text-sm font-medium border border-gray-200 ${TONE_CLASS[tone]}`}
                  >
                    {formatSlotNumber(projection.estimatedRounded)}
                    <span className="opacity-50">/{formatCap(slot)}</span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyCell() {
  return <td className="px-4 py-3 text-center text-gray-400 border border-gray-200">-</td>
}
