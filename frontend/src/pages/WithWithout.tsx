import { Fragment } from 'react'
import { Link } from 'react-router'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { myTeamRowClass } from '../myTeam/display'
import { useMobileRedesign } from '../mobile/flag'
import MobileWithWithout from '../mobile/nba/MobileWithWithout'
import type { WithWithoutTeamSeason } from '../types/withWithout'
import {
  entryValue, formatDelta, formatGameStat, formatStat, formatZ, type GameKind, type TeammateRow,
} from '../utils/withWithout'
import { useWithWithout, type WithWithoutState } from './withWithout/useWithWithout'

const card = 'bg-white dark:bg-gray-800 rounded-lg shadow'
const label = 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'

const KIND_STYLE: Record<GameKind, string> = {
  with: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  without: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  unused: 'text-gray-400 dark:text-gray-500',
}
const KIND_LABEL: Record<GameKind, string> = { with: 'With', without: 'Without', unused: '—' }

function Tok({ kind, children }: { kind: 'with' | 'without'; children: React.ReactNode }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${KIND_STYLE[kind]}`}>{children}</span>
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
          className={`px-3 py-1.5 text-sm whitespace-nowrap ${value === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-400 dark:border-gray-500'}`}>
      {on ? '✓' : ''}
    </span>
  )
}

function DeltaCell({ cat, d, reverse }: { cat: string; d: number; reverse: Set<string> }) {
  const { text, dir } = formatDelta(cat, d)
  const good = reverse.has(cat) ? dir === 'down' : dir === 'up'
  const cls = dir === 'flat'
    ? 'text-gray-400 dark:text-gray-500'
    : good ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>{text}</span>
}

function ZPill({ z }: { z: number | null }) {
  const cls = z === null || Math.abs(z) < 0.01
    ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
    : z > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${cls}`}>{formatZ(z)}</span>
}

function Owner({ row, myTeamId }: { row: TeammateRow; myTeamId: number | null }) {
  const owner = row.player.owner
  if (!owner) return <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">FA</span>
  const mine = owner.team_id === myTeamId
  return (
    <span className={`block truncate text-sm ${mine ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'}`} title={owner.name}>
      {owner.name}{mine ? ' · You' : ''}
    </span>
  )
}

