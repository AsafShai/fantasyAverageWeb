import { useEffect, useRef, useState } from 'react'
import type { ConferenceDivisionTree } from '../../minigames/conferenceDivisionTree'
import { nbaTeamLogoUrl } from '../../minigames/conferenceDivisionTree'
import type { WhoAmIMapExclusions } from '../../minigames/whoAmIMapExclusions'
import { emptyWhoAmIMapExclusions } from '../../minigames/whoAmIMapExclusions'

type ConferenceKey = 'East' | 'West'

const RuledOutHint =
  'Ruled out for the mystery player by your Team, Conference, or Division column feedback so far'

function isDivisionRuledOut(
  ex: WhoAmIMapExclusions,
  tab: ConferenceKey,
  division: string,
): boolean {
  if (ex.excludedConferences.has(tab)) return true
  return ex.excludedDivisions.has(division)
}

function isTeamRuledOut(
  ex: WhoAmIMapExclusions,
  tab: ConferenceKey,
  division: string,
  teamName: string,
): boolean {
  if (isDivisionRuledOut(ex, tab, division)) return true
  return ex.excludedTeams.has(teamName)
}

export function NbaMapInfoButton({
  onOpen,
  label = 'View NBA conference and division reference',
}: {
  onOpen: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpen()
      }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      aria-label={label}
      title={label}
    >
      <span className="text-xs font-bold leading-none" aria-hidden>
        ⓘ
      </span>
    </button>
  )
}

export function NbaConferenceDivisionMapDialog({
  open,
  onOpenChange,
  tree,
  clueExclusions,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tree: ConferenceDivisionTree
  clueExclusions?: WhoAmIMapExclusions | null
}) {
  const [tab, setTab] = useState<ConferenceKey>('East')
  const rows = tab === 'East' ? tree.East : tree.West

  const ex = clueExclusions ?? emptyWhoAmIMapExclusions()
  const hasClueNarrowing =
    ex.excludedConferences.size + ex.excludedDivisions.size + ex.excludedTeams.size > 0

  const eastOut = ex.excludedConferences.has('East')
  const westOut = ex.excludedConferences.has('West')
  const tabConflict = eastOut && westOut

  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      if (!eastOut) setTab('East')
      else if (!westOut) setTab('West')
      else setTab('East')
    }
    prevOpen.current = open
  }, [open, eastOut, westOut])

  useEffect(() => {
    if (!open) return
    if (tab === 'East' && eastOut && !westOut) setTab('West')
    if (tab === 'West' && westOut && !eastOut) setTab('East')
  }, [open, tab, eastOut, westOut])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3 py-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conf-div-map-title"
        className="flex max-h-[min(85vh,800px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="shrink-0 space-y-2 border-b border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex items-start justify-between gap-3">
            <h2
              id="conf-div-map-title"
              className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              Conferences and divisions
            </h2>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none px-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            2025-26 season teams in this game, grouped the same way as the Team, Conference, and
            Division columns.
            {hasClueNarrowing ? (
              <>
                {' '}
                <span className="text-gray-800 dark:text-gray-200">
                  Dimmed entries match locations ruled out from your past guesses (Team /
                  Conference / Division cells only).
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div
            className="flex w-full rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
            role="tablist"
            aria-label="Choose conference"
          >
            {(
              [
                { value: 'East', label: 'Eastern' },
                { value: 'West', label: 'Western' },
              ] as const
            ).map((opt) => {
              const disabled = !tabConflict && (opt.value === 'East' ? eastOut : westOut)
              const active = tab === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={disabled}
                  onClick={() => setTab(opt.value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    active
                      ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
          role="region"
          aria-label={tab === 'East' ? 'Eastern conference' : 'Western conference'}
        >
          {tabConflict ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="status">
              Conference clues conflict; both conferences look ruled out. Keep guessing in the
              main grid to refine.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500">No teams loaded for this conference.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {rows.map(({ division, teams }) => {
                const divOut = isDivisionRuledOut(ex, tab, division)
                return (
                  <div
                    key={division}
                    className={`flex min-w-0 flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 sm:p-2.5 dark:border-gray-700 dark:bg-gray-800/40 ${
                      divOut ? 'opacity-45' : ''
                    }`}
                    title={divOut ? RuledOutHint : undefined}
                  >
                    <h3
                      className={`text-center text-[10px] font-bold uppercase leading-tight tracking-wide sm:text-xs ${
                        divOut
                          ? 'line-through text-gray-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {division}
                    </h3>
                    <ul className="flex min-w-0 flex-col gap-2 sm:gap-2.5">
                      {teams.map((t) => {
                        const teamOut = isTeamRuledOut(ex, tab, division, t.name)
                        return (
                          <li
                            key={t.abbr}
                            className="min-w-0 border-b border-gray-200 pb-2 last:border-0 last:pb-0 dark:border-gray-700"
                            title={teamOut ? RuledOutHint : undefined}
                          >
                            <div
                              className={`flex min-w-0 items-center gap-1.5 ${
                                teamOut ? 'opacity-40 grayscale' : ''
                              }`}
                            >
                              <img
                                src={nbaTeamLogoUrl(t.abbr)}
                                alt=""
                                className="h-5 w-5 shrink-0 object-contain"
                              />
                              <span className="truncate text-[11px] font-medium text-gray-900 dark:text-gray-100 sm:text-xs">
                                {t.name}
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
