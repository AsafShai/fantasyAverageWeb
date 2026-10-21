import { ShareCard, type ShareCardTheme } from './ShareCard'
import { formatCardValue, rowWinner, type TradeShareRow } from './shareCardFormat'

export interface TradeSharePlayer {
  name: string
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
  title: string
  subtitle: string
  sides: [TradeShareSide, TradeShareSide]
  rows: TradeShareRow[]
  mode: 'averages' | 'totals'
  /** Side to outline as the user's own team, if any. */
  highlightSide: 0 | 1 | null
}

export const TradeShareCard = ({ title, subtitle, sides, rows, mode, highlightSide, dark }: TradeShareCardProps) => {
  const hasValues = sides.some(side => side.players.some(p => p.value))

  return (
    <ShareCard
      dark={dark}
      kicker="Trade Analyzer"
      title={title}
      subtitle={subtitle}
      footer={<>
        <span>{mode === 'averages' ? 'Combined per-game stats of each side' : 'Combined totals of each side'}</span>
        {hasValues && <span>#rank · Z-score, per game</span>}
      </>}
    >
      <div className="share-card__tiles">
        {sides.map((side, i) => (
          <div key={side.heading} className={`share-card__tile${highlightSide === i ? ' share-card__tile--me' : ''}`}>
            <div className="share-card__label">{side.heading}</div>
            <ul className="share-card__list">
              {side.players.map(({ name, value }) => (
                <li key={name} className={value ? 'share-card__player' : undefined}>
                  <span className="share-card__player-name">{name}</span>
                  {value && <span className="share-card__player-value">#{value.rank} · Z {signedZ(value.z)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="share-card__body">
        <table>
          <colgroup><col style={{ width: 56 }} /><col /><col /></colgroup>
          <thead>
            <tr>
              <th className="sc-left">Cat</th>
              <th>{sides[0].heading}</th>
              <th>{sides[1].heading}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const winner = rowWinner(row)
              return (
                <tr key={row.category}>
                  <td className="sc-left sc-strong">{row.category}</td>
                  {row.values.map((value, i) => (
                    <td key={i} className={winner === null ? undefined : winner === i ? 'sc-win' : 'sc-lose'}>
                      {formatCardValue(row.category, value, mode)}{winner === i ? ' ▲' : ''}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </ShareCard>
  )
}
