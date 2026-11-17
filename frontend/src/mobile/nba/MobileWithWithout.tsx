import { Link } from 'react-router'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { Segmented } from '../ui'
import { formatDelta, formatStat, formatZ, gameLogLabel, type GameKind, type TeammateRow } from '../../utils/withWithout'
import { Z_SORTS, type WithWithoutState } from '../../pages/withWithout/useWithWithout'
import './nba.css'
import './withWithout.css'

const KIND_LABEL: Record<GameKind, string> = { with: 'With', without: 'W/o', unused: 'Not used' }
const zText = (z: number | null) => (z === null ? '—' : `${z < -0.004 ? '−' : ''}${Math.abs(z).toFixed(2)}`)
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function DeltaText({ cat, d, reverse }: { cat: string; d: number; reverse: Set<string> }) {
  const { text, dir } = formatDelta(cat, d)
  const good = reverse.has(cat) ? dir === 'down' : dir === 'up'
  return <span className={`mr-ww-d ${dir === 'flat' ? 'flat' : good ? 'up' : 'dn'}`}>{text}</span>
}

function ZPill({ z }: { z: number | null }) {
  const cls = z === null || Math.abs(z) < 0.01 ? 'flat' : z > 0 ? 'up' : 'dn'
  return <span className={`mr-ww-z ${cls}`}>{formatZ(z)}</span>
}

function Picker({ s }: { s: WithWithoutState }) {
  return (
    <div className="mr-ww-picker">
      {s.pickOptions.map(o => (
        <button key={o.player.player_id} type="button" className="mr-ww-opt" onClick={() => s.addPick(o.player.player_id)}>
          <span className="mr-ww-opt-name">{o.player.name}</span>
          {o.player.out_today && <span className="mr-ww-out">OUT today</span>}
          {o.player.two_way && <span className="mr-ww-tag">2W</span>}
          <span className="mr-meta">missed {o.missed}</span>
        </button>
      ))}
    </div>
  )
}

