import PlayerNameLink from '../PlayerNameLink'
import InjuryBadge from '../InjuryBadge'
import { SlotPill as DesktopSlotPill } from '../RosterDayView'
import { InjuryMark } from '../../mobile/ui'
import type { HintPlayerLine, HintPlayerRanks } from '../../utils/teamHints/types'

type HintsLayout = 'desktop' | 'mobile'

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

function matchupFromNotes(notes: string[]): string | null {
  const note = notes.find((n) => n.startsWith('Tonight vs '))
  return note ? compactNote(note) : null
}

function InlineNotes({ notes, stacked }: { notes: string[]; stacked?: boolean }) {
  if (notes.length === 0) return null
  if (stacked) {
    return (
      <>
        {notes.map((note) => (
          <div key={note} className={`mgr-hint-detail-row ${noteClass(note)}`} title={note}>
            {compactNote(note)}
          </div>
        ))}
      </>
    )
  }
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

function RankCell({ label, rank }: { label: string; rank?: number }) {
  return (
    <span className={`mgr-hint-rank-cell${rank == null ? ' mgr-hint-rank-cell--empty' : ''}`}>
      <span className="mgr-hint-ir-lbl">{label}</span>
      <span className="mgr-hint-ir-val">{rank != null ? `#${rank}` : '—'}</span>
    </span>
  )
}

function ranksFrom(ranks: HintPlayerRanks) {
  return {
    l15: ranks.last15?.rank,
    szn: ranks.season?.rank,
  }
}

export function HintPlayerRow({ player, layout }: { player: HintPlayerLine; layout: HintsLayout }) {
  const mobile = layout === 'mobile'
  const notes = player.notes ?? []
  const { l15, szn } = ranksFrom(player.ranks ?? {})

  const matchupNotes = notes.filter((n) => n.startsWith('Tonight vs '))
  const otherNotes = notes.filter((n) => !n.startsWith('Tonight vs '))
  const matchup = matchupFromNotes(notes)
  const hasInjury = player.injuryStatus != null && player.injuryStatus !== ''

  return (
    <li className={`mgr-hint-player-line ${mobile ? 'mgr-hint-player-line--mobile' : ''}`}>
      <div className="mgr-hint-line-grid">
        {!mobile ? (
          <span className="mgr-hint-col mgr-hint-col--slot">
            {player.lineupSlot ? (
              <DesktopSlotPill slot={player.lineupSlot} />
            ) : (
              <span className="mgr-hint-line-slot-ph" aria-hidden="true" />
            )}
          </span>
        ) : null}
        <span className="mgr-hint-col mgr-hint-col--player">
          <span className="mgr-hint-player-identity">
            <span className="mgr-hint-player-name-wrap">
              <PlayerNameLink
                name={player.name}
                playerId={player.playerId}
                className={mobile ? 'mgr-hint-name-link' : undefined}
              />
              {hasInjury ? (
                mobile ? (
                  <InjuryMark status={player.injuryStatus} />
                ) : (
                  <InjuryBadge status={player.injuryStatus} />
                )
              ) : null}
            </span>
            {!mobile && matchup ? (
              <span className="mgr-hint-identity-opp" title={matchupNotes[0]}>
                {matchup}
              </span>
            ) : null}
          </span>
        </span>
        <span className="mgr-hint-col mgr-hint-col--l15">
          <RankCell label="L15" rank={l15} />
        </span>
        <span className="mgr-hint-col mgr-hint-col--szn">
          <RankCell label="Szn" rank={szn} />
        </span>
      </div>
      {otherNotes.length > 0 ? (
        <div className="mgr-hint-line-detail">
          <InlineNotes notes={otherNotes} stacked={mobile} />
        </div>
      ) : null}
    </li>
  )
}