function GameStrip({ s, season }: { s: WithWithoutState; season: WithWithoutTeamSeason }) {
  const split = s.split!
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-x-1 text-center text-xs" aria-label={`${season.abbr} games: ${split.counts.without} without, ${split.counts.with} with, ${split.counts.unused} not used`}>
        <tbody>
          <tr>
            <th scope="row" className="pr-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{season.abbr} game</th>
            {season.games.map(g => (
              <td key={g.game_id} className="min-w-[58px] align-top">
                <div className="font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">{new Date(`${g.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                <div className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{g.home ? 'vs' : '@'} {g.opp}</div>
                <div className={`whitespace-nowrap ${g.result.startsWith('W') ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{g.result}</div>
              </td>
            ))}
          </tr>
          {s.picked.map(p => (
            <tr key={p.player_id}>
              <th scope="row" className="pr-2 text-left font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{p.name}</th>
              {p.lines.map((e, i) => (
                <td key={i} className={`py-1 ${e === 0 ? 'font-bold text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                  {e === null ? '' : e === 0 ? 'Sat' : '✓'}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="pr-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Counts as</th>
            {split.kinds.map((k, i) => (
              <td key={i} className="pt-1">
                <span className={`inline-block w-full rounded px-1 py-0.5 font-bold ${KIND_STYLE[k]}`}>{KIND_LABEL[k]}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Expanded({ s, row, season }: { s: WithWithoutState; row: TeammateRow; season: WithWithoutTeamSeason }) {
  const cols = s.columns
  const vsNames = s.split!.withoutDesc.replace(/ (both|all)? ?sat.*$/, '')
  const views: [Exclude<typeof s.rowView, 'none'>, string][] = [['log', 'Game-by-game log'], ['profile', 'View player profile'], ['trade', 'Open in Trade Analyzer']]
  return (
    <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="mb-2 text-sm text-gray-600 dark:text-gray-300">
        <b className="text-gray-900 dark:text-white">{row.player.name}</b> per game, with vs. without {vsNames}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm tabular-nums">
          <thead>
            <tr>
              <th />
              {cols.map(c => <th key={c} className="px-2 py-1 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{c}</th>)}
              <th className="px-2 py-1 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Z</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1 pr-3 whitespace-nowrap"><Tok kind="with">With</Tok> <span className="text-xs text-gray-500">{row.withGroup.games} games</span></td>
              {cols.map(c => <td key={c} className="px-2 py-1 text-right">{formatStat(c, row.withVals[c])}</td>)}
              <td className="px-2 py-1 text-right">{formatZ(row.zWith)}</td>
            </tr>
            <tr>
              <td className="py-1 pr-3 whitespace-nowrap"><Tok kind="without">Without</Tok> <span className="text-xs text-gray-500">{row.withoutGroup.games} games</span></td>
              {cols.map(c => <td key={c} className="px-2 py-1 text-right">{formatStat(c, row.withoutVals[c])}</td>)}
              <td className="px-2 py-1 text-right">{formatZ(row.zWithout)}</td>
            </tr>
            <tr className="border-t border-gray-200 dark:border-gray-700">
              <td className="py-1 pr-3 font-semibold">Change</td>
              {cols.map(c => <td key={c} className="px-2 py-1 text-right"><DeltaCell cat={c} d={row.deltas[c]} reverse={s.reverse} /></td>)}
              <td className="px-2 py-1 text-right"><ZPill z={row.zDelta} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div role="group" aria-label="More for this player" className="mt-3 flex flex-wrap gap-2">
        {views.map(([k, text]) => (
          <button
            key={k}
            type="button"
            aria-pressed={s.rowView === k}
            onClick={() => (k === 'trade' ? s.openTrade(row.player) : s.setRowView(s.rowView === k ? 'none' : k))}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${s.rowView === k ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'}`}
          >
            {text}
          </button>
        ))}
      </div>

      {s.rowView === 'profile' && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
          <span className="text-gray-600 dark:text-gray-300">
            {row.player.pos} · {row.player.owner ? `Owned by ${row.player.owner.name}` : 'Free agent'} · played {row.player.lines.filter(Array.isArray).length} of {row.player.lines.filter(e => e !== null).length} {season.abbr} games
          </span>
          <Link to={`/player/${row.player.player_id}`} className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">Open full profile</Link>
        </div>
      )}

      {s.rowView === 'log' && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="bg-gray-50 dark:bg-gray-900/40">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Game</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Counts as</th>
                {cols.map(c => <th key={c} className="px-2 py-2 text-right text-xs font-semibold text-gray-500">{c}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {season.games.map((g, i) => {
                const e = row.player.lines[i]
                if (e === null) return null
                const kind = s.split!.kinds[i]
                const out = s.picked.filter(p => p.lines[i] === 0).map(p => p.name.split(' ').slice(1).join(' '))
                return (
                  <tr key={g.game_id} className={e === 0 ? 'opacity-60' : ''}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{g.date.slice(5).replace('-', '/')} · {g.home ? 'vs' : '@'} {g.opp} <span className="text-xs text-gray-500">{g.result}</span></td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {e === 0 ? <span className="text-xs text-gray-500">Didn’t play · not used for him</span>
                        : kind === 'unused' ? <span className="text-xs text-gray-500">Not used</span>
                        : <Tok kind={kind}>{KIND_LABEL[kind]}</Tok>}
                      {e !== 0 && <span className="ml-1 text-xs text-gray-500">· {out.length ? `out: ${out.join(', ')}` : 'all played'}</span>}
                    </td>
                    {cols.map(c => <td key={c} className="px-2 py-1.5 text-right">{Array.isArray(e) ? formatGameStat(c, entryValue(e, season.line_fields, c)) : '—'}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Desktop({ s }: { s: WithWithoutState }) {
  const season = s.season
  const cols = s.columns
  const grid = { gridTemplateColumns: `minmax(180px,1.6fr) minmax(150px,1.3fr) 90px repeat(${cols.length}, minmax(58px,1fr)) 80px` }
  const minW = 520 + cols.length * 64

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-white">🩺 With / Without</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">Pick one or more teammates. See how everyone else plays in games they all sat vs. games they all played.</p>

      {s.error && <ErrorMessage message={s.error} />}

      <div className={`${card} mb-6 space-y-5 p-4`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">1</span>Pick an NBA team</span>
          <label htmlFor="ww-team" className="sr-only">NBA team</label>
          <select
            id="ww-team"
            value={s.teamId ?? ''}
            onChange={e => s.pickTeam(Number(e.target.value))}
            className="min-h-[36px] min-w-[240px] rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            {s.nbaTeams.map(t => <option key={t.team_id} value={t.team_id}>{t.name}{t.has_out_today ? ' · player out today' : ''}</option>)}
          </select>
          <button type="button" aria-pressed={s.injOnly} onClick={() => s.setInjOnly(!s.injOnly)} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <Check on={s.injOnly} />Only teams with a player out today
          </button>
        </div>

        {season && (
          <div>
            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">2</span>
              Compare without <span className="font-normal text-gray-500 dark:text-gray-400">pick up to 3 {season.abbr} players · {s.picked.length ? `${s.picked.length} picked` : 'none picked yet'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {s.pickOptions.map(o => (
                <button
                  key={o.player.player_id}
                  type="button"
                  aria-pressed={o.picked}
                  disabled={o.disabled}
                  onClick={() => s.togglePick(o.player.player_id)}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-45 ${o.picked ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600'}`}
                >
                  <Check on={o.picked} />
                  <span className="font-medium text-gray-900 dark:text-white">{o.player.name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{o.missed ? `missed ${o.missed} of ${o.onTeam}` : 'never missed'}</span>
                  {o.player.two_way && <span className="rounded bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-600 dark:text-gray-200">Two-way</span>}
                  {o.player.approx && <span className="rounded bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-600 dark:text-gray-200" title="Roster dates from box scores only">approx</span>}
                  {o.player.out_today && <span className="rounded-full bg-red-100 px-2 text-[10px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">OUT · {o.player.out_today.note}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {s.picked.length > 1 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">3</span>Count a game as “without” when</span>
            <Seg ariaLabel="Which games count as without" value={s.mode} onChange={s.setMode} options={[['all', 'All of them sat'], ['any', 'Any of them sat']]} />
          </div>
        )}
      </div>

      {s.loading && <LoadingSpinner />}

      {season && s.split && (
        <div className={`${card} mb-6 p-4`}>
          <div className="mb-3">
            <div className={label}>Which games are compared</div>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">{s.split.sentence}</p>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><div className="flex items-center gap-2"><b className="text-xl tabular-nums">{s.split.counts.with}</b><Tok kind="with">With</Tok></div><div className="text-xs text-gray-500 dark:text-gray-400">games where {s.split.withDesc}</div></div>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><div className="flex items-center gap-2"><b className="text-xl tabular-nums">{s.split.counts.without}</b><Tok kind="without">Without</Tok></div><div className="text-xs text-gray-500 dark:text-gray-400">games where {s.split.withoutDesc}</div></div>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><div className="flex items-center gap-2"><b className="text-xl tabular-nums">{s.split.counts.unused}</b><span className="text-xs font-bold text-gray-500">Not used</span></div><div className="text-xs text-gray-500 dark:text-gray-400">{s.split.unusedDesc}</div></div>
          </div>
          <GameStrip s={s} season={season} />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Each column is one {season.abbr} game this season. The rows show whether each picked player played (✓) or sat; blank means he wasn’t on the team yet. The last row shows how that game is used in the table below.</p>
        </div>
      )}

      {season && (
        <div className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-3 dark:border-gray-700">
            <button type="button" aria-pressed={s.faOnly} onClick={() => s.setFaOnly(!s.faOnly)} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><Check on={s.faOnly} />Free agents only</button>
            <span className={`${label} ml-2`}>Cells</span>
            <Seg ariaLabel="Cell values" value={s.cellMode} onChange={s.setCellMode} options={[['delta', 'Change'], ['with', 'With'], ['without', 'Without']]} />
            {!s.zReady && <span className="text-xs text-gray-500">Loading Player Rankings for Z…</span>}
          </div>
          <div className="overflow-x-auto">
            <div style={{ minWidth: minW }}>
              <div className="grid items-center border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40" style={grid}>
                {['Player', 'Owner', 'GP w/ · w/o'].map(h => <span key={h} className={`px-3 py-2 ${label}`}>{h}</span>)}
                {[...cols, 'z'].map(c => (
                  <button key={c} type="button" onClick={() => s.setSort(c)} title={c === 'z' ? 'Sort by change in fantasy value' : `Sort by change in ${c}`} className={`px-2 py-2 text-right text-xs font-semibold uppercase ${s.sort === c ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
                    {c === 'z' ? 'Z Δ' : c}{s.sort === c ? ' ▼' : ''}
                  </button>
                ))}
              </div>
              {s.picked.length === 0 && <div className="p-6 text-center text-sm text-gray-500">Tick at least one {season.abbr} player in step 2.</div>}
              {s.picked.length > 0 && s.rows.length === 0 && (
                <div className="p-6 text-center text-sm text-gray-500">
                  {s.split?.counts.without === 0 ? `No ${season.abbr} games where ${s.split.withoutDesc}. Try “Any of them sat” or remove a player.` : 'No teammates match these filters.'}
                </div>
              )}
              {s.rows.map(r => {
                const open = s.openId === r.player.player_id
                const mine = r.player.owner?.team_id === s.myTeamId
                return (
                  <Fragment key={r.player.player_id}>
                    <button type="button" aria-expanded={open} onClick={() => s.toggleRow(r.player.player_id)} className={`grid w-full items-center border-b border-gray-100 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40 ${mine ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''} ${myTeamRowClass(mine)}`} style={grid}>
                      <span className="flex min-w-0 items-center gap-1.5 px-3 py-2 text-sm">
                        <span className="text-gray-400" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        <span className="truncate font-medium text-gray-900 dark:text-white">{r.player.name}</span>
                        <span className="text-xs text-gray-500">{r.player.pos}</span>
                      </span>
                      <span className="min-w-0 px-3 py-2"><Owner row={r} myTeamId={s.myTeamId} /></span>
                      <span className="px-3 py-2 text-sm tabular-nums text-gray-700 dark:text-gray-200">
                        {r.withGroup.games} · {r.withoutGroup.games}
                        {r.small && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">small</span>}
                      </span>
                      {cols.map(c => (
                        <span key={c} className="px-2 py-2 text-right text-sm tabular-nums text-gray-700 dark:text-gray-200">
                          {s.cellMode === 'delta' ? <DeltaCell cat={c} d={r.deltas[c]} reverse={s.reverse} /> : formatStat(c, s.cellMode === 'with' ? r.withVals[c] : r.withoutVals[c])}
                        </span>
                      ))}
                      <span className="px-2 py-2 text-right"><ZPill z={r.zDelta} /></span>
                    </button>
                    {open && <Expanded s={s} row={r} season={season} />}
                  </Fragment>
                )
              })}
            </div>
          </div>
          <p className="border-t border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Z Δ = change in fantasy value of his per-game line, scored like Player Rankings (per game, equal weights). FG% and FT% are total makes over total attempts. Click a row for the raw with/without lines. “small” = fewer than 3 games without. This compares games; it doesn’t prove one player caused the change.
          </p>
        </div>
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

