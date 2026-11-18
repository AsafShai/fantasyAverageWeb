import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { WithWithoutShareButton } from '../../components/share/WithWithoutShareCard'
import { withoutModeLabel } from '../../components/share/withWithoutMessage'
import { Segmented } from '../ui'
import { formatDelta, formatStat, formatZ, gameLogLabel, type GameKind, type TeammateRow } from '../../utils/withWithout'
import { Z_SORTS, type TeamOption, type WithWithoutState } from '../../pages/withWithout/useWithWithout'
import type { WithWithoutEntry, WithWithoutTeamSeason } from '../../types/withWithout'
import './nba.css'
import './withWithout.css'

const KIND_LABEL: Record<GameKind, string> = { with: 'With', without: 'W/o', unused: 'Not used' }
const zText = (z: number | null) => (z === null ? '—' : `${z < -0.004 ? '−' : ''}${Math.abs(z).toFixed(2)}`)
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const playedMark = (entry: WithWithoutEntry) => (entry === null ? 'Not on the team' : entry === 0 ? 'Sat' : 'Played')

/** One short word for the row. The full names open in a small note. */
function attendanceShort(lines: WithWithoutEntry[]): string {
  const sat = lines.filter(e => e === 0).length
  const played = lines.filter(e => Array.isArray(e)).length
  const off = lines.filter(e => e === null).length
  const n = lines.length
  if (sat === n) return n === 1 ? 'Sat' : 'All sat'
  if (played === n) return n === 1 ? 'Played' : 'All played'
  if (off === n) return 'Off team'
  if (sat > 0) return `${sat} sat`
  return `${off} off`
}

function DeltaText({ cat, d, reverse }: { cat: string; d: number; reverse: Set<string> }) {
  const { text, dir } = formatDelta(cat, d)
  const good = reverse.has(cat) ? dir === 'down' : dir === 'up'
  return <span className={`mr-ww-d ${dir === 'flat' ? 'flat' : good ? 'up' : 'dn'}`}>{text}</span>
}

function ZPill({ z }: { z: number | null }) {
  const cls = z === null || Math.abs(z) < 0.01 ? 'flat' : z > 0 ? 'up' : 'dn'
  return <span className={`mr-ww-z ${cls}`}>{formatZ(z)}</span>
}

function teamGroups(teams: TeamOption[]) {
  return {
    mine: teams.filter(t => t.mine > 0),
    out: teams.filter(t => t.mine === 0 && t.has_out_today),
    rest: teams.filter(t => t.mine === 0 && !t.has_out_today),
  }
}

function matchesTeam(team: TeamOption, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return team.abbr.toLowerCase().includes(q) || team.name.toLowerCase().includes(q)
}

