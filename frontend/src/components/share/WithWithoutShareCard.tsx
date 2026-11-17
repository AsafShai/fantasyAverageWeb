import { ShareCardButton } from './ShareCardButton'
import { ShareCard, type ShareCardTheme } from './ShareCard'
import { buildWithWithoutMessage, withWithoutShareUrl } from './withWithoutMessage'
import { toListHeadshotUrl } from '../../utils/adp'
import { formatDelta, formatStat, formatZ, type TeammateRow } from '../../utils/withWithout'

interface WithWithoutShareCardProps extends ShareCardTheme {
  row: TeammateRow
  columns: string[]
  reverse: Set<string>
  /** Last names of the players sitting out, already joined. */
  names: string
  /** "both sat" when more than one player is picked; omitted for one. */
  modeLabel: string | null
  teamAbbr: string
}

const zText = (z: number | null) => (z === null ? '—' : `${z < -0.004 ? '−' : ''}${Math.abs(z).toFixed(2)}`)

function tone(cat: string, d: number, reverse: Set<string>): 'good' | 'bad' | null {
  const { dir } = formatDelta(cat, d)
  if (dir === 'flat') return null
  const good = reverse.has(cat) ? dir === 'down' : dir === 'up'
  return good ? 'good' : 'bad'
}

/** One teammate's per-game line with the picked players, without them, and the change. */
export const WithWithoutShareCard = ({
  dark, row, columns, reverse, names, modeLabel, teamAbbr,
}: WithWithoutShareCardProps) => {
  const sitting = modeLabel ? `without ${names} · ${modeLabel}` : `without ${names}`
  const zTone = row.zDelta === null || Math.abs(row.zDelta) < 0.01 ? null : row.zDelta > 0 ? 'good' : 'bad'
  return (
    <ShareCard
      dark={dark}
      wide
      extraWide
      kicker="With / Without"
      title={row.player.name}
      badge={row.player.owner?.name ?? 'FA'}
      photo={toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${row.player.player_id}.png`)}
      subtitle={`${teamAbbr} · ${sitting}`}
      footer={<span>Compares the games. It doesn’t prove one player caused the change.</span>}
    >
      <div className="share-card__body">
        <table>
          <thead>
            <tr>
              <th className="sc-left" />
              {columns.map(c => <th key={c}>{c}</th>)}
              <th>Z</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="sc-left">With <span style={{ color: 'var(--sc-muted)' }}>{row.withGroup.games}</span></td>
              {columns.map(c => <td key={c}>{formatStat(c, row.withVals[c])}</td>)}
              <td>{zText(row.zWith)}</td>
            </tr>
            <tr>
              <td className="sc-left">Without <span style={{ color: 'var(--sc-muted)' }}>{row.withoutGroup.games}</span></td>
              {columns.map(c => <td key={c}>{formatStat(c, row.withoutVals[c])}</td>)}
              <td className="sc-strong">{zText(row.zWithout)}</td>
            </tr>
            <tr>
              <td className="sc-left sc-strong">Change</td>
              {columns.map(c => {
                const t = tone(c, row.deltas[c], reverse)
                return (
                  <td key={c}>
                    <span className={t ? `sc-chip sc-${t}` : undefined}>{formatDelta(c, row.deltas[c]).text}</span>
                  </td>
                )
              })}
              <td>
                <span className={zTone ? `sc-chip sc-${zTone}` : undefined}>{formatZ(row.zDelta)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </ShareCard>
  )
}

/** Share this teammate's with / without line. Hidden while share cards are off. */
export function WithWithoutShareButton({
  row, columns, reverse, names, modeLabel, teamAbbr, sheet = false,
}: Omit<WithWithoutShareCardProps, 'dark'> & { sheet?: boolean }) {
  const shareText = buildWithWithoutMessage(
    row.player.name, names, modeLabel, row.zDelta, row.withGroup.games, row.withoutGroup.games, withWithoutShareUrl(),
  )
  return (
    <ShareCardButton
      title={`${row.player.name} without ${names}`}
      shareText={shareText}
      sheet={sheet}
      contentKey={`${row.zWith ?? ''}:${row.zWithout ?? ''}:${row.withGroup.games}:${row.withoutGroup.games}`}
      renderCard={({ dark }) => (
        <WithWithoutShareCard
          dark={dark}
          row={row}
          columns={columns}
          reverse={reverse}
          names={names}
          modeLabel={modeLabel}
          teamAbbr={teamAbbr}
        />
      )}
    />
  )
}
