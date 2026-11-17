import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { useMobileRedesign } from '../mobile/flag'
import MobileWithWithout from '../mobile/nba/MobileWithWithout'
import type { WithWithoutEntry, WithWithoutTeamSeason } from '../types/withWithout'
import {
  formatDelta, formatStat, formatZ, gameLogLabel, type GameKind, type TeammateRow,
} from '../utils/withWithout'
import { Z_SORTS, useWithWithout, type TeamOption, type WithWithoutState } from './withWithout/useWithWithout'

const card = 'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700'
const label = 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'
const chip = 'inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium'
const chipOff = 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
const chipOn = 'border-blue-600 bg-blue-600 text-white'
const chipToggled = 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'

const KIND_TOK: Record<GameKind, string> = {
  with: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  without: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  unused: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}
const KIND_LABEL: Record<GameKind, string> = { with: 'With', without: 'Without', unused: 'Not used' }

function shortDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function lastName(name: string): string {
  const parts = name.split(' ')
  return parts.length > 1 ? parts.slice(1).join(' ') : name
}

function playedMark(entry: WithWithoutEntry): string {
  if (entry === null) return '—'
  return entry === 0 ? 'Sat' : 'Played'
}

function Tok({ kind, children }: { kind: GameKind; children: React.ReactNode }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${KIND_TOK[kind]}`}>{children}</span>
}

function Seg<T extends string>({ value, options, onChange, ariaLabel, tall = false }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; ariaLabel: string; tall?: boolean
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`${tall ? 'min-h-[44px]' : 'min-h-[34px]'} px-3 text-sm whitespace-nowrap ${value === k ? 'bg-blue-600 font-semibold text-white' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`${chip} ${on ? chipToggled : chipOff}`}>
      {on && <span aria-hidden="true">✓</span>}{children}
    </button>
  )
}

function DeltaText({ cat, d, reverse }: { cat: string; d: number; reverse: Set<string> }) {
  const { text, dir } = formatDelta(cat, d)
  const good = reverse.has(cat) ? dir === 'down' : dir === 'up'
  const cls = dir === 'flat' ? 'text-gray-400 dark:text-gray-500' : good ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  return <span className={`font-semibold tabular-nums ${cls}`}>{text}</span>
}

