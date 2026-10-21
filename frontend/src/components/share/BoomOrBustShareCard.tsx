import type { SurpriseRow } from '../../types/api'
import { toListHeadshotUrl } from '../../utils/adp'
import { ShareCard, type ShareCardTheme } from './ShareCard'
import { topReason } from './boomOrBustMessage'

interface BoomOrBustShareCardProps extends ShareCardTheme {
  /** "Tuesday, Oct 20, 2026" */
  dateLabel: string
  games: number
  /** The rows the page shows, already filtered by the viewer's sliders and capped. */
  booms: SurpriseRow[]
  busts: SurpriseRow[]
  thresholds: { good: number; bad: number }
}

const fmtScore = (score: number) => `${score < 0 ? '−' : '+'}${Math.abs(score).toFixed(1)}`

const COLS: [keyof SurpriseRow, string][] = [
  ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['stl', 'STL'], ['blk', 'BLK'],
]

const Section = ({ title, rows, kind, rule }: { title: string; rows: SurpriseRow[]; kind: 'good' | 'bad'; rule: string }) => (
  <div className="share-card__body">
    <div className="share-card__section">
      <span className="share-card__section-title">{title}</span>
      <span className="share-card__section-rule">{rule}</span>
    </div>
    {rows.length === 0 ? (
      <div className="share-card__empty">Nobody crossed the bar</div>
    ) : (
      <table>
        <colgroup>
          <col style={{ width: 16 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 38 }} />
          {COLS.map(([k]) => <col key={k} style={{ width: 23 }} />)}
          <col style={{ width: 36 }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th className="sc-left">Player</th>
            <th>Opp</th>
            {COLS.map(([k, label]) => <th key={k}>{label}</th>)}
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const reason = topReason(row)
            return (
              <tr key={row.player_id}>
                <td className="sc-rank">{index + 1}</td>
                <td className="sc-left">
                  <div className="share-card__person">
                    {/* ESPN's CDN sends Access-Control-Allow-Origin: *, so the exporter can inline it. */}
                    <img
                      className="share-card__avatar"
                      src={toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${row.player_id}.png`) ?? undefined}
                      alt=""
                      crossOrigin="anonymous"
                    />
                    <div className="share-card__person-text">
                      <div className="share-card__player">{row.player_name}</div>
                      <div className="share-card__why">{row.team_abbr}{reason ? ` · ${reason}` : ''}</div>
                    </div>
                  </div>
                </td>
                <td>{row.is_home ? 'vs' : '@'} {row.opponent_abbr}</td>
                {COLS.map(([k]) => <td key={k}>{Math.round(Number(row[k]))}</td>)}
                <td><span className={`sc-chip sc-${kind}`}>{fmtScore(row.score)}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )}
  </div>
)

/** Last night's booms and busts, as the page shows them, in one image. */
export const BoomOrBustShareCard = ({ dark, dateLabel, games, booms, busts, thresholds }: BoomOrBustShareCardProps) => (
  <ShareCard
    dark={dark}
    kicker="boom or bust"
    title="💥 Boom or Bust"
    subtitle={`${dateLabel} · ${games} game${games === 1 ? '' : 's'}`}
    footer={<><span>Score = how unexpected vs his own history and the model</span><span>+ boom · − bust</span></>}
  >
    <Section title="💥 Booms" rows={booms} kind="good" rule={`score ≥ ${thresholds.good.toFixed(1)}`} />
    <Section title="💩 Busts" rows={busts} kind="bad" rule={`score ≤ −${thresholds.bad.toFixed(1)}`} />
  </ShareCard>
)
