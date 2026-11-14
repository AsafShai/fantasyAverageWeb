import { ShareCard, type ShareCardTheme } from './ShareCard'
import { rowWinner, tradeShareCellLines, type TradeShareRow } from './shareCardFormat'
import { PlayerFace, TradeVersusRow, pillClassForLabel } from '../../pages/Trade/components/TradeVersusRow'
import '../../pages/Trade/trade-comparison.css'

export interface TradeSharePlayer {
  name: string
  playerId?: number | null
  /** Rank and z-score among every player over the same dates, when known. */
  value?: { rank: number; z: number }
}

export interface TradeShareSide {
  /** Column/box heading, e.g. "Brick City gets" or "Add". */
  heading: string
  players: TradeSharePlayer[]
}

const signedZ = (z: number) => `${z >= 0 ? '+' : ''}${z.toFixed(2)}`

interface TradeShareCardProps extends ShareCardTheme {
  /** Top-right label in the brand row. */
  kicker?: string
  title: string
  subtitle: string
  sides: [TradeShareSide, TradeShareSide]
  rows: TradeShareRow[]
  mode: 'averages' | 'totals'
  /** Side to outline as the user's own team, if any. */
  highlightSide: 0 | 1 | null
}

export const TradeShareCard = ({ kicker = 'Trade Analyzer', title, subtitle, sides, rows, mode, highlightSide, dark }: TradeShareCardProps) => {
  const hasValues = sides.some(side => side.players.some(p => p.value))
  const hasCategoryZ = rows.some(row => row.zValues)

  return (
    <ShareCard
      dark={dark}
      kicker={kicker}
      title={title}
      subtitle={subtitle}
      wide
      footer={<>
        {rows.length > 0 && <span>{mode === 'averages' ? 'Combined per-game stats of each side' : 'Combined totals of each side'}</span>}
        {hasValues && <span>#rank · Z-score, per game</span>}
        {hasCategoryZ && <span>▲ = better category Z on main stat</span>}
      </>}
    >
      <div className="tc-share-versus-wrap">
        <div className="tc-share-teams">
          {sides.map((side, i) => (
            <div
              key={side.heading}
              className={`tc-team-card${highlightSide === i ? ' share-card__tile--me' : ''}`}
            >
              <div className="tc-team-card__head">
                <div>
                  <div className="tc-team-card__name">{side.heading.replace(/ gets$/i, '')}</div>
                  <div className="tc-team-card__gets">gets</div>
                </div>
              </div>
              <ul className="tc-player-list">
                {side.players.map(({ name, playerId, value }) => (
                  <li key={name} className="tc-player-chip">
                    <PlayerFace name={name} playerId={playerId} size="chip" />
                    <span className="tc-player-chip__name">{name}</span>
                    {value && (
                      <span className="tc-player-chip__value">#{value.rank} · Z {signedZ(value.z)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="tc-share-versus" role="table">
          {rows.map(row => {
            const left = tradeShareCellLines(row, 0, mode)
            const right = tradeShareCellLines(row, 1, mode)
            return (
              <TradeVersusRow
                key={row.category}
                label={row.category}
                pillClass={pillClassForLabel(row.category)}
                vsStyle="slider"
                mainWinner={rowWinner(row)}
                left={{
                  main: left.main,
                  sub: left.attempts,
                  z: row.zValues?.[0] ?? null,
                }}
                right={{
                  main: right.main,
                  sub: right.attempts,
                  z: row.zValues?.[1] ?? null,
                }}
              />
            );
          })}
        </div>
      </div>
    </ShareCard>
  )
}