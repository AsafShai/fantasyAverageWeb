import type { ReactNode } from 'react'
import type { MoveKind, PlayerStint } from '../../types/activity'
import type { StatMode } from '../../utils/leagueActivity'
import { rankTone, signedZ, valueTitle } from './stintValue'

// The two sides of a trade. Validated as a categorical pair (light and dark)
// so they stay distinct for color-blind viewers; every use also carries a label.
export const SIDE_DOT = ['bg-[#2a78d6] dark:bg-[#3987e5]', 'bg-[#eb6834] dark:bg-[#d95926]'] as const
export const SIDE_BAR = SIDE_DOT
export const SIDE_PANEL = [
  'bg-blue-50 dark:bg-[#1c3352]',
  'bg-orange-50 dark:bg-[#43261a]',
] as const

export function SideDot({ side }: { side: 0 | 1 }) {
  return <span aria-hidden="true" className={`mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-[-1px] ${SIDE_DOT[side]}`} />
}

const KIND_LABEL: Record<MoveKind, string> = {
  add: 'Added',
  drop: 'Dropped',
  waiver: 'Waiver claim',
  trade_drop: 'Dropped for trade',
  trade: 'Trade',
}

const KIND_TONE: Record<MoveKind, string> = {
  add: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  waiver: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  drop: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  trade_drop: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  trade: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
}

export function KindPill({ kind }: { kind: MoveKind }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${KIND_TONE[kind]}`}>
      {KIND_LABEL[kind]}
    </span>
  )
}

export function Pill({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'ok'; title?: string }) {
  const tones = {
    neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  }
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function StatModeToggle({ mode, onChange }: { mode: StatMode; onChange: (m: StatMode) => void }) {
  return (
    <div role="group" aria-label="Stat mode" className="flex overflow-hidden rounded-lg border border-gray-300 text-sm dark:border-gray-600">
      {(['totals', 'per_game'] as const).map(m => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`px-3 py-1.5 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}
        >
          {m === 'totals' ? 'Totals' : 'Per Game'}
        </button>
      ))}
    </div>
  )
}

export const SELECT_CLASS =
  'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap tabular-nums'

/** Rank and z-score of a stint against the league over the same dates, as two labeled pills. */
export function ValueChips({ stint }: { stint: PlayerStint }) {
  const v = stint.value
  if (!v) return null
  const title = valueTitle(stint)
  return (
    <>
      <span title={title} className={`${CHIP} ${rankTone(v.rank)}`}>
        <span className="font-normal opacity-80">Rank</span>
        <span className="font-semibold">{v.rank}</span>
      </span>
      <span title={title} className={`${CHIP} bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200`}>
        <span className="font-normal opacity-80">Z-score</span>
        <span className="font-semibold">{signedZ(v.z)}</span>
      </span>
    </>
  )
}