function GameLog({ s, r }: { s: WithWithoutState; r: TeammateRow }) {
  const id = r.player.player_id
  const log = s.gameLog(r)
  const filter = s.logFilter(id)
  const grid = { gridTemplateColumns: `128px repeat(${s.columns.length}, 46px)` }
  return (
    <div className="mr-ww-logwrap">
      <div className="mr-chips mr-wrap" role="group" aria-label="Which games">
        {log.tabs.map(t => (
          <button key={t.key} type="button" className="mr-chip" aria-pressed={filter === t.key} onClick={() => s.setLogFilter(id, t.key)}>{t.label} · {t.count}</button>
        ))}
      </div>
      <div className="mr-ww-logscroll">
        <div className="mr-ww-logtable">
          <div className="mr-ww-lg head" style={grid}>
            <span className="mr-ww-lg-first">Game</span>
            {s.columns.map(c => <span key={c} className="mr-ww-lg-c">{gameLogLabel(c)}</span>)}
          </div>
          {log.games.map(g => (
            <div key={g.game.game_id} className={`mr-ww-lg${g.dnp || g.kind === 'unused' ? ' dim' : ''}`} style={grid}>
              <span className="mr-ww-lg-first">
                <span className="mr-ww-lg-date"><b>{shortDate(g.game.date)}</b><span className={`mr-ww-tok ${g.dnp ? 'unused' : g.kind}`}>{g.dnp ? 'DNP' : KIND_LABEL[g.kind]}</span></span>
                <span className="mr-meta">{g.game.home ? 'vs' : '@'} {g.game.opp} · <span className={g.game.result.startsWith('W') ? 'mr-ww-win' : 'mr-ww-loss'}>{g.game.result.split(' ')[0]}</span></span>
              </span>
              {g.cells.map((v, i) => <span key={i} className="mr-ww-lg-c mr-num">{v}</span>)}
            </div>
          ))}
          {([['with', r.withVals], ['without', r.withoutVals]] as const).map(([k, vals]) => (
            <div key={k} className="mr-ww-lg avg" style={grid}>
              <span className="mr-ww-lg-first"><span className={`mr-ww-tok ${k}`}>Avg {k === 'with' ? 'with' : 'w/o'}</span></span>
              {s.columns.map(c => <b key={c} className="mr-ww-lg-c mr-num">{formatStat(c, vals[c])}</b>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ s, r }: { s: WithWithoutState; r: TeammateRow }) {
  const id = r.player.player_id
  const open = s.isOpen(id)
  const logOpen = s.isLogOpen(id)
  const mine = s.myTeamId != null && r.player.owner?.team_id === s.myTeamId
  const cats = s.columns.filter(c => c !== 'MIN')
  const zCell = (key: string, text: string, value: React.ReactNode) => (
    <div className={`mr-ww-zc${s.sort === key ? ' on' : ''}`}>
      <span className="mr-ww-zl">{text}{s.sort === key ? ' ▾' : ''}</span>
      {value}
    </div>
  )
  return (
    <li className={`mr-ww-row${mine ? ' mine' : ''}${open ? ' open' : ''}`}>
      <div className="mr-ww-name">
        <span className="mr-ww-title">
          <b>{r.player.name}</b>
          {mine && <span className="mr-ww-tok with">Your team</span>}
          {!r.player.owner && <span className="mr-ww-fa">FA</span>}
          {r.small && <span className="mr-ww-small">Small sample</span>}
        </span>
        <span className="mr-meta">{r.player.pos} · {r.player.owner ? r.player.owner.name : 'Free agent'} · {r.withGroup.games} with / {r.withoutGroup.games} without</span>
      </div>

      <div className="mr-ww-zbar">
        {zCell('zw', 'Z with', <span className="mr-num mr-ww-zv">{zText(r.zWith)}</span>)}
        {zCell('zwo', 'Z without', <span className="mr-num mr-ww-zv strong">{zText(r.zWithout)}</span>)}
        {zCell('zd', 'Change', <ZPill z={r.zDelta} />)}
      </div>

      <div className="mr-ww-min">
        <span className="mr-meta">MIN</span>
        <span className="mr-num">{formatStat('MIN', r.withVals.MIN)} → {formatStat('MIN', r.withoutVals.MIN)}</span>
        <DeltaText cat="MIN" d={r.deltas.MIN} reverse={s.reverse} />
      </div>

      {!open && (
        <div className="mr-ww-tiles">
          {cats.map(c => (
            <span key={c} className={`mr-ww-tile${s.sort === c ? ' on' : ''}`}><span className="mr-meta">{c}</span><DeltaText cat={c} d={r.deltas[c]} reverse={s.reverse} /></span>
          ))}
        </div>
      )}

      {open && (
        <div className="mr-ww-open">
          <span className="mr-meta">Per game. With = {r.withGroup.games} games he played next to them, without = {r.withoutGroup.games} games they sat.</span>
          <div className="mr-ww-detail">
            {[cats.slice(0, 4), cats.slice(4)].filter(b => b.length).map((block, bi) => (
              <div key={bi} className="mr-ww-dgrid" style={{ gridTemplateColumns: `52px repeat(${block.length}, minmax(0, 1fr))` }}>
                <span />
                {block.map(c => <b key={c} className="mr-ww-dh">{c}</b>)}
                <span><span className="mr-ww-tok with">With</span></span>
                {block.map(c => <span key={c} className="mr-num mr-ww-dv">{formatStat(c, r.withVals[c])}</span>)}
                <span><span className="mr-ww-tok without">W/o</span></span>
                {block.map(c => <span key={c} className="mr-num mr-ww-dv">{formatStat(c, r.withoutVals[c])}</span>)}
                <span className="mr-meta">Δ</span>
                {block.map(c => <span key={c} className="mr-ww-dv"><DeltaText cat={c} d={r.deltas[c]} reverse={s.reverse} /></span>)}
              </div>
            ))}
          </div>
          <div className="mr-ww-actions">
            <button type="button" className="mr-chip" aria-pressed={logOpen} onClick={() => s.toggleLog(id)}>Game log</button>
            <Link className="mr-chip" to={`/player/${id}`}>Profile</Link>
            <button type="button" className="mr-chip" onClick={() => s.openTrade(r.player)}>Trade Analyzer</button>
          </div>
          {logOpen && <GameLog s={s} r={r} />}
        </div>
      )}

      <button type="button" className="mr-ww-more" aria-expanded={open} onClick={() => s.toggleRow(id)}>
        {open ? 'Hide full line' : 'Full line, game log & more'}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
      </button>
    </li>
  )
}

/** With / Without on a phone: the same state as the desktop page, a setup
 * card, a one-line game summary, sort chips and one card per teammate. */
export default function MobileWithWithout({ s }: { s: WithWithoutState }) {
  const season = s.season
  const mine = s.nbaTeams.filter(t => t.mine > 0)
  const out = s.nbaTeams.filter(t => t.mine === 0 && t.has_out_today)
  const rest = s.nbaTeams.filter(t => t.mine === 0 && !t.has_out_today)
  const opt = (t: (typeof s.nbaTeams)[number]) => (
    <option key={t.team_id} value={t.team_id}>{t.name}{t.mine ? ` · ${t.mine} of yours` : ''}{t.has_out_today ? ' · out today' : ''}</option>
  )
  const sorts = [...Z_SORTS.map(z => ({ key: z.key, label: z.label })), ...s.columns.map(c => ({ key: c, label: `${c} Δ` }))]

  return (
    <div className="mr-root mr-nba mr-ww" data-testid="mobile-with-without">
      <div className="mr-nba-head">
        <h1 className="mr-h1">With / Without</h1>
        <span className="mr-meta">How teammates play when someone sits.</span>
      </div>
      {s.error && <ErrorMessage message={s.error} />}

      {s.teamsLoading ? <LoadingSpinner /> : (
        <section className="mr-card mr-ww-setup">
          <label htmlFor="mww-team" className="mr-ww-lbl">Team</label>
          <select id="mww-team" className="mr-ww-select" value={s.teamId ?? ''} onChange={e => s.pickTeam(e.target.value ? Number(e.target.value) : null)}>
            <option value="" disabled hidden>Pick an NBA team…</option>
            {mine.length > 0 && <optgroup label="Your players’ teams">{mine.map(opt)}</optgroup>}
            {out.length > 0 && <optgroup label="A player out today">{out.map(opt)}</optgroup>}
            <optgroup label={mine.length || out.length ? 'Other teams' : 'All teams'}>{rest.map(opt)}</optgroup>
          </select>

          {season && s.picked.length > 0 && (
            <>
              <span className="mr-ww-lbl">Sitting out · up to 3</span>
              <div className="mr-chips mr-wrap">
                {s.picked.map(p => (
                  <span key={p.player_id} className="mr-chip mr-ww-picked">
                    {p.name}
                    {p.out_today && <span className="mr-ww-out">OUT</span>}
                    <button type="button" className="mr-ww-x" aria-label={`Remove ${p.name}`} onClick={() => s.removePick(p.player_id)}>×</button>
                  </span>
                ))}
                {s.canAdd && (
                  <button type="button" className="mr-chip mr-ww-add" aria-expanded={s.pickerOpen} onClick={() => s.setPickerOpen(!s.pickerOpen)}>{s.pickerOpen ? 'Close' : '+ Add player'}</button>
                )}
              </div>
              {s.pickerOpen && <Picker s={s} />}
            </>
          )}

          {s.picked.length > 1 && (
            <>
              <span className="mr-ww-lbl">A game counts as “without” when</span>
              <Segmented
                label="Which games count as without"
                value={s.mode}
                onChange={s.setMode}
                options={[{ value: 'all', label: s.picked.length > 2 ? 'All sat' : 'Both sat' }, { value: 'any', label: s.picked.length > 2 ? 'Any sat' : 'Either sat' }]}
              />
            </>
          )}
        </section>
      )}

      {!s.teamsLoading && s.teamId == null && (
        <div className="mr-card mr-nba-empty">Pick an NBA team to start. Teams with your players come first.</div>
      )}

      {s.loading && <LoadingSpinner />}

      {season && s.picked.length === 0 && (
        <section className="mr-card mr-ww-who">
          <b>Who’s sitting out?</b>
          <span className="mr-meta">{s.pickOptions.length ? `Pick up to 3 ${season.abbr} players. These missed games, most first:` : 'Nobody on this team has missed a game yet.'}</span>
          <Picker s={s} />
        </section>
      )}

      {season && s.split && (
        <>
          <section className="mr-card mr-ww-sum">
            <div className="mr-ww-sum-top">
              <b><span className="mr-ww-tok without">{s.split.counts.without} without</span> vs <span className="mr-ww-tok with">{s.split.counts.with} with</span></b>
              <span className="mr-meta">{s.split.counts.unused ? `${s.split.counts.unused} not used` : 'every game used'}</span>
            </div>
            <div className="mr-ww-sq" aria-hidden="true">
              {s.split.kinds.map((k, i) => <span key={i} className={k} />)}
            </div>
            <button type="button" className="mr-ww-link" aria-expanded={s.showGames} onClick={() => s.setShowGames(!s.showGames)}>{s.showGames ? 'Hide the games ▴' : 'See the games ›'}</button>
            {s.showGames && (
              <ul className="mr-ww-games">
                {season.games.map((g, i) => {
                  const k = s.split!.kinds[i]
                  const sat = s.picked.filter(p => p.lines[i] === 0).map(p => p.name.split(' ').slice(1).join(' ') || p.name)
                  return (
                    <li key={g.game_id}>
                      <span className="mr-num mr-ww-gd">{shortDate(g.date)}</span>
                      <span className="mr-ww-go">{g.home ? 'vs' : '@'} {g.opp}</span>
                      <span className={g.result.startsWith('W') ? 'mr-ww-win' : 'mr-ww-loss'}>{g.result.split(' ')[0]}</span>
                      <span className="mr-meta mr-ww-gw">{sat.length ? `${sat.join(', ')} out` : 'all played'}</span>
                      <span className={`mr-ww-tok ${k}`}>{KIND_LABEL[k]}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="mr-ww-controls">
            <span className="mr-ww-lbl">Sort by · highest first</span>
            <div className="mr-chips">
              {sorts.map(o => (
                <button key={o.key} type="button" className="mr-chip" aria-pressed={s.sort === o.key} onClick={() => s.setSort(o.key)}>{o.label}{s.sort === o.key ? ' ▾' : ''}</button>
              ))}
            </div>
            <div className="mr-chips mr-wrap">
              <button type="button" className="mr-chip mr-ww-tog" aria-pressed={s.faOnly} onClick={() => s.setFaOnly(!s.faOnly)}>{s.faOnly ? '✓ ' : ''}Free agents</button>
              {s.myTeamId != null && <button type="button" className="mr-chip mr-ww-tog" aria-pressed={s.mineOnly} onClick={() => s.setMineOnly(!s.mineOnly)}>{s.mineOnly ? '✓ ' : ''}My team</button>}
              <button type="button" className="mr-chip mr-ww-tog" aria-pressed={s.minGames} onClick={() => s.setMinGames(!s.minGames)}>{s.minGames ? '✓ ' : ''}{s.smallSample}+ games without</button>
            </div>
            {!s.zReady && <span className="mr-meta">Loading Player Rankings for Z…</span>}
          </section>

          {s.rows.length === 0 ? (
            <div className="mr-card mr-nba-empty">
              {s.split.counts.without === 0 ? `No games where ${s.split.names} sat.${s.picked.length > 1 ? ' Try “Either sat” or remove a player.' : ''}` : 'No teammates match these filters.'}
            </div>
          ) : (
            <ul className="mr-ww-list">{s.rows.map(r => <Row key={r.player.player_id} s={s} r={r} />)}</ul>
          )}

          <span className="mr-meta mr-ww-foot">
            {s.hiddenSmall > 0 && (
              <>{s.hiddenSmall} player{s.hiddenSmall > 1 ? 's' : ''} hidden: fewer than {s.smallSample} games without. <button type="button" className="mr-ww-link" onClick={() => s.setMinGames(false)}>Show them</button><br /></>
            )}
            Z is the Player Rankings score of each line. FG% and FT% are makes over attempts.
          </span>
        </>
      )}
    </div>
  )
}