function TeamMenu({ s }: { s: WithWithoutState }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { mine, out, rest } = teamGroups(s.nbaTeams)
  const groups = [
    { key: 'mine', label: 'Your players’ teams', teams: mine.filter(t => matchesTeam(t, query)) },
    { key: 'out', label: 'A player out today', teams: out.filter(t => matchesTeam(t, query)) },
    { key: 'rest', label: mine.length || out.length ? 'Other teams' : 'All teams', teams: rest.filter(t => matchesTeam(t, query)) },
  ].filter(g => g.teams.length > 0)

  return (
    <>
      <span id="mww-team-label" className="mr-ww-lbl">Team</span>
      <button id="mww-team" type="button" className="mr-ww-select" aria-labelledby="mww-team-label mww-team-value" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span id="mww-team-value">{s.team ? `${s.team.abbr} · ${s.team.name}` : 'Pick an NBA team…'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="mr-ww-menu">
          <input aria-label="Search NBA teams" placeholder="Pacers, IND…" value={query} onChange={e => setQuery(e.target.value)} className="mr-ww-search" />
          <div role="listbox" aria-label="NBA teams" className="mr-ww-teams">
            {groups.length === 0 && <p className="mr-meta">No teams match</p>}
            {groups.map(group => (
              <div key={group.key}>
                <p className="mr-ww-lbl">{group.label}</p>
                {group.teams.map(team => (
                  <button
                    key={team.team_id}
                    type="button"
                    role="option"
                    aria-selected={team.team_id === s.teamId}
                    className="mr-opt"
                    onClick={() => { s.pickTeam(team.team_id); setOpen(false); setQuery('') }}
                  >
                    <b>{team.abbr}</b> {team.name}
                    {team.mine > 0 ? ` · ${team.mine} of yours` : ''}
                    {team.has_out_today ? ' · out today' : ''}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function absenceNote(note: string | undefined): string | null {
  const text = note?.trim()
  if (!text || /two-way|g league/i.test(text)) return null
  return text
}

function PickRow({ o, onPick }: { o: WithWithoutState['pickOptions'][number]; onPick: () => void }) {
  const note = absenceNote(o.player.out_today?.note)
  return (
    <button type="button" className={`mr-ww-opt${o.player.out_today ? ' out' : ''}`} onClick={onPick}>
      <span className="mr-ww-opt-name">{o.player.name}</span>
      <span className="mr-meta">{o.player.pos}</span>
      {o.player.out_today && <span className="mr-ww-out">OUT</span>}
      {o.player.two_way && <span className="mr-ww-tag">Two-way</span>}
      {note && <span className="mr-ww-note">{note}</span>}
      <span className="mr-ww-miss">missed {o.missed}</span>
    </button>
  )
}

function Picker({ s }: { s: WithWithoutState }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const options = s.pickOptions.filter(o => !q || o.player.name.toLowerCase().includes(q))
  const out = options.filter(o => o.player.out_today)
  const earlier = options.filter(o => !o.player.out_today)
  return (
    <div className="mr-ww-picker">
      <input aria-label="Search players who missed games" placeholder="Search a name…" value={query} onChange={e => setQuery(e.target.value)} className="mr-ww-search" />
      {options.length === 0 ? (
        <span className="mr-meta">{s.pickOptions.length ? 'No players match' : 'Nobody has missed a game yet.'}</span>
      ) : (
        <div className="mr-ww-groups">
          {out.length > 0 && (
            <div className="mr-ww-picks">
              <span className="mr-ww-lbl">Out today · {out.length}</span>
              {out.map(o => <PickRow key={o.player.player_id} o={o} onPick={() => s.addPick(o.player.player_id)} />)}
            </div>
          )}
          {earlier.length > 0 && (
            <div className="mr-ww-picks">
              <span className="mr-ww-lbl">Sat earlier · {earlier.length}</span>
              {earlier.map(o => <PickRow key={o.player.player_id} o={o} onPick={() => s.addPick(o.player.player_id)} />)}
            </div>
          )}
        </div>
      )}
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
                <Link
                  to={`/box-scores?date=${g.game.date}&game=${g.game.game_id}`}
                  state={{ from: '/with-without' }}
                  className="mr-ww-box"
                  aria-label={`Box score for ${shortDate(g.game.date)} ${g.game.home ? 'vs' : '@'} ${g.game.opp}`}
                >
                  Box score
                </Link>
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

function cellNode(s: WithWithoutState, r: TeammateRow, cat: string) {
  if (s.cellMode === 'delta') return <DeltaText cat={cat} d={r.deltas[cat]} reverse={s.reverse} />
  const vals = s.cellMode === 'with' ? r.withVals : r.withoutVals
  return <span className="mr-num mr-ww-dv">{formatStat(cat, vals[cat])}</span>
}

function OpenPanel({ s, r }: { s: WithWithoutState; r: TeammateRow }) {
  const id = r.player.player_id
  const logOpen = s.isLogOpen(id)
  return (
    <div className="mr-ww-open">
      <span className="mr-meta">Per game. With = {r.withGroup.games} games he played next to them, without = {r.withoutGroup.games} games they sat.</span>
      <div className="mr-ww-detail">
        {[s.columns.filter(c => c !== 'MIN').slice(0, 4), s.columns.filter(c => c !== 'MIN').slice(4)].filter(b => b.length).map((block, bi) => (
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
      <div className="mr-ww-min">
        <span className="mr-meta">MIN</span>
        <span className="mr-num">{formatStat('MIN', r.withVals.MIN)} → {formatStat('MIN', r.withoutVals.MIN)}</span>
        <DeltaText cat="MIN" d={r.deltas.MIN} reverse={s.reverse} />
      </div>
      <div className="mr-ww-actions">
        <button type="button" className="mr-chip" aria-pressed={logOpen} onClick={() => s.toggleLog(id)}>Game log</button>
        <Link className="mr-chip" to={`/player/${id}`}>Profile</Link>
        <button type="button" className="mr-chip" onClick={() => s.openTrade(r.player)}>Trade Analyzer</button>
      </div>
      {logOpen && <GameLog s={s} r={r} />}
    </div>
  )
}

function Row({ s, r }: { s: WithWithoutState; r: TeammateRow }) {
  const id = r.player.player_id
  const open = s.isOpen(id)
  const mine = s.myTeamId != null && r.player.owner?.team_id === s.myTeamId
  const zCell = (key: string, text: string, value: React.ReactNode, lead = false) => (
    <div className={`mr-ww-zc${lead ? ' lead' : ''}${s.sort === key ? ' on' : ''}`}>
      <span className="mr-ww-zl">{text}{s.sort === key ? ' ▾' : ''}</span>
      {value}
    </div>
  )
  return (
    <li className={`mr-ww-row${mine ? ' mine' : ''}${open ? ' open' : ''}`}>
      <div className="mr-ww-top">
        <div className="mr-ww-name">
          <span className="mr-ww-title">
            <b>{r.player.name}</b>
            {mine && <span className="mr-ww-tok with">You</span>}
            {!r.player.owner && <span className="mr-ww-fa">FA</span>}
            {r.small && <span className="mr-ww-small">Small sample</span>}
          </span>
          <span className="mr-meta">{r.player.pos} · {r.player.owner ? r.player.owner.name : 'Free agent'}</span>
        </div>
        <div className="mr-ww-gp">
          <span className="mr-ww-lbl">With / without</span>
          <b className="mr-num">{r.withGroup.games} / {r.withoutGroup.games}</b>
        </div>
      </div>

      <div className="mr-ww-zbar">
        {zCell('zw', 'Z with', <span className="mr-num mr-ww-zv">{zText(r.zWith)}</span>)}
        {zCell('zwo', 'Z without', <span className="mr-num mr-ww-zv">{zText(r.zWithout)}</span>)}
        {zCell('zd', 'Z change', <ZPill z={r.zDelta} />, true)}
      </div>

      {!open && (
        <div className="mr-ww-tiles">
          {s.columns.map(c => (
            <span key={c} className={`mr-ww-tile${s.sort === c ? ' on' : ''}`}><span className="mr-meta">{c}</span>{cellNode(s, r, c)}</span>
          ))}
        </div>
      )}

      {open && <OpenPanel s={s} r={r} />}

      <div className="mr-ww-end">
        {s.split && s.season && (
          <WithWithoutShareButton
            row={r}
            columns={s.columns}
            reverse={s.reverse}
            names={s.split.names}
            modeLabel={withoutModeLabel(s.picked.length, s.mode)}
            teamAbbr={s.season.abbr}
          />
        )}
        <button type="button" className="mr-ww-more" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${r.player.name}`} onClick={() => s.toggleRow(id)}>
          {open ? 'Hide' : 'Details'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
        </button>
      </div>
    </li>
  )
}

function Th({ s, k, children }: { s: WithWithoutState; k: string; children: React.ReactNode }) {
  const on = s.sort === k
  const asc = k === 'name'
  return (
    <th aria-sort={on ? (asc ? 'ascending' : 'descending') : 'none'} className={on ? 'on' : ''}>
      <button type="button" onClick={() => s.setSort(k)}>{children}{on ? (asc ? ' ▲' : ' ▼') : ''}</button>
    </th>
  )
}

function PhoneTable({ s }: { s: WithWithoutState }) {
  const span = 7 + s.columns.length
  return (
    <div className="mr-ww-tscroll">
      <table className="mr-ww-table">
        <thead>
          <tr>
            <Th s={s} k="name">Player</Th>
            <Th s={s} k="gpw">GP with</Th>
            <Th s={s} k="gpwo">GP w/o</Th>
            {Z_SORTS.map(z => <Th key={z.key} s={s} k={z.key}>{z.label}</Th>)}
            {s.columns.map(c => <Th key={c} s={s} k={c}>{c}</Th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {s.rows.map(r => {
            const id = r.player.player_id
            const open = s.isOpen(id)
            const mine = s.myTeamId != null && r.player.owner?.team_id === s.myTeamId
            return (
              <Fragment key={id}>
                <tr className={mine ? 'mine' : ''}>
                  <td>
                    <b>{r.player.name}</b>
                    <span className="mr-meta"> {r.player.pos}</span>
                    {mine && <span className="mr-ww-tok with">You</span>}
                    {!r.player.owner && <span className="mr-ww-fa">FA</span>}
                    {r.small && <span className="mr-ww-small">Small sample</span>}
                    <div className="mr-meta">{r.player.owner ? r.player.owner.name : 'Free agent'}</div>
                  </td>
                  <td className={`mr-num${s.sort === 'gpw' ? ' on' : ''}`}>{r.withGroup.games}</td>
                  <td className={`mr-num${s.sort === 'gpwo' ? ' on' : ''}`}>{r.withoutGroup.games}</td>
                  <td className={`mr-num${s.sort === 'zw' ? ' on' : ''}`}>{zText(r.zWith)}</td>
                  <td className={`mr-num${s.sort === 'zwo' ? ' on' : ''}`}>{zText(r.zWithout)}</td>
                  <td className={s.sort === 'zd' ? 'on' : ''}><ZPill z={r.zDelta} /></td>
                  {s.columns.map(c => <td key={c} className={s.sort === c ? 'on' : ''}>{cellNode(s, r, c)}</td>)}
                  <td>
                    <div className="mr-ww-end">
                      {s.split && s.season && (
                        <WithWithoutShareButton
                          sheet
                          row={r}
                          columns={s.columns}
                          reverse={s.reverse}
                          names={s.split.names}
                          modeLabel={withoutModeLabel(s.picked.length, s.mode)}
                          teamAbbr={s.season.abbr}
                        />
                      )}
                      <button type="button" className="mr-ww-link" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${r.player.name}`} onClick={() => s.toggleRow(id)}>
                        {open ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td className="mr-ww-detailcell" colSpan={span}><div className="mr-ww-detailwrap"><OpenPanel s={s} r={r} /></div></td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function GameWho({ s, index, anchor, onClose }: {
  s: WithWithoutState
  index: number
  anchor: { top: number; bottom: number; right: number }
  onClose: () => void
}) {
  const g = s.season!.games[index]
  const title = `${shortDate(g.date)} ${g.home ? 'vs' : '@'} ${g.opp}`
  const width = 216
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
  const below = anchor.bottom + 6
  const placeAbove = window.innerHeight - below < 140
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const close = () => onClose()
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [onClose])
  return createPortal(
    <>
      <div className="mr-ww-pop-layer" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="mr-root mr-ww-pop"
        style={placeAbove
          ? { left, bottom: window.innerHeight - anchor.top + 6 }
          : { left, top: below }}
      >
        <span className="mr-meta">{title}</span>
        {s.picked.map(p => {
          const mark = playedMark(p.lines[index])
          return (
            <div key={p.player_id} className="mr-ww-pop-row">
              <span>{p.name}</span>
              <b className={mark === 'Sat' ? 'mr-ww-sat' : mark === 'Played' ? '' : 'mr-ww-off'}>{mark}</b>
            </div>
          )
        })}
      </div>
    </>,
    document.body,
  )
}

function PhoneGames({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const [open, setOpen] = useState<{ index: number; top: number; bottom: number; right: number } | null>(null)
  return (
    <>
      <ul className="mr-ww-games">
        {season.games.map((g, i) => {
          const k = s.split!.kinds[i]
          const detail = s.picked.map(p => `${p.name} ${playedMark(p.lines[i])}`).join(', ')
          return (
            <li key={g.game_id}>
              <span className="mr-num mr-ww-gd">{shortDate(g.date)}</span>
              <span className="mr-ww-go">{g.home ? 'vs' : '@'} {g.opp}</span>
              <span className={`mr-ww-score ${g.result.startsWith('W') ? 'mr-ww-win' : 'mr-ww-loss'}`}>{g.result}</span>
              <button
                type="button"
                className="mr-ww-who-btn"
                aria-expanded={open?.index === i}
                aria-label={`${shortDate(g.date)} ${g.home ? 'vs' : 'at'} ${g.opp}: ${detail}`}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setOpen(open?.index === i ? null : { index: i, top: r.top, bottom: r.bottom, right: r.right })
                }}
              >
                {attendanceShort(s.picked.map(p => p.lines[i]))}
              </button>
              <span className={`mr-ww-tok ${k}`}>{KIND_LABEL[k]}</span>
              <Link
                to={`/box-scores?date=${g.date}&game=${g.game_id}`}
                state={{ from: '/with-without' }}
                className="mr-ww-box"
                aria-label={`Box score for ${shortDate(g.date)} ${g.home ? 'vs' : '@'} ${g.opp}`}
              >
                Box score
              </Link>
            </li>
          )
        })}
      </ul>
      {open && <GameWho s={s} index={open.index} anchor={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/** With / Without on a phone: the same state as the desktop page. */
export default function MobileWithWithout({ s }: { s: WithWithoutState }) {
  const season = s.season
  const sorts = [...Z_SORTS.map(z => ({ key: z.key, label: z.label })), ...s.columns.map(c => ({ key: c, label: c }))]

  return (
    <div className="mr-root mr-nba mr-ww" data-testid="mobile-with-without">
      <div className="mr-nba-head">
        <h1 className="mr-h1">With / Without</h1>
        <span className="mr-meta">How teammates play when someone sits.</span>
      </div>
      {s.error && <ErrorMessage message={s.error} />}

      {s.teamsLoading ? <LoadingSpinner /> : (
        <section className="mr-card mr-ww-setup">
          <TeamMenu s={s} />

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

          {s.autoNote && <span className="mr-meta">{s.autoNote}</span>}

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
          <div className="mr-ww-who-top">
            <h2>Who’s sitting out?</h2>
            <span className="mr-ww-lbl">0 of 3</span>
          </div>
          <span className="mr-meta">
            {s.pickOptions.some(o => o.player.out_today)
              ? `Pick up to 3 ${season.abbr} players. Out today is listed with the reason.`
              : s.pickOptions.length
                ? `Nobody on ${season.abbr} is out today. Pick someone who sat earlier.`
                : `Nobody on ${season.abbr} has missed a game yet.`}
          </span>
          <Picker s={s} />
        </section>
      )}

      {season && s.split && (
        <>
          <section className="mr-card mr-ww-sum">
            <div className="mr-ww-sum-top">
              <b><span className="mr-ww-tok without">{s.split.counts.without} without</span> vs <span className="mr-ww-tok with">{s.split.counts.with} with</span></b>
              <span className="mr-meta">{s.split.names} · {s.split.counts.unused ? `${s.split.counts.unused} not used` : 'every game used'}</span>
            </div>
            <button type="button" className="mr-ww-link" aria-expanded={s.showGames} onClick={() => s.setShowGames(!s.showGames)}>{s.showGames ? 'Hide the games ▴' : 'See the games ›'}</button>
            {s.showGames && <PhoneGames s={s} season={season} />}
          </section>

          <section className="mr-ww-controls">
            <span className="mr-ww-lbl">Layout</span>
            <Segmented
              label="Layout"
              size="sm"
              value={s.layout}
              onChange={s.setLayout}
              options={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }]}
            />
            <span className="mr-ww-lbl">Stat cells</span>
            <Segmented
              label="Stat cells"
              size="sm"
              value={s.cellMode}
              onChange={s.setCellMode}
              options={[{ value: 'delta', label: 'Change' }, { value: 'with', label: 'With' }, { value: 'without', label: 'Without' }]}
            />
            {s.layout === 'cards' && (
              <>
                <span className="mr-ww-lbl">Sort · highest first</span>
                <div className="mr-chips" role="group" aria-label="Sort">
                  {sorts.map(o => (
                    <button key={o.key} type="button" className="mr-chip" aria-pressed={s.sort === o.key} onClick={() => s.setSort(o.key)}>{o.label}{s.sort === o.key ? ' ▾' : ''}</button>
                  ))}
                </div>
              </>
            )}
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
          ) : s.layout === 'table' ? (
            <PhoneTable s={s} />
          ) : (
            <ul className="mr-ww-list">{s.rows.map(r => <Row key={r.player.player_id} s={s} r={r} />)}</ul>
          )}

          <span className="mr-meta mr-ww-foot">
            {s.hiddenSmall > 0 && (
              <>{s.hiddenSmall} player{s.hiddenSmall > 1 ? 's' : ''} hidden: fewer than {s.smallSample} games without. <button type="button" className="mr-ww-link" onClick={() => s.setMinGames(false)}>Show them</button><br /></>
            )}
            Z is the Player Rankings score of each line. FG% and FT% are makes over attempts. This compares games; it doesn’t prove one player caused the change.
          </span>
        </>
      )}
    </div>
  )
}
