import { Fragment } from 'react'
import { Link } from 'react-router'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { useMobileRedesign } from '../mobile/flag'
import MobileWithWithout from '../mobile/nba/MobileWithWithout'
import type { WithWithoutTeamSeason } from '../types/withWithout'
import {
  formatDelta, formatStat, formatZ, gameLogLabel, type GameKind, type TeammateRow,
} from '../utils/withWithout'
import { Z_SORTS, useWithWithout, type WithWithoutState } from './withWithout/useWithWithout'

const card = 'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700'
const label = 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'
const chip = 'inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium'
const chipOff = 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
const chipOn = 'border-blue-600 bg-blue-600 text-white'
const chipToggled = 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
/** The sorted column's tint. */
const hi = 'bg-blue-50 dark:bg-blue-900/20'

const KIND_TOK: Record<GameKind, string> = {
  with: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  without: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  unused: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}
const KIND_SQ: Record<GameKind, string> = { with: 'bg-blue-500', without: 'bg-amber-500', unused: 'bg-gray-300 dark:bg-gray-600' }
const KIND_LABEL: Record<GameKind, string> = { with: 'With', without: 'Without', unused: 'Not used' }

function Tok({ kind, children }: { kind: GameKind; children: React.ReactNode }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${KIND_TOK[kind]}`}>{children}</span>
}

function Seg<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`min-h-[34px] px-3 text-sm whitespace-nowrap ${value === k ? 'bg-blue-600 font-semibold text-white' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}`}
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
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${cls}`}>{formatZ(z)}</span>
}

const zText = (z: number | null) => (z === null ? '—' : `${z < -0.004 ? '−' : ''}${Math.abs(z).toFixed(2)}`)

function OutBadge() {
  return <span className="rounded bg-red-600 px-1.5 text-[10px] font-bold text-white">OUT</span>
}

function Picker({ s }: { s: WithWithoutState }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {s.pickOptions.map(o => (
        <button key={o.player.player_id} type="button" onClick={() => s.addPick(o.player.player_id)} className={`${chip} ${chipOff}`}>
          {o.player.name}
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">missed {o.missed}</span>
          {o.player.out_today && <OutBadge />}
          {o.player.two_way && <span className="rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-600 dark:bg-gray-600 dark:text-gray-200">Two-way</span>}
        </button>
      ))}
    </div>
  )
}

function Setup({ s }: { s: WithWithoutState }) {
  const mine = s.nbaTeams.filter(t => t.mine > 0)
  const out = s.nbaTeams.filter(t => t.mine === 0 && t.has_out_today)
  const rest = s.nbaTeams.filter(t => t.mine === 0 && !t.has_out_today)
  const opt = (t: (typeof s.nbaTeams)[number]) => (
    <option key={t.team_id} value={t.team_id}>{t.name}{t.mine ? ` · ${t.mine} of yours` : ''}{t.has_out_today ? ' · out today' : ''}</option>
  )
  return (
    <section className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex w-80 flex-col gap-2">
          <label htmlFor="ww-team" className={label}>Team</label>
          <select
            id="ww-team"
            value={s.teamId ?? ''}
            onChange={e => s.pickTeam(e.target.value ? Number(e.target.value) : null)}
            className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="">Pick an NBA team…</option>
            {mine.length > 0 && <optgroup label="Your players’ teams">{mine.map(opt)}</optgroup>}
            {out.length > 0 && <optgroup label="A player out today">{out.map(opt)}</optgroup>}
            <optgroup label={mine.length || out.length ? 'Other teams' : 'All teams'}>{rest.map(opt)}</optgroup>
          </select>
        </div>

        {s.season && (
          <div className="flex min-w-[320px] flex-1 flex-col gap-2">
            <span className={label}>Sitting out · up to 3</span>
            <div className="flex min-h-[44px] flex-wrap items-center gap-2">
              {s.picked.map(p => (
                <span key={p.player_id} className={`${chip} ${chipOn}`}>
                  {p.name}
                  {p.out_today && <OutBadge />}
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => s.removePick(p.player_id)} className="ml-0.5 text-base leading-none text-white/80 hover:text-white">×</button>
                </span>
              ))}
              {s.picked.length > 0 && s.canAdd && (
                <button type="button" aria-expanded={s.pickerOpen} onClick={() => s.setPickerOpen(!s.pickerOpen)} className={`${chip} ${chipOff} border-dashed`}>
                  {s.pickerOpen ? 'Close' : '+ Add player'}
                </button>
              )}
              {s.picked.length === 0 && <span className="text-sm text-gray-500 dark:text-gray-400">Pick someone below.</span>}
            </div>
          </div>
        )}

        {s.picked.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className={label}>Without = when</span>
            <Seg ariaLabel="Which games count as without" value={s.mode} onChange={s.setMode} options={[['all', s.picked.length > 2 ? 'All sat' : 'Both sat'], ['any', s.picked.length > 2 ? 'Any sat' : 'Either sat']]} />
          </div>
        )}
      </div>

      {s.season && s.picked.length > 0 && s.pickerOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <span className="text-xs text-gray-500 dark:text-gray-400">{s.season.abbr} players who missed games, most first</span>
          <Picker s={s} />
        </div>
      )}
    </section>
  )
}

