import { Link } from 'react-router'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { Segmented } from '../ui'
import { formatDelta, formatGameStat, formatStat, formatZ, entryValue, type GameKind, type TeammateRow } from '../../utils/withWithout'
import type { WithWithoutState } from '../../pages/withWithout/useWithWithout'
import './nba.css'
import './withWithout.css'

const KIND_LABEL: Record<GameKind, string> = { with: 'With', without: 'W/o', unused: '—' }

function DeltaText({ cat, d, reverse }: { cat: string; d: number; reverse: Set<string> }) {
  const { text, dir } = formatDelta(cat, d)
  const good = reverse.has(cat) ? dir === 'down' : dir === 'up'
  return <span className={`mr-ww-d ${dir === 'flat' ? 'flat' : good ? 'up' : 'dn'}`}>{text}</span>
}

function ZPill({ z }: { z: number | null }) {
  const cls = z === null || Math.abs(z) < 0.01 ? 'flat' : z > 0 ? 'up' : 'dn'
  return <span className={`mr-ww-z ${cls}`}>{formatZ(z)}</span>
}

function Row({ s, r }: { s: WithWithoutState; r: TeammateRow }) {
  const open = s.openId === r.player.player_id
  const mine = r.player.owner?.team_id === s.myTeamId
  const season = s.season!
  const cats = s.columns.filter(c => c !== 'MIN')
  return (
    <li className={`mr-ww-row${mine ? ' mine' : ''}`}>
      <button type="button" className="mr-ww-row-head" aria-expanded={open} onClick={() => s.toggleRow(r.player.player_id)}>
        <span className="mr-ww-name">
          <b>{r.player.name}</b>
          <span className="mr-meta">
            {r.player.pos} · {r.player.owner ? `${r.player.owner.name}${mine ? ' · You' : ''}` : <span className="mr-ww-fa">FA</span>} · {r.withGroup.games} with / {r.withoutGroup.games} w/o
            {r.small && <span className="mr-ww-small">small</span>}
          </span>
        </span>
        <span className="mr-ww-right">
          <ZPill z={r.zDelta} />
          <span className="mr-meta">Z Δ</span>
        </span>
      </button>
      <div className="mr-ww-min">
        <span className="mr-meta">MIN</span>
        <span className="mr-num">{formatStat('MIN', r.withVals.MIN)} → {formatStat('MIN', r.withoutVals.MIN)}</span>
        <DeltaText cat="MIN" d={r.deltas.MIN} reverse={s.reverse} />
        <span className="mr-ww-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </div>
      {!open && (
        <div className="mr-ww-tiles">
          {cats.map(c => (
            <span key={c} className="mr-ww-tile"><span className="mr-meta">{c}</span><DeltaText cat={c} d={r.deltas[c]} reverse={s.reverse} /></span>
          ))}
        </div>
      )}
      {open && (
        <div className="mr-ww-open">
          <span className="mr-meta">Per game: with = {r.withGroup.games} games he played alongside them, without = {r.withoutGroup.games} games they sat</span>
          <div className="mr-ww-detail">
            {cats.map(c => (
              <div key={c} className="mr-ww-cell">
                <b>{c}</b>
                <span className="mr-ww-line"><span className="mr-ww-tok with">With</span><span className="mr-num">{formatStat(c, r.withVals[c])}</span></span>
                <span className="mr-ww-line"><span className="mr-ww-tok without">W/o</span><span className="mr-num">{formatStat(c, r.withoutVals[c])}</span></span>
                <span className="mr-ww-line"><span className="mr-meta">Δ</span><DeltaText cat={c} d={r.deltas[c]} reverse={s.reverse} /></span>
              </div>
            ))}
          </div>
          <div className="mr-ww-actions">
            <button type="button" className="mr-btn mr-sm" aria-pressed={s.rowView === 'log'} onClick={() => s.setRowView(s.rowView === 'log' ? 'none' : 'log')}>Game log</button>
            <Link className="mr-btn mr-sm" to={`/player/${r.player.player_id}`}>Profile</Link>
            <button type="button" className="mr-btn mr-sm" onClick={() => s.openTrade(r.player)}>Trade Analyzer</button>
          </div>
          {s.rowView === 'log' && (
            <ul className="mr-ww-log">
              {season.games.map((g, i) => {
                const e = r.player.lines[i]
                if (e === null) return null
                const k = s.split!.kinds[i]
                return (
                  <li key={g.game_id} className={e === 0 ? 'sat' : ''}>
                    <span className="mr-meta">{g.date.slice(5).replace('-', '/')} {g.home ? 'vs' : '@'} {g.opp}</span>
                    <span className={`mr-ww-tok ${e === 0 ? 'unused' : k}`}>{e === 0 ? 'Didn’t play' : KIND_LABEL[k]}</span>
                    <span className="mr-num">{Array.isArray(e) ? `${formatGameStat('PTS', entryValue(e, season.line_fields, 'PTS'))} pts · ${formatGameStat('REB', entryValue(e, season.line_fields, 'REB'))} reb · ${formatGameStat('AST', entryValue(e, season.line_fields, 'AST'))} ast` : '—'}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** With / Without on a phone: the same state as the desktop page, stacked
 * steps, a compact game strip, and one card per teammate. */
export default function MobileWithWithout({ s }: { s: WithWithoutState }) {
  const season = s.season
  return (
    <div className="mr-root mr-nba mr-ww" data-testid="mobile-with-without">
      <div className="mr-nba-head">
        <h1 className="mr-h1">With / Without</h1>
        <span className="mr-meta">How teammates play in games those players sat vs. games they played.</span>
      </div>
      {s.error && <ErrorMessage message={s.error} />}

      <section className="mr-card mr-ww-steps">
        <div className="mr-ww-step"><span className="mr-ww-n">1</span><b>NBA team</b></div>
        <label htmlFor="mww-team" className="sr-only">NBA team</label>
        <select id="mww-team" className="mr-ww-select" value={s.teamId ?? ''} onChange={e => s.pickTeam(Number(e.target.value))}>
          {s.nbaTeams.map(t => <option key={t.team_id} value={t.team_id}>{t.name}{t.has_out_today ? ' · out today' : ''}</option>)}
        </select>
        <button type="button" className="mr-chip" aria-pressed={s.injOnly} onClick={() => s.setInjOnly(!s.injOnly)}>Only teams with a player out today</button>

        {season && (
          <>
            <div className="mr-ww-step"><span className="mr-ww-n">2</span><b>Compare without</b><span className="mr-meta">up to 3 · {s.picked.length ? `${s.picked.length} picked` : 'none picked yet'}</span></div>
            <div className="mr-chips mr-wrap">
              {s.pickOptions.map(o => (
                <button key={o.player.player_id} type="button" className="mr-chip mr-ww-pick" aria-pressed={o.picked} disabled={o.disabled} onClick={() => s.togglePick(o.player.player_id)}>
                  {o.player.name}
                  <span className="mr-ww-pick-sub">{o.missed ? `${o.missed}/${o.onTeam}` : '0'}</span>
                  {o.player.two_way && <span className="mr-ww-tag">2W</span>}
                  {o.player.out_today && <span className="mr-ww-out">OUT</span>}
                </button>
              ))}
            </div>
          </>
        )}

        {s.picked.length > 1 && (
          <>
            <div className="mr-ww-step"><span className="mr-ww-n">3</span><b>Count a game as “without” when</b></div>
            <Segmented label="Which games count as without" value={s.mode} onChange={s.setMode} options={[{ value: 'all', label: 'All of them sat' }, { value: 'any', label: 'Any of them sat' }]} />
          </>
        )}
      </section>

      {s.loading && <LoadingSpinner />}

      {season && s.split && (
        <section className="mr-card mr-ww-split">
          <span className="mr-h2">Which games are compared</span>
          <span className="mr-meta">{s.split.sentence}</span>
          <div className="mr-ww-counts">
            <span><b className="mr-num">{s.split.counts.with}</b><span className="mr-ww-tok with">With</span></span>
            <span><b className="mr-num">{s.split.counts.without}</b><span className="mr-ww-tok without">Without</span></span>
            <span><b className="mr-num">{s.split.counts.unused}</b><span className="mr-ww-tok unused">Not used</span></span>
          </div>
          <div className="mr-ww-strip" role="img" aria-label={`${season.abbr} games: ${s.split.counts.without} without, ${s.split.counts.with} with`}>
            {season.games.map((g, i) => (
              <span key={g.game_id} className={`mr-ww-game ${s.split!.kinds[i]}`} title={`${g.date} ${g.home ? 'vs' : '@'} ${g.opp} ${g.result}`}>
                <span>{g.date.slice(5).replace('-', '/')}</span>
                <span>{g.opp}</span>
                <b>{KIND_LABEL[s.split!.kinds[i]]}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      {season && (
        <>
          <div className="mr-ww-toolbar">
            <button type="button" className="mr-chip" aria-pressed={s.faOnly} onClick={() => s.setFaOnly(!s.faOnly)}>Free agents only</button>
            <label className="mr-meta" htmlFor="mww-sort">Sort</label>
            <select id="mww-sort" className="mr-ww-select mr-ww-sort" value={s.sort} onChange={e => s.setSort(e.target.value)}>
              <option value="z">Z Δ</option>
              {s.columns.map(c => <option key={c} value={c}>{c} Δ</option>)}
            </select>
          </div>
          {s.picked.length === 0 ? (
            <div className="mr-card mr-nba-empty">Pick at least one {season.abbr} player in step 2.</div>
          ) : s.rows.length === 0 ? (
            <div className="mr-card mr-nba-empty">{s.split?.counts.without === 0 ? 'No games where they sat. Try “Any of them sat” or remove a player.' : 'No teammates match these filters.'}</div>
          ) : (
            <ul className="mr-ww-list">{s.rows.map(r => <Row key={r.player.player_id} s={s} r={r} />)}</ul>
          )}
          <span className="mr-meta mr-ww-foot">Z Δ = change in fantasy value of his per-game line, scored like Player Rankings. “small” = fewer than 3 games without.</span>
        </>
      )}
    </div>
  )
}
