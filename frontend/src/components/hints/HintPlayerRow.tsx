import PlayerNameLink from '../PlayerNameLink'
import InjuryBadge from '../InjuryBadge'
import { SlotPill as DesktopSlotPill } from '../RosterDayView'
import { InjuryMark, SlotPill as MobileSlotPill } from '../../mobile/ui'
import type { HintPlayerLine, HintPlayerRanks } from '../../utils/teamHints/types'

type HintsLayout = 'desktop' | 'mobile'

function InlineRanks({ ranks }: { ranks: HintPlayerRanks }) {
  const items: { key: string; label: string; rank: number }[] = []
  if (ranks.last15) items.push({ key: 'l15', label: 'L15', rank: ranks.last15.rank })
  if (ranks.season) items.push({ key: 'szn', label: 'Szn', rank: ranks.season.rank })
  if (items.length === 0) return null
  return (
    <span className="mgr-hint-inline-ranks" aria-label="Value ranks">
      {items.map((it) => (
        <span key={it.key} className="mgr-hint-ir" title={it.label}>
          <span className="mgr-hint-ir-lbl">{it.label}</span>
          <span className="mgr-hint-ir-val">#{it.rank}</span>
        </span>
      ))}
    </span>
  )
}

function noteClass(note: string): string {
  if (note.startsWith('Tonight vs ')) return 'mgr-hint-tail mgr-hint-tail--matchup'
  if (note.startsWith('Season rank in top') || note.startsWith('Last 15 rank in top')) {
    return 'mgr-hint-tail mgr-hint-tail--up'
  }
  if (note.startsWith('Season rank outside') || note.startsWith('Last 15 rank outside')) {
    return 'mgr-hint-tail mgr-hint-tail--down'
  }
  return 'mgr-hint-tail'
}

function compactNote(note: string): string {
  if (note.startsWith('Tonight vs ')) return note.replace('Tonight vs ', 'vs ')
  return note.replace(/^Recent form: /, '')
}

function InlineNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <>
      {notes.map((note) => (
        <span key={note} className={noteClass(note)} title={note}>
          {compactNote(note)}
        </span>
      ))}
    </>
  )
}

export function HintPlayerRow({ player, layout }: { player: HintPlayerLine; layout: HintsLayout }) {
  const mobile = layout === 'mobile'
  const notes = player.notes ?? []
  const ranks = player.ranks ?? {}

  const matchupNotes = notes.filter((n) => n.startsWith('Tonight vs '))
  const otherNotes = notes.filter((n) => !n.startsWith('Tonight vs '))

  return (
    <li className={`mgr-hint-player-line ${mobile ? 'mgr-hint-player-line--mobile' : ''}`}>
      <span className="mgr-hint-line-cluster">
        <span className="mgr-hint-line-slot">
          {player.lineupSlot ? (
            mobile ? <MobileSlotPill slot={player.lineupSlot} /> : <DesktopSlotPill slot={player.lineupSlot} />
          ) : (
            <span className="mgr-hint-line-slot-ph" aria-hidden="true" />
          )}
        </span>
        <span className="mgr-hint-line-name">
          <PlayerNameLink
            name={player.name}
            playerId={player.playerId}
            className={mobile ? 'mgr-hint-name-link' : undefined}
          />
          {mobile ? <InjuryMark status={player.injuryStatus} /> : <InjuryBadge status={player.injuryStatus} />}
        </span>
        {matchupNotes.length > 0 ? (
          <span className="mgr-hint-line-tails mgr-hint-line-tails--matchup">
            <InlineNotes notes={matchupNotes} />
          </span>
        ) : null}
        <InlineRanks ranks={ranks} />
      </span>
      {otherNotes.length > 0 ? (
        <div className="mgr-hint-line-detail">
          <InlineNotes notes={otherNotes} />
        </div>
      ) : null}
    </li>
  )
}
