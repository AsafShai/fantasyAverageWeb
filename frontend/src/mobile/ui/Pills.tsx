import type { ReactNode } from 'react'
import { statusKey } from './statusKey'

/** Injury status, as ESPN reports it. */
export type InjuryStatus = 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE' | 'DAY_TO_DAY' | 'ACTIVE' | 'AVAILABLE' | string

const STATUS: Record<string, { cls: string; label: string }> = {
  OUT: { cls: 'mr-pill-out', label: 'Out' },
  INJURY_RESERVE: { cls: 'mr-pill-out', label: 'Out' },
  SUSPENSION: { cls: 'mr-pill-out', label: 'Suspended' },
  DOUBTFUL: { cls: 'mr-pill-doubt', label: 'Doubtful' },
  QUESTIONABLE: { cls: 'mr-pill-quest', label: 'Questionable' },
  DAY_TO_DAY: { cls: 'mr-pill-quest', label: 'Day-to-day' },
  PROBABLE: { cls: 'mr-pill-prob', label: 'Probable' },
  ACTIVE: { cls: 'mr-pill-avail', label: 'Available' },
  AVAILABLE: { cls: 'mr-pill-avail', label: 'Available' },
}

/** Out red · Doubtful orange · Questionable amber · Probable blue · Available green. */
export function StatusPill({ status, children }: { status: InjuryStatus; children?: ReactNode }) {
  const s = STATUS[statusKey(status)] ?? { cls: 'mr-pill-bench', label: status }
  return <span className={`mr-pill ${s.cls}`}>{children ?? s.label}</span>
}

/** Roster slot: starters green, Bench grey, IR orange. */
export function SlotPill({ slot }: { slot: string }) {
  const key = slot.trim().toUpperCase()
  const cls = key === 'BE' || key === 'BENCH' ? 'mr-pill-bench' : key === 'IR' ? 'mr-pill-ir' : 'mr-pill-starter'
  const label = key === 'BE' ? 'Bench' : slot
  return <span className={`mr-pill mr-square ${cls}`}>{label}</span>
}

export type MoveKind = 'added' | 'waiver' | 'trade' | 'dropped'
const MOVE: Record<MoveKind, { cls: string; label: string }> = {
  added: { cls: 'mr-pill-added', label: 'Added' },
  waiver: { cls: 'mr-pill-waiver', label: 'Waiver claim' },
  trade: { cls: 'mr-pill-trade', label: 'Trade' },
  dropped: { cls: 'mr-pill-dropped', label: 'Dropped' },
}

/** Activity move kind: Added green · Waiver claim lime · Trade blue · Dropped grey. */
export function MoveKindPill({ kind, children }: { kind: MoveKind; children?: ReactNode }) {
  const m = MOVE[kind]
  return <span className={`mr-pill ${m.cls}`}>{children ?? m.label}</span>
}

/** Small "FA" mark next to free agents (depth charts, player lists). */
export function FaMark() {
  return <span className="mr-pill mr-fa mr-pill-fa" title="Free agent">FA</span>
}