function GameGrid({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const split = s.split!
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-x-1 text-center text-xs" aria-label={`${season.abbr} games`}>
        <tbody>
          <tr>
            <th scope="row" className="pr-2 text-left font-semibold whitespace-nowrap text-gray-500 dark:text-gray-400">{season.abbr} game</th>
            {season.games.map(g => (
              <td key={g.game_id} className="min-w-[58px] align-top">
                <div className="font-semibold whitespace-nowrap text-gray-700 dark:text-gray-200">{new Date(`${g.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                <div className="whitespace-nowrap text-gray-500 dark:text-gray-400">{g.home ? 'vs' : '@'} {g.opp}</div>
                <div className={`whitespace-nowrap ${g.result.startsWith('W') ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{g.result}</div>
              </td>
            ))}
          </tr>
          {s.picked.map(p => (
            <tr key={p.player_id}>
              <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap text-gray-700 dark:text-gray-200">{p.name}</th>
              {p.lines.map((e, i) => (
                <td key={i} className={`py-1 ${e === 0 ? 'font-bold text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{e === null ? '' : e === 0 ? 'Sat' : '✓'}</td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="pr-2 text-left font-semibold whitespace-nowrap text-gray-500 dark:text-gray-400">Counts as</th>
            {split.kinds.map((k, i) => <td key={i} className="pt-1"><Tok kind={k}>{KIND_LABEL[k]}</Tok></td>)}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Blank = he wasn’t on the team yet. “Not used” = only some of them sat, so the game is neither with nor without.</p>
    </div>
  )
}

function Summary({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const split = s.split!
  return (
    <section className={`${card} flex flex-col gap-3 px-5 py-4`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          <Tok kind="without">{split.counts.without} without</Tok> vs <Tok kind="with">{split.counts.with} with</Tok>
          <span className="font-normal text-gray-500 dark:text-gray-400"> · {split.counts.unused ? `${split.counts.unused} not used` : 'every game used'}</span>
        </span>
        <div className="flex flex-wrap gap-1" aria-hidden="true">
          {season.games.map((g, i) => <span key={g.game_id} title={`${g.date} ${g.home ? 'vs' : '@'} ${g.opp}: ${KIND_LABEL[split.kinds[i]]}`} className={`h-[18px] w-[18px] rounded ${KIND_SQ[split.kinds[i]]}`} />)}
        </div>
        <button type="button" aria-expanded={s.showGames} onClick={() => s.setShowGames(!s.showGames)} className="ml-auto text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
          {s.showGames ? 'Hide the games ▴' : 'See the games ›'}
        </button>
      </div>
      {s.showGames && <GameGrid s={s} season={season} />}
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
                  <b className="text-gray-900 dark:text-white">{new Date(`${g.game.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b>
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
  const grid = { gridTemplateColumns: `150px repeat(${cols.length}, minmax(0, 1fr)) 80px` }
  return (
    <div className="mx-4 mb-4 flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="grid gap-y-2 text-sm tabular-nums" style={grid}>
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

      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={logOpen} onClick={() => s.toggleLog(id)} className={`${chip} ${logOpen ? chipOn : chipOff}`}>Game-by-game log</button>
        <Link to={`/player/${id}`} className={`${chip} ${chipOff}`}>Player profile</Link>
        <button type="button" onClick={() => s.openTrade(row.player)} className={`${chip} ${chipOff}`}>Open in Trade Analyzer</button>
      </div>

      {logOpen && <GameLogTable s={s} row={row} />}
    </div>
  )
}

function Table({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const cols = s.columns
  const grid = { gridTemplateColumns: `minmax(220px, 2fr) 84px 72px 92px 86px repeat(${cols.length}, minmax(56px, 1fr)) 100px` }
  const minW = 760 + cols.length * 60
  const groupLabel = s.cellMode === 'delta' ? 'Per game, without − with' : s.cellMode === 'with' ? 'Per game, with them' : 'Per game, without them'
  const sortBtn = (key: string, text: string, tip: string) => {
    const on = s.sort === key
    return (
      <button key={key} type="button" title={tip} aria-sort={on ? 'descending' : 'none'} onClick={() => s.setSort(key)}
        className={`self-stretch px-2 py-2.5 text-right text-xs font-semibold uppercase tracking-wide ${on ? `${hi} text-blue-700 dark:text-blue-300` : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
        {text}{on ? ' ▼' : ''}
      </button>
    )
  }
  const cellVal = (r: TeammateRow, c: string) => {
    if (s.cellMode === 'delta') return <DeltaText cat={c} d={r.deltas[c]} reverse={s.reverse} />
    return <span className="text-gray-800 dark:text-gray-100">{formatStat(c, s.cellMode === 'with' ? r.withVals[c] : r.withoutVals[c])}</span>
  }

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Toggle on={s.faOnly} onClick={() => s.setFaOnly(!s.faOnly)}>Free agents</Toggle>
        {s.myTeamId != null && <Toggle on={s.mineOnly} onClick={() => s.setMineOnly(!s.mineOnly)}>My team</Toggle>}
        <Toggle on={s.minGames} onClick={() => s.setMinGames(!s.minGames)}>{s.smallSample}+ games without</Toggle>
        <span className="flex-1" />
        {!s.zReady && <span className="text-xs text-gray-500">Loading Player Rankings for Z…</span>}
        <span className={label}>Stat cells</span>
        <Seg ariaLabel="Stat cells" value={s.cellMode} onChange={s.setCellMode} options={[['delta', 'Change'], ['with', 'With'], ['without', 'Without']]} />
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: minW }}>
          <div className="grid items-end" style={grid}>
            <span /><span />
            <span className="col-span-3 border-b border-gray-300 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:border-gray-600 dark:text-blue-300">Fantasy value (Z)</span>
            <span className="border-b border-gray-300 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:border-gray-600 dark:text-gray-400" style={{ gridColumn: `span ${cols.length}` }}>{groupLabel}</span>
            <span />
          </div>
          <div className="grid items-stretch border-b border-gray-200 dark:border-gray-700" style={grid}>
            <span className={`px-4 py-2.5 ${label}`}>Player</span>
            <span className={`py-2.5 pr-2 text-right ${label}`}>Games w / w/o</span>
            {Z_SORTS.map(z => sortBtn(z.key, z.label, z.tip))}
            {cols.map(c => sortBtn(c, c, `Sort by ${c}`))}
            <span />
          </div>

          {s.picked.length > 0 && s.rows.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {s.split?.counts.without === 0 ? `No ${season.abbr} games where ${s.split.names} sat${s.picked.length > 1 ? '. Try “Either sat” or remove a player' : ''}.` : 'No teammates match these filters.'}
            </div>
          )}

          {s.rows.map(r => {
            const id = r.player.player_id
            const open = s.isOpen(id)
            const mine = s.myTeamId != null && r.player.owner?.team_id === s.myTeamId
            const bg = open ? 'bg-gray-50/70 dark:bg-gray-900/30' : mine ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
            return (
              <Fragment key={id}>
                <div className={`border-b border-gray-100 dark:border-gray-700 ${bg}`}>
                  <div className="grid items-stretch" style={grid}>
                    <div className="flex min-w-0 flex-col justify-center gap-0.5 py-2.5 pr-2 pl-4">
                      <span className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => s.toggleRow(id)} className="truncate text-left font-semibold text-gray-900 hover:underline dark:text-white">{r.player.name}</button>
                        <span className="text-xs text-gray-500">{r.player.pos}</span>
                        {mine && <span className="rounded bg-blue-100 px-1.5 text-[11px] font-bold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">You</span>}
                        {!r.player.owner && <span className="rounded bg-emerald-100 px-1.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">FA</span>}
                        {r.small && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Small sample</span>}
                      </span>
                      <span className="truncate text-xs text-gray-500 dark:text-gray-400">{r.player.owner ? r.player.owner.name : 'Free agent'}</span>
                    </div>
                    <span className="flex items-center justify-end pr-2 text-sm tabular-nums text-gray-500 dark:text-gray-400">{r.withGroup.games} / {r.withoutGroup.games}</span>
                    <span className={`flex items-center justify-end px-2 text-sm tabular-nums text-gray-800 dark:text-gray-100 ${s.sort === 'zw' ? hi : ''}`}>{zText(r.zWith)}</span>
                    <span className={`flex items-center justify-end px-2 text-sm font-bold tabular-nums text-gray-900 dark:text-white ${s.sort === 'zwo' ? hi : ''}`}>{zText(r.zWithout)}</span>
                    <span className={`flex items-center justify-end px-2 ${s.sort === 'zd' ? hi : ''}`}><ZPill z={r.zDelta} /></span>
                    {cols.map(c => <span key={c} className={`flex items-center justify-end px-2 text-sm tabular-nums ${s.sort === c ? hi : ''}`}>{cellVal(r, c)}</span>)}
                    <span className="flex items-center justify-end pr-3 pl-1">
                      <button type="button" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${r.player.name}`} onClick={() => s.toggleRow(id)}
                        className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 text-sm font-semibold text-blue-600 dark:text-blue-300 ${open ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30' : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'}`}>
                        {open ? 'Hide' : 'Details'}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
                      </button>
                    </span>
                  </div>
                  {open && <Expanded s={s} row={r} />}
                </div>
              </Fragment>
            )
          })}
        </div>
      </div>
      <p className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {s.hiddenSmall > 0 && (
          <>
            {s.hiddenSmall} player{s.hiddenSmall > 1 ? 's' : ''} hidden: fewer than {s.smallSample} games without.{' '}
            <button type="button" onClick={() => s.setMinGames(false)} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">Show them</button>{' · '}
          </>
        )}
        Click a column to sort. Z is the Player Rankings score of each line (per game, equal weights). FG% and FT% are makes over attempts. This compares games; it doesn’t prove one player caused the change.
      </p>
    </section>
  )
}

function Desktop({ s }: { s: WithWithoutState }) {
  const season = s.season
  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
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
        <section className={`${card} flex flex-col items-center gap-3 p-8 text-center`}>
          <b className="text-gray-900 dark:text-white">Who’s sitting out?</b>
          <p className="text-sm text-gray-500 dark:text-gray-400">Pick up to 3 {season.abbr} players. {s.pickOptions.length ? 'These missed games, most first:' : 'Nobody has missed a game yet.'}</p>
          <Picker s={s} />
        </section>
      )}

      {season && s.split && (
        <>
          <Summary s={s} season={season} />
          <Table s={s} season={season} />
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
