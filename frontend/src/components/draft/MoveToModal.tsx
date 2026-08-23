import { useEffect, useMemo, useRef, useState } from 'react'
import PlayerIdentityCell from './PlayerIdentityCell'
import { previewMove } from '../../utils/draftRankings'
import type { AdpPlayer } from '../../types/api'

export default function MoveToModal({
  player,
  currentRank,
  order,
  playersById,
  onConfirm,
  onClose,
  onNeedIds,
}: {
  player: AdpPlayer
  currentRank: number
  order: string[]
  playersById: Map<string, AdpPlayer>
  onConfirm: (rank: number) => void
  onClose: () => void
  onNeedIds: (ids: string[]) => void
}) {
  const [rankText, setRankText] = useState(String(currentRank))
  const inputRef = useRef<HTMLInputElement>(null)
  const maxRank = Math.max(1, order.length)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const parsed = Number(rankText)
  const rank = Number.isFinite(parsed) ? Math.max(1, Math.min(Math.round(parsed), maxRank)) : null
  const preview = useMemo(
    () => (rank == null ? null : previewMove(order, player.id, rank)),
    [order, player.id, rank],
  )

  useEffect(() => {
    onNeedIds(preview ? [...preview.above, player.id, ...preview.below] : [player.id])
  }, [preview, player.id, onNeedIds])

  const rows = preview
    ? [
        ...preview.above.map((id, i) => ({
          id,
          rank: preview.index - preview.above.length + i + 1,
          highlight: false,
        })),
        { id: player.id, rank: preview.index + 1, highlight: true },
        ...preview.below.map((id, i) => ({
          id,
          rank: preview.index + 2 + i,
          highlight: false,
        })),
      ]
    : []

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-to-title"
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="move-to-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Move {player.name}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Currently #{currentRank}. Enter a new rank — the rest of the board shifts around that slot.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">Move to rank</span>
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={maxRank}
            value={rankText}
            onChange={(e) => setRankText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rank != null) onConfirm(rank)
            }}
            className="w-24 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-2 sm:py-1.5 text-base sm:text-sm tabular-nums"
          />
          <span className="text-xs text-gray-400">of {maxRank}</span>
        </label>

        <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            Nearby after move
          </div>
          {rank == null ? (
            <p className="px-3 py-6 text-sm text-center text-gray-400">Enter a rank to preview.</p>
          ) : (
            <ul>
              {rows.map((row) => {
                const p = playersById.get(row.id)
                if (!p) return null
                return (
                  <li
                    key={`${row.id}-${row.rank}`}
                    className={`flex items-center gap-3 px-3 py-2 border-b last:border-b-0 border-gray-100 dark:border-gray-800 ${
                      row.highlight
                        ? 'bg-blue-50 dark:bg-blue-900/40 ring-1 ring-inset ring-blue-300 dark:ring-blue-600'
                        : 'bg-white dark:bg-gray-900'
                    }`}
                  >
                    <span className="w-8 text-right tabular-nums text-sm font-semibold text-gray-500">
                      {row.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <PlayerIdentityCell
                        name={p.name}
                        playerId={p.espn_id}
                        photoUrl={p.photo_url}
                        teamAbbr={p.team_abbr}
                        positions={p.positions}
                      />
                    </div>
                    {row.highlight ? (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 shrink-0">
                        Here
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={rank == null}
            onClick={() => rank != null && onConfirm(rank)}
            className="btn-primary flex-1 sm:flex-none text-sm py-2.5 sm:py-1.5 px-4 disabled:opacity-50"
          >
            Confirm move
          </button>
        </div>
      </div>
    </div>
  )
}
