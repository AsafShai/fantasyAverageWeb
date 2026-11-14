import { useState } from 'react'
import { Link } from 'react-router'
import EspnUpdatedNote from '../../components/EspnUpdatedNote'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useTonightGames } from '../../hooks/useTonightGames'
import { formatEspnUpdated } from '../../utils/espnUpdated'
import { liveBadgeText, liveMoment } from '../../utils/live'
import type { LiveBlock } from '../../types/api'
import { BottomSheet } from './BottomSheet'
import { Segmented } from './Segmented'

interface Props {
  live?: LiveBlock | null
  espnUpdatedAt?: string | null
  /** The "what do the numbers count" line; on mobile it lives in the sheet. */
  note?: string | null
  /** Class for the fallback ESPN note. */
  noteClassName?: string
}

/** Mobile live badge: "LIVE · 2 of 4". Tapping opens tonight's games and the averages note. */
export function LiveBadgeMobile({ live, espnUpdatedAt, note, noteClassName }: Props) {
  const moment = liveMoment(live)
  const [open, setOpen] = useState(false)
  // Shared with Box Scores and the Daily roster, so the choice is remembered.
  const [noSpoilers, setNoSpoilers] = usePersistedState('boxScores.noSpoilers', false)
  const { games, isLoading } = useTonightGames(open && moment !== null, noSpoilers, live?.slate_date)

  if (!live || !moment) return <EspnUpdatedNote updatedAt={espnUpdatedAt} className={noteClassName} />

  const isLive = moment === 'live'
  const official = live.official_updated_at ? formatEspnUpdated(live.official_updated_at) : null

  return (
    <>
      <button
        type="button"
        className={`mr-live-badge ${isLive ? 'mr-live' : 'mr-final'}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="mr-live-dot" aria-hidden="true" />
        <span>{isLive ? 'LIVE' : 'FINAL'} · {liveBadgeText(live, true)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Tonight's games">
        {note && <p className="mr-live-note">{note}</p>}
        <Segmented
          label="Spoiler visibility"
          options={[{ value: 'full', label: 'Full box' }, { value: 'hide', label: '🚫 No spoilers' }]}
          value={noSpoilers ? 'hide' : 'full'}
          onChange={(v) => setNoSpoilers(v === 'hide')}
          className="mr-live-spoilers"
        />
        {isLoading && <p className="mr-meta">Loading…</p>}
        <ul className="mr-live-games">
          {games.map(g => (
            <li key={g.id}>
              <Link to={g.href} onClick={() => setOpen(false)}>
                <span>{g.name}</span>
                <span className="mr-live-game-right">
                  {g.score && <span className="mr-live-score">{g.score}</span>}
                  <span className={g.status === 'live' ? 'mr-live-status' : 'mr-meta'}>{g.label}</span>
                  <span aria-hidden="true" className="mr-meta">›</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mr-meta">{official ? `ESPN official: ${official}.` : 'Tonight is added on top until ESPN updates.'}</p>
      </BottomSheet>
    </>
  )
}