function ZPill({ z }: { z: number | null }) {
  const cls = z === null || Math.abs(z) < 0.01
    ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
    : z > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-sm font-bold tabular-nums ${cls}`}>{formatZ(z)}</span>
}

const zText = (z: number | null) => (z === null ? '—' : `${z < -0.004 ? '−' : ''}${Math.abs(z).toFixed(2)}`)

function OutBadge() {
  return <span className="rounded bg-red-600 px-1.5 text-[10px] font-bold text-white">OUT</span>
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
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const { mine, out, rest } = teamGroups(s.nbaTeams)
  const groups = [
    { key: 'mine', label: 'Your players’ teams', teams: mine.filter(t => matchesTeam(t, query)) },
    { key: 'out', label: 'A player out today', teams: out.filter(t => matchesTeam(t, query)) },
    { key: 'rest', label: mine.length || out.length ? 'Other teams' : 'All teams', teams: rest.filter(t => matchesTeam(t, query)) },
  ].filter(g => g.teams.length > 0)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const summary = s.team ? `${s.team.abbr} · ${s.team.name}` : 'Pick an NBA team…'

  return (
    <div ref={rootRef} className="relative flex w-56 shrink-0 flex-col gap-2">
      <span id="ww-team-label" className={label}>Team</span>
      <button
        id="ww-team"
        type="button"
        aria-labelledby="ww-team-label ww-team-value"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(v => !v)}
        className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 text-left text-sm font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      >
        <span id="ww-team-value" className="truncate">{summary}</span>
        <span aria-hidden="true" className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute top-full z-20 mt-1 w-96 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <input
            autoFocus
            aria-label="Search NBA teams"
            placeholder="Pacers, IND…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full border-b border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:border-gray-700 dark:text-white"
          />
          <div id={listId} role="listbox" aria-label="NBA teams" className="max-h-72 overflow-y-auto p-1">
            {groups.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No teams match</p>}
            {groups.map(group => (
              <div key={group.key} className="pb-1">
                <p className="px-2 pt-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{group.label}</p>
                {group.teams.map(team => {
                  const on = team.team_id === s.teamId
                  return (
                    <button
                      key={team.team_id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => { s.pickTeam(team.team_id); setOpen(false); setQuery('') }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${on ? 'bg-blue-600 text-white' : 'text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-700'}`}
                    >
                      <span className="w-10 shrink-0 font-semibold">{team.abbr}</span>
                      <span className="min-w-0 flex-1 truncate">{team.name}</span>
                      {team.mine > 0 && <span className={`shrink-0 text-xs ${on ? 'text-white/80' : 'text-gray-500'}`}>{team.mine} of yours</span>}
                      {team.has_out_today && <span className={`shrink-0 text-xs ${on ? 'text-white/80' : 'text-red-600 dark:text-red-400'}`}>out today</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Injury text worth showing. G-league two-way notes repeat the Two-way tag. */
function absenceNote(note: string | undefined): string | null {
  const text = note?.trim()
  if (!text || /two-way|g league/i.test(text)) return null
  return text
}

function PickRow({ o, onPick }: { o: WithWithoutState['pickOptions'][number]; onPick: () => void }) {
  const out = !!o.player.out_today
  const note = absenceNote(o.player.out_today?.note)
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex h-8 w-full items-center gap-2 rounded-md border bg-white px-2.5 text-left text-sm hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 ${out ? 'border-y-gray-200 border-r-gray-200 border-l-4 border-l-red-500 dark:border-y-gray-700 dark:border-r-gray-700' : 'border-gray-200 dark:border-gray-700'}`}
    >
      <span className="truncate font-semibold text-gray-900 dark:text-white">{o.player.name}</span>
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{o.player.pos}</span>
      {out && <OutBadge />}
      {o.player.two_way && <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-600 dark:bg-gray-600 dark:text-gray-200">Two-way</span>}
      {note && <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">{note}</span>}
      {!note && <span className="flex-1" />}
      <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-500 dark:text-gray-400">missed {o.missed}</span>
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
    <div className="flex flex-col gap-2">
      <input
        aria-label="Search players who missed games"
        placeholder="Search a name…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        className="min-h-[36px] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      />
      {options.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{s.pickOptions.length ? 'No players match' : 'Nobody has missed a game yet.'}</p>
      ) : (
        <>
          {out.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={label}>Out today · {out.length}</span>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {out.map(o => <PickRow key={o.player.player_id} o={o} onPick={() => s.addPick(o.player.player_id)} />)}
              </div>
            </div>
          )}
          {earlier.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={label}>Sat earlier · {earlier.length}</span>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {earlier.map(o => <PickRow key={o.player.player_id} o={o} onPick={() => s.addPick(o.player.player_id)} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Setup({ s }: { s: WithWithoutState }) {
  return (
    <section className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <TeamMenu s={s} />

        {s.season && (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={label}>Sitting out · up to 3</span>
            <div className="flex flex-wrap items-center gap-2">
              {s.picked.map(p => (
                <span key={p.player_id} className={`${chip} !min-h-[44px] ${chipOn}`}>
                  {p.name}
                  {p.out_today && <OutBadge />}
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => s.removePick(p.player_id)} className="ml-0.5 text-base leading-none text-white/80 hover:text-white">×</button>
                </span>
              ))}
              {s.picked.length > 0 && s.canAdd && (
                <button type="button" aria-expanded={s.pickerOpen} onClick={() => s.setPickerOpen(!s.pickerOpen)} className={`${chip} !min-h-[44px] ${chipOff} border-dashed`}>
                  {s.pickerOpen ? 'Close' : '+ Add player'}
                </button>
              )}
              {s.picked.length === 0 && <span className="flex min-h-[44px] items-center text-sm text-gray-500 dark:text-gray-400">None yet</span>}
            </div>
          </div>
        )}

        {s.picked.length > 1 && (
          <div className="flex shrink-0 flex-col gap-2">
            <span className={label}>Without = when</span>
            <Seg tall ariaLabel="Which games count as without" value={s.mode} onChange={s.setMode} options={[['all', s.picked.length > 2 ? 'All sat' : 'Both sat'], ['any', s.picked.length > 2 ? 'Any sat' : 'Either sat']]} />
          </div>
        )}
      </div>

      {s.autoNote && <p className="text-sm text-gray-600 dark:text-gray-300">{s.autoNote}</p>}

      {s.season && s.picked.length > 0 && s.pickerOpen && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <Picker s={s} />
        </div>
      )}
    </section>
  )
}

function GameList({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const split = s.split!
  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {season.games.map((g, i) => {
          const kind = split.kinds[i]
          return (
            <li key={g.game_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="w-14 shrink-0 font-semibold tabular-nums text-gray-900 dark:text-white">{shortDay(g.date)}</span>
              <span className="w-16 shrink-0 text-gray-600 dark:text-gray-300">{g.home ? 'vs' : '@'} {g.opp}</span>
              <span className={`w-24 shrink-0 font-medium ${g.result.startsWith('W') ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{g.result}</span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-0.5 text-gray-600 dark:text-gray-300">
                {s.picked.map(p => (
                  <span key={p.player_id}>
                    <span className="text-gray-500 dark:text-gray-400">{lastName(p.name)}</span>{' '}
                    <span className={p.lines[i] === 0 ? 'font-semibold text-red-600 dark:text-red-400' : ''}>{playedMark(p.lines[i])}</span>
                  </span>
                ))}
              </span>
              <Tok kind={kind}>{KIND_LABEL[kind]}</Tok>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-gray-500 dark:text-gray-400">— means he wasn’t on the team for that game. “Not used” means only some of them sat, so the game is neither with nor without.</p>
    </div>
  )
}

function Summary({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const split = s.split!
  return (
    <section className={`${card} flex flex-col gap-3 px-5 py-4`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          <Tok kind="without">{split.counts.without} without</Tok>
          {' vs '}
          <Tok kind="with">{split.counts.with} with</Tok>
          <span className="font-normal text-gray-500 dark:text-gray-400"> · {split.names}</span>
          <span className="font-normal text-gray-500 dark:text-gray-400"> · {split.counts.unused ? `${split.counts.unused} not used` : 'every game used'}</span>
        </span>
        <button type="button" aria-expanded={s.showGames} onClick={() => s.setShowGames(!s.showGames)} className="ml-auto text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
          {s.showGames ? 'Hide the games ▴' : 'See the games ›'}
        </button>
      </div>
      {s.showGames && <GameList s={s} season={season} />}
    </section>
  )
}

function GameLogTable({ s, row }: { s: WithWithoutState; row: TeammateRow }) {
  const log = s.gameLog(row)
  const id = row.player.player_id
  const filter = s.logFilter(id)
  const grid = { gridTemplateColumns: `200px repeat(${s.columns.length}, minmax(52px, 1fr))` }
  const avg = (vals: Record<string, number>) => s.columns.map(c => formatStat(c, vals[c]))
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Which games" className="flex flex-wrap gap-2">
        {log.tabs.map(t => (
          <button key={t.key} type="button" aria-pressed={filter === t.key} onClick={() => s.setLogFilter(id, t.key)} className={`${chip} ${filter === t.key ? chipOn : chipOff}`}>
            {t.label} · {t.count}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="min-w-[720px] text-sm tabular-nums">
          <div className="grid items-center bg-gray-50 dark:bg-gray-900/40" style={grid}>
            <span className={`px-3 py-2 ${label}`}>Game</span>
            {s.columns.map(c => <span key={c} className={`py-2 pr-3 text-right ${label}`}>{gameLogLabel(c)}</span>)}
          </div>
          {log.games.map(g => (
            <div key={g.game.game_id} className={`grid items-center border-t border-gray-100 dark:border-gray-700 ${g.dnp || g.kind === 'unused' ? 'opacity-50' : ''}`} style={grid}>
              <span className="flex flex-col gap-0.5 px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <b className="text-gray-900 dark:text-white">{shortDay(g.game.date)}</b>
                  {g.dnp ? <span className="text-[11px] font-semibold text-gray-500">Didn’t play</span> : <Tok kind={g.kind}>{KIND_LABEL[g.kind]}</Tok>}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{g.game.home ? 'vs' : '@'} {g.game.opp} · <span className={g.game.result.startsWith('W') ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{g.game.result}</span></span>
              </span>
              {g.cells.map((v, i) => <span key={i} className="pr-3 text-right text-gray-800 dark:text-gray-100">{v}</span>)}
            </div>
          ))}
          {([['with', row.withVals], ['without', row.withoutVals]] as const).map(([k, vals]) => (
            <div key={k} className="grid items-center border-t border-gray-200 bg-gray-50 font-semibold dark:border-gray-700 dark:bg-gray-900/40" style={grid}>
              <span className="px-3 py-2"><Tok kind={k}>Avg {k === 'with' ? 'with' : 'w/o'}</Tok></span>
              {avg(vals).map((v, i) => <span key={i} className="pr-3 text-right text-gray-900 dark:text-white">{v}</span>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Expanded({ s, row }: { s: WithWithoutState; row: TeammateRow }) {
  const cols = s.columns
  const id = row.player.player_id
  const logOpen = s.isLogOpen(id)
  return (
    <div className="mt-3 flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <p className="text-xs text-gray-500 dark:text-gray-400">Per game. With = {row.withGroup.games} games he played next to them, without = {row.withoutGroup.games} games they sat.</p>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] gap-y-2 text-sm tabular-nums" style={{ gridTemplateColumns: `150px repeat(${cols.length}, minmax(0, 1fr)) 80px` }}>
          <span />
          {cols.map(c => <span key={c} className={`text-right ${label}`}>{c}</span>)}
          <span className={`text-right ${label}`}>Z</span>

          <span><Tok kind="with">With</Tok> <span className="text-xs text-gray-500">{row.withGroup.games} games</span></span>
          {cols.map(c => <span key={c} className="text-right text-gray-800 dark:text-gray-100">{formatStat(c, row.withVals[c])}</span>)}
          <span className="text-right text-gray-800 dark:text-gray-100">{zText(row.zWith)}</span>

          <span><Tok kind="without">Without</Tok> <span className="text-xs text-gray-500">{row.withoutGroup.games} games</span></span>
          {cols.map(c => <span key={c} className="text-right text-gray-800 dark:text-gray-100">{formatStat(c, row.withoutVals[c])}</span>)}
          <span className="text-right font-bold text-gray-900 dark:text-white">{zText(row.zWithout)}</span>

          <span className="font-semibold text-gray-600 dark:text-gray-300">Change</span>
          {cols.map(c => <span key={c} className="text-right"><DeltaText cat={c} d={row.deltas[c]} reverse={s.reverse} /></span>)}
          <span className="text-right"><ZPill z={row.zDelta} /></span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={logOpen} onClick={() => s.toggleLog(id)} className={`${chip} ${logOpen ? chipOn : chipOff}`}>Game-by-game log</button>
        <Link to={`/player/${id}`} className={`${chip} ${chipOff}`}>Player profile</Link>
        <button type="button" onClick={() => s.openTrade(row.player)} className={`${chip} ${chipOff}`}>Open in Trade Analyzer</button>
      </div>

      {logOpen && <GameLogTable s={s} row={row} />}
    </div>
  )
}

function cellNode(s: WithWithoutState, row: TeammateRow, cat: string) {
  if (s.cellMode === 'delta') return <DeltaText cat={cat} d={row.deltas[cat]} reverse={s.reverse} />
  const vals = s.cellMode === 'with' ? row.withVals : row.withoutVals
  return <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{formatStat(cat, vals[cat])}</span>
}

function SortStrip({ s }: { s: WithWithoutState }) {
  const sorts = [
    ...Z_SORTS.map(z => ({ key: z.key, label: z.label, tip: z.tip })),
    ...s.columns.map(c => ({ key: c, label: c, tip: `Sort by ${c}` })),
  ]
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort">
      {sorts.map(o => {
        const on = s.sort === o.key
        return (
          <button
            key={o.key}
            type="button"
            title={o.tip}
            aria-pressed={on}
            onClick={() => s.setSort(o.key)}
            className={`min-h-[32px] rounded-full border px-2.5 text-xs font-semibold ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'}`}
          >
            {o.label}{on ? ' ▾' : ''}
          </button>
        )
      })}
    </div>
  )
}

function Teammate({ s, row }: { s: WithWithoutState; row: TeammateRow }) {
  const id = row.player.player_id
  const open = s.isOpen(id)
  const mine = s.myTeamId != null && row.player.owner?.team_id === s.myTeamId
  const zCells = [
    { key: 'zw', label: 'Z with', value: <span className="text-sm tabular-nums text-gray-800 dark:text-gray-100">{zText(row.zWith)}</span> },
    { key: 'zwo', label: 'Z without', value: <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{zText(row.zWithout)}</span> },
    { key: 'zd', label: 'Z change', value: <ZPill z={row.zDelta} />, lead: true },
  ]
  return (
    <article className={`${card} p-4 ${mine ? 'ring-2 ring-blue-200 dark:ring-blue-800' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-gray-900 dark:text-white">{row.player.name}</span>
            <span className="text-xs text-gray-500">{row.player.pos}</span>
            {mine && <span className="rounded bg-blue-100 px-1.5 text-[11px] font-bold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">You</span>}
            {!row.player.owner && <span className="rounded bg-emerald-100 px-1.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">FA</span>}
            {row.small && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Small sample</span>}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{row.player.owner ? row.player.owner.name : 'Free agent'}</p>
        </div>
        <div className="text-right">
          <p className={label}>Games with / without</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{row.withGroup.games} / {row.withoutGroup.games}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        {zCells.map(cell => (
          <div key={cell.key} className={`px-3 py-2 ${cell.lead ? 'bg-gray-50 dark:bg-gray-900/50' : ''} ${s.sort === cell.key ? 'bg-blue-50 dark:bg-blue-900/30' : ''} ${cell.key !== 'zw' ? 'border-l border-gray-200 dark:border-gray-700' : ''}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${s.sort === cell.key ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>{cell.label}{s.sort === cell.key ? ' ▾' : ''}</p>
            <div className={`mt-1 ${cell.lead ? 'text-lg' : ''}`}>{cell.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {s.columns.map(c => (
          <span key={c} className={`inline-flex min-w-[64px] flex-col rounded-lg px-2 py-1 ${s.sort === c ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 dark:bg-gray-900/40'}`}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{c}</span>
            {cellNode(s, row, c)}
          </span>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} details for ${row.player.name}`}
          onClick={() => s.toggleRow(id)}
          className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 text-sm font-semibold text-blue-600 dark:text-blue-300 ${open ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30' : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'}`}
        >
          {open ? 'Hide' : 'Details'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
        </button>
      </div>
      {open && <Expanded s={s} row={row} />}
    </article>
  )
}

function Head({ s, k, children, tip }: { s: WithWithoutState; k: string; children: React.ReactNode; tip: string }) {
  const on = s.sort === k
  const asc = k === 'name'
  return (
    <th className={`whitespace-nowrap px-2 py-2 text-right ${on ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`} aria-sort={on ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" title={tip} onClick={() => s.setSort(k)} className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${on ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
        {children}{on ? (asc ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
}

function TeammateTable({ s }: { s: WithWithoutState }) {
  const cols = 7 + s.columns.length
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm [&_td]:border-b [&_th]:border-b [&_td]:border-gray-100 [&_th]:border-gray-200 dark:[&_td]:border-gray-700 dark:[&_th]:border-gray-700">
        <thead>
          <tr>
            <th className={`sticky left-0 z-10 px-3 py-2 text-left ${s.sort === 'name' ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-white dark:bg-gray-800'}`} aria-sort={s.sort === 'name' ? 'ascending' : 'none'}>
              <button type="button" title="Sort by name" onClick={() => s.setSort('name')} className={`text-xs font-semibold uppercase tracking-wide ${s.sort === 'name' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}`}>
                Player{s.sort === 'name' ? ' ▲' : ''}
              </button>
            </th>
            <Head s={s} k="gpw" tip="Games he played with them">GP with</Head>
            <Head s={s} k="gpwo" tip="Games they sat">GP w/o</Head>
            {Z_SORTS.map(z => <Head key={z.key} s={s} k={z.key} tip={z.tip}>{z.label}</Head>)}
            {s.columns.map(c => <Head key={c} s={s} k={c} tip={`Sort by ${c}`}>{c}</Head>)}
            <th className="px-2" />
          </tr>
        </thead>
        <tbody>
          {s.rows.map(row => {
            const id = row.player.player_id
            const open = s.isOpen(id)
            const mine = s.myTeamId != null && row.player.owner?.team_id === s.myTeamId
            const mineBg = mine ? 'bg-blue-50 dark:bg-blue-950' : ''
            const tint = (k: string) => s.sort === k ? 'bg-blue-50 dark:bg-blue-900/20' : mineBg
            return (
              <Fragment key={id}>
                <tr>
                  <td className={`sticky left-0 z-10 px-3 py-2 ${s.sort === 'name' ? 'bg-blue-50 dark:bg-blue-900/30' : mine ? 'bg-blue-50 dark:bg-blue-950' : 'bg-white dark:bg-gray-800'}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-gray-900 dark:text-white">{row.player.name}</span>
                      <span className="text-xs text-gray-500">{row.player.pos}</span>
                      {mine && <span className="rounded bg-blue-100 px-1.5 text-[11px] font-bold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">You</span>}
                      {!row.player.owner && <span className="rounded bg-emerald-100 px-1.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">FA</span>}
                      {row.small && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Small sample</span>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{row.player.owner ? row.player.owner.name : 'Free agent'}</p>
                  </td>
                  <td className={`px-2 text-right tabular-nums text-gray-700 dark:text-gray-200 ${tint('gpw')}`}>{row.withGroup.games}</td>
                  <td className={`px-2 text-right tabular-nums text-gray-700 dark:text-gray-200 ${tint('gpwo')}`}>{row.withoutGroup.games}</td>
                  <td className={`px-2 text-right tabular-nums ${tint('zw')}`}>{zText(row.zWith)}</td>
                  <td className={`px-2 text-right font-semibold tabular-nums ${tint('zwo')}`}>{zText(row.zWithout)}</td>
                  <td className={`px-2 text-right ${tint('zd')}`}><ZPill z={row.zDelta} /></td>
                  {s.columns.map(c => <td key={c} className={`px-2 text-right ${tint(c)}`}>{cellNode(s, row, c)}</td>)}
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} details for ${row.player.name}`}
                      onClick={() => s.toggleRow(id)}
                      className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-300"
                    >
                      {open ? 'Hide' : 'Details'}
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={cols} className="bg-gray-50 px-3 py-3 dark:bg-gray-900/40">
                      <Expanded s={s} row={row} />
                    </td>
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

function Results({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const groupLabel = s.cellMode === 'delta' ? 'Per game, without − with' : s.cellMode === 'with' ? 'Per game, with them' : 'Per game, without them'
  const table = s.layout === 'table'
  return (
    <section className="flex flex-col gap-3">
      <div className={`${card} flex flex-col gap-3 px-4 py-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle on={s.faOnly} onClick={() => s.setFaOnly(!s.faOnly)}>Free agents</Toggle>
          {s.myTeamId != null && <Toggle on={s.mineOnly} onClick={() => s.setMineOnly(!s.mineOnly)}>My team</Toggle>}
          <Toggle on={s.minGames} onClick={() => s.setMinGames(!s.minGames)}>{s.smallSample}+ games without</Toggle>
          <span className="flex-1" />
          {!s.zReady && <span className="text-xs text-gray-500">Loading Player Rankings for Z…</span>}
          <span className={label}>Layout</span>
          <Seg ariaLabel="Layout" value={s.layout} onChange={s.setLayout} options={[['cards', 'Cards'], ['table', 'Table']]} />
          <span className={label}>Stat cells</span>
          <Seg ariaLabel="Stat cells" value={s.cellMode} onChange={s.setCellMode} options={[['delta', 'Change'], ['with', 'With'], ['without', 'Without']]} />
        </div>
        {!table && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={label}>Sort · highest first</span>
            <SortStrip s={s} />
          </div>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">{groupLabel}. Z change is without minus with.</p>
      </div>

      {s.picked.length > 0 && s.rows.length === 0 && (
        <div className={`${card} p-6 text-center text-sm text-gray-500 dark:text-gray-400`}>
          {s.split?.counts.without === 0 ? `No ${season.abbr} games where ${s.split.names} sat${s.picked.length > 1 ? '. Try “Either sat” or remove a player' : ''}.` : 'No teammates match these filters.'}
        </div>
      )}

      {s.rows.length > 0 && (table
        ? <TeammateTable s={s} />
        : (
          <div className="flex flex-col gap-3">
            {s.rows.map(row => <Teammate key={row.player.player_id} s={s} row={row} />)}
          </div>
        ))}

      <p className="px-1 text-xs text-gray-500 dark:text-gray-400">
        {s.hiddenSmall > 0 && (
          <>
            {s.hiddenSmall} player{s.hiddenSmall > 1 ? 's' : ''} hidden: fewer than {s.smallSample} games without.{' '}
            <button type="button" onClick={() => s.setMinGames(false)} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">Show them</button>{' · '}
          </>
        )}
        {table ? 'Click a column to sort.' : 'Click a sort to reorder.'} Z is the Player Rankings score of each line (per game, equal weights). FG% and FT% are makes over attempts. This compares games; it doesn’t prove one player caused the change.
      </p>
    </section>
  )
}

function Desktop({ s }: { s: WithWithoutState }) {
  const season = s.season
  return (
    <div className={`mx-auto flex flex-col gap-5 px-4 py-6 sm:px-6 ${s.layout === 'table' ? 'max-w-screen-2xl' : 'max-w-5xl'}`}>
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">With / Without</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">How teammates play when someone sits. Pick a team and who’s out.</p>
      </header>

      {s.error && <ErrorMessage message={s.error} />}
      {s.teamsLoading ? <LoadingSpinner /> : <Setup s={s} />}

      {!s.teamsLoading && s.teamId == null && (
        <section className={`${card} p-10 text-center`}>
          <b className="text-gray-900 dark:text-white">Pick an NBA team to start</b>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Teams with your players are listed first, then teams with someone out today.</p>
        </section>
      )}

      {s.loading && <LoadingSpinner />}

      {season && s.picked.length === 0 && (
        <section className={`${card} flex flex-col gap-3 p-5`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-base font-bold text-gray-900 dark:text-white">Who’s sitting out?</h2>
            <span className={label}>0 of 3</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {s.pickOptions.some(o => o.player.out_today)
              ? `Pick up to 3 ${season.abbr} players. Out today is listed with the reason.`
              : s.pickOptions.length
                ? `Nobody on ${season.abbr} is out today. Pick someone who sat earlier.`
                : `Nobody on ${season.abbr} has missed a game yet.`}
          </p>
          <Picker s={s} />
        </section>
      )}

      {season && s.split && (
        <>
          <Summary s={s} season={season} />
          <Results s={s} season={season} />
        </>
      )}
    </div>
  )
}

export default function WithWithout() {
  const s = useWithWithout()
  const mobile = useMobileRedesign()
  if (mobile) return <MobileWithWithout s={s} />
  return <Desktop s={s} />
}
