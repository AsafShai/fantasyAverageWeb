import { useMemo, useState } from 'react';
import {
  useGetFeatureStorePlayersQuery,
  useGetFeatureStorePlayerStateQuery,
  useGetFeatureStoreTeamsQuery,
  useGetFeatureStoreTeamStateQuery,
} from '../store/api/fantasyApi';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const fmt = (v: number | null) => {
  if (v == null) return '—';
  return Math.abs(v) < 1 && v !== 0 ? v.toFixed(3) : v.toFixed(2);
};

const CARD = 'bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700';

/** Filterable table of a {feature: value} dict, with quick substring filters. */
function FeatureTable({ title, features, quicks }: { title: string; features: Record<string, number | null>; quicks: string[] }) {
  const [quick, setQuick] = useState('all');
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    let e = Object.entries(features);
    if (quick !== 'all') e = e.filter(([k]) => k.toLowerCase().includes(quick.toLowerCase()));
    if (filter) e = e.filter(([k]) => k.toLowerCase().includes(filter.toLowerCase()));
    return e.sort(([a], [b]) => a.localeCompare(b));
  }, [features, quick, filter]);

  const populated = Object.values(features).filter((v) => v != null).length;

  return (
    <div>
      <div className="px-1 py-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-700 dark:text-gray-200 mr-2">{title}</span>
        {['all', ...quicks].map((q) => (
          <button
            key={q}
            onClick={() => setQuick(q)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${quick === q ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
          >
            {q}
          </button>
        ))}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="ml-auto px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
        />
        <span className="text-xs text-gray-400 w-full sm:w-auto">{populated} / {Object.keys(features).length} populated</span>
      </div>
      <div className="overflow-x-auto max-h-[50vh] border border-gray-100 dark:border-gray-800 rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 sticky top-0">
            <tr>
              <th className="text-left px-4 py-2">Feature ({rows.length})</th>
              <th className="text-right px-4 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-4 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">{k}</td>
                <td className={`px-4 py-1.5 text-right tabular-nums ${v == null ? 'text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-gray-100'}`}>{fmt(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="text-gray-400">{label}: </span>
      <span className="font-medium text-gray-900 dark:text-white">{value}</span>
    </span>
  );
}

export default function FeatureStore() {
  const { data: list, isLoading, error } = useGetFeatureStorePlayersQuery();
  const { data: teamList } = useGetFeatureStoreTeamsQuery();
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [playerFilter, setPlayerFilter] = useState('');

  const { data: pState } = useGetFeatureStorePlayerStateQuery(playerId as number, { skip: playerId == null });
  const { data: tState } = useGetFeatureStoreTeamStateQuery(teamId as number, { skip: teamId == null });

  const players = list?.players ?? [];
  const visiblePlayers = useMemo(() => {
    const q = playerFilter.toLowerCase();
    return players.filter((p) => !q || p.player_name.toLowerCase().includes(q) || p.team_abbr.toLowerCase().includes(q));
  }, [players, playerFilter]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Failed to load the feature store. Is the backend running?" />;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Feature Store</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The exact state stored per player and per team in the live nightly feature store.
          Empty (—) values are NaN.
        </p>
      </div>

      {/* ---- Player vector ---- */}
      <div className={`${CARD} p-4 flex flex-wrap items-end gap-4`}>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Filter players</label>
          <input value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} placeholder="name or team…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Player ({visiblePlayers.length})</label>
          <select value={playerId ?? ''} onChange={(e) => setPlayerId(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="">— select a player —</option>
            {visiblePlayers.map((p) => (
              <option key={p.player_id} value={p.player_id}>{p.player_name} — {p.team_abbr} ({p.games_count}g){p.eligible ? '' : ' ⚠ low history'}</option>
            ))}
          </select>
        </div>
      </div>

      {playerId != null && pState && (
        <div className={`${CARD} p-4`}>
          <div className="flex flex-wrap items-center gap-4 mb-2">
            <h2 className="font-semibold text-gray-900 dark:text-white">{pState.player_name}</h2>
            <Badge label="Team" value={pState.team_abbr} />
            <Badge label="Pos" value={pState.position || '—'} />
            <Badge label="Games" value={String(pState.games_count)} />
            <Badge label="Last game" value={pState.last_game_date ?? '—'} />
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${pState.eligible ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
              {pState.eligible ? 'eligible' : 'insufficient history (<10)'}
            </span>
          </div>
          <FeatureTable title="Player features" features={pState.features} quicks={['global', 'w10', 'w5', 'rate', 'mean', 'var', 'EFF']} />
        </div>
      )}

      {/* ---- Team vectors (own offense + allowed defense) ---- */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Team</label>
            <select value={teamId ?? ''} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              <option value="">— select a team —</option>
              {(teamList?.teams ?? []).map((t) => (
                <option key={t.team_id} value={t.team_id}>{t.team_abbr}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-400 flex-1 min-w-[220px]">
            <strong>Own</strong> = the team's offensive trends (used for the player's own-team context).
            <strong className="ml-2">Allowed</strong> = what this team gives up (used as the opponent's defensive context).
          </p>
        </div>

        {teamId != null && tState && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
            <FeatureTable title={`${tState.team_abbr} — Own (offense)`} features={tState.own} quicks={['global', 'w10', 'w5', 'mean', 'var']} />
            <FeatureTable title={`${tState.team_abbr} — Allowed (defense)`} features={tState.allowed} quicks={['global', 'w10', 'w5', 'mean', 'var']} />
          </div>
        )}
      </div>
    </div>
  );
}
