import { useEffect, useMemo, useState } from 'react';
import type { Player, Team } from '../../../types/api';
import { Card, SelectSheet } from '../../../mobile/ui';
import LoadingSpinner from '../../../components/LoadingSpinner';
import ErrorMessage from '../../../components/ErrorMessage';
import PlayerNameLink from '../../../components/PlayerNameLink';
import { getErrorMessage } from '../../../utils/errorMessage';
import { getHeatmapColor, getTextColor } from '../../../utils/colorUtils';
import { orderCategories } from '../../../utils/statOrder';
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../../../myTeam/display';
import { useMyTeam } from '../../../context/MyTeamContext';
import { rankTone, signedZ } from '../../../components/activity/stintValue';
import type { PlayerValue, PlayerValueLookup } from '../utils/playerValues';
import { displayStats, formatMobileStat, STAT_FIELDS, type ViewMode } from './format';

function useDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

/** Team category rankings as heat tiles (same colors as the desktop bar). */
export function RankingsBar({ categoryRanks }: { categoryRanks: Record<string, number> }) {
  const isDark = useDarkMode();
  const keys = orderCategories(Object.keys(categoryRanks));
  const values = Object.values(categoryRanks);
  const teamCount = values.length > 0 ? Math.max(...values) : 1;
  const norm = (rank: number) => (teamCount > 1 ? (rank - 1) / (teamCount - 1) : 0.5);
  return (
    <div className="mr-trade-rk mr-noscroll" role="list" aria-label="Team Category Rankings">
      {keys.map((k) => {
        const rank = categoryRanks[k] || 0;
        return (
          <div
            key={k}
            role="listitem"
            className="mr-trade-rk-cat"
            style={{ background: getHeatmapColor(norm(rank), isDark), color: getTextColor(norm(rank), isDark) }}
          >
            <span>{k}</span>
            <b className="mr-num">{rank}</b>
          </div>
        );
      })}
    </div>
  );
}

function ValueChips({ value }: { value: PlayerValue }) {
  return (
    <span
      className="mr-trade-val"
      title={`Rank ${value.rank} of ${value.of} players over these dates, Z-score ${signedZ(value.z)} (per game, as on Player Rankings)`}
    >
      <span className={`mr-trade-chip ${rankTone(value.rank)}`}>#{value.rank}</span>
      <span className="mr-trade-chip mr-trade-chip-z">Z {signedZ(value.z)}</span>
    </span>
  );
}

/** Selected player: name (opens the player sheet), team · positions · GP, value, every stat. */
export function TradePlayerCard({ player, viewMode, value, onRemove }: {
  player: Player; viewMode: ViewMode; value?: PlayerValue; onRemove: () => void;
}) {
  const s = displayStats(player.stats, viewMode);
  return (
    <article className="mr-trade-pcard">
      <div className="mr-card-head">
        <PlayerNameLink name={player.player_name} playerId={player.player_id} className="mr-trade-pname" />
        <button type="button" className="mr-trade-x" onClick={onRemove} aria-label={`Remove ${player.player_name}`} title="Remove player">✕</button>
      </div>
      <div className="mr-trade-pmeta">
        <span className="mr-meta">{[player.pro_team, player.positions.join('/'), `${player.stats.gp} GP`].join(' · ')}</span>
        {value && <ValueChips value={value} />}
      </div>
      <dl className="mr-trade-grid">
        {STAT_FIELDS.map(({ field, label }) => (
          <div key={field}>
            <dt>{label}</dt>
            <dd className="mr-num">{formatMobileStat(field, s[field] as number, viewMode)}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function pickLabel(player: Player, viewMode: ViewMode) {
  const s = displayStats(player.stats, viewMode);
  const f = (v: number) => (viewMode === 'averages' ? v.toFixed(1) : String(Math.round(v)));
  return `${player.player_name} (${player.positions.join('/')}) · ${f(s.pts)} PTS, ${f(s.reb)} REB, ${f(s.ast)} AST`;
}

interface TeamSideProps {
  title: string;
  /** Unique per side, keeps the pickers' history entries apart. */
  sideId: string;
  teams: Team[];
  selectedTeam: Team | null;
  onTeamChange: (team: Team | null) => void;
  players: Player[];
  selectedPlayers: Player[];
  onPlayerSelect: (player: Player) => void;
  onPlayerRemove: (player: Player) => void;
  isLoadingTeams: boolean;
  isLoadingPlayers: boolean;
  teamsError: unknown;
  playersError: unknown;
  viewMode: ViewMode;
  playerValue?: PlayerValueLookup;
  categoryRanks?: Record<string, number>;
}

/** One trade side with a fantasy team: team picker, rankings, player picker, cards. */
export function TeamSideCard(props: TeamSideProps) {
  const {
    title, sideId, teams, selectedTeam, onTeamChange, players, selectedPlayers, onPlayerSelect, onPlayerRemove,
    isLoadingTeams, isLoadingPlayers, teamsError, playersError, viewMode, playerValue, categoryRanks,
  } = props;
  const { myTeamId, isMyTeam } = useMyTeam();
  const teamOptions = useMemo(
    () => leadWithMyTeam(teams, myTeamId).map((t) => ({ value: String(t.team_id), label: fantasyTeamOptionLabel(t.team_name, isMyTeam(t.team_id)) })),
    [teams, myTeamId, isMyTeam],
  );
  const available = players.filter((p) => !selectedPlayers.some((s) => s.player_name === p.player_name));
  const playerOptions = available.map((p) => ({ value: p.player_name, label: pickLabel(p, viewMode) }));

  return (
    <Card title={title} action={selectedTeam ? <span className="mr-meta">{players.length} players available</span> : undefined}>
      {isLoadingTeams ? (
        <LoadingSpinner />
      ) : teamsError ? (
        <ErrorMessage message={getErrorMessage(teamsError, 'Failed to load teams')} />
      ) : (
        <SelectSheet
          id={`trade-team-${sideId}`}
          label="Select Team"
          wide
          options={teamOptions}
          value={selectedTeam ? String(selectedTeam.team_id) : ''}
          display={selectedTeam ? undefined : 'Choose a team...'}
          onChange={(v) => onTeamChange(teams.find((t) => String(t.team_id) === v) ?? null)}
        />
      )}

      {selectedTeam && categoryRanks && (
        <div className="mr-trade-sub">
          <h3 className="mr-trade-h3">Team Category Rankings</h3>
          <RankingsBar categoryRanks={categoryRanks} />
        </div>
      )}

      {selectedTeam && (
        <div className="mr-trade-sub">
          <h3 className="mr-trade-h3">Add Players</h3>
          {isLoadingPlayers ? (
            <LoadingSpinner />
          ) : playersError ? (
            <ErrorMessage message={getErrorMessage(playersError, 'Failed to load players')} />
          ) : available.length === 0 ? (
            <p className="mr-meta mr-trade-empty-line">All players have been selected</p>
          ) : (
            <SelectSheet
              id={`trade-player-${sideId}`}
              label="Add Players"
              wide
              options={playerOptions}
              value=""
              display="Select a player to add..."
              onChange={(name) => {
                const player = players.find((p) => p.player_name === name);
                if (player) onPlayerSelect(player);
              }}
            />
          )}
        </div>
      )}

      {selectedPlayers.length > 0 && (
        <div className="mr-trade-sub">
          <h3 className="mr-trade-h3">Selected Players ({selectedPlayers.length})</h3>
          {selectedPlayers.map((p) => (
            <TradePlayerCard key={p.player_name} player={p} viewMode={viewMode} value={playerValue?.(p)} onRemove={() => onPlayerRemove(p)} />
          ))}
        </div>
      )}

      {!selectedTeam && !isLoadingTeams && !teamsError && (
        <div className="mr-trade-empty">
          <div aria-hidden="true">🏀</div>
          <p>Select a team to view available players</p>
        </div>
      )}
    </Card>
  );
}

interface FreeAgentSideProps {
  players: Player[];
  selectedPlayers: Player[];
  onPlayerSelect: (player: Player) => void;
  onPlayerRemove: (player: Player) => void;
  isLoading: boolean;
  error: unknown;
  viewMode: ViewMode;
  playerValue?: PlayerValueLookup;
}

/** Side B in Team vs Free Agents: search the pool, same results as desktop (top 20, ≥ 2 letters). */
export function FreeAgentSideCard({ players, selectedPlayers, onPlayerSelect, onPlayerRemove, isLoading, error, viewMode, playerValue }: FreeAgentSideProps) {
  const [term, setTerm] = useState('');
  const q = term.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 2) return [];
    return players
      .filter((p) => !selectedPlayers.some((s) => s.player_name === p.player_name))
      .filter((p) => p.player_name.toLowerCase().includes(q) || p.pro_team.toLowerCase().includes(q) || p.positions.some((pos) => pos.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [q, players, selectedPlayers]);
  const per = (v: number, gp: number) => (viewMode === 'averages' ? (gp > 0 ? v / gp : 0) : v).toFixed(1);

  return (
    <Card title="Free Agent Pool" action={!isLoading && !error ? <span className="mr-meta">{players.length} free agents available</span> : undefined}>
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load free agents')} />
      ) : (
        <div className="mr-trade-sub">
          <label className="mr-trade-h3" htmlFor="mr-trade-fa-search">Search Free Agents &amp; Waivers</label>
          <input
            id="mr-trade-fa-search"
            type="search"
            className="mr-trade-search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Type player name, team, or position..."
            autoComplete="off"
          />
          {q.length > 0 && q.length < 2 && <p className="mr-meta">Type at least 2 characters to search</p>}
          {q.length >= 2 && results.length === 0 && <p className="mr-meta">No players found matching "{term.trim()}"</p>}
          {results.length > 0 && (
            <ul className="mr-trade-results" aria-label="Free agent results">
              {results.map((p) => (
                <li key={p.player_name}>
                  <button type="button" className="mr-trade-result" onClick={() => { onPlayerSelect(p); setTerm(''); }}>
                    <span className="mr-trade-result-main">
                      <b>{p.player_name}</b> <span className="mr-meta">({p.positions.join('/')})</span>
                      <span className="mr-meta mr-trade-result-line">
                        {p.pro_team} · {per(p.stats.pts, p.stats.gp)} PPG, {per(p.stats.reb, p.stats.gp)} RPG, {per(p.stats.ast, p.stats.gp)} APG
                      </span>
                    </span>
                    <span className="mr-trade-add">+ Add</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedPlayers.length > 0 && (
        <div className="mr-trade-sub">
          <h3 className="mr-trade-h3">Selected Free Agents ({selectedPlayers.length})</h3>
          {selectedPlayers.map((p) => (
            <TradePlayerCard key={p.player_name} player={p} viewMode={viewMode} value={playerValue?.(p)} onRemove={() => onPlayerRemove(p)} />
          ))}
        </div>
      )}

      {!isLoading && !error && selectedPlayers.length === 0 && q.length < 2 && (
        <div className="mr-trade-empty">
          <div aria-hidden="true">🔍</div>
          <p>Search for free agents</p>
          <p className="mr-meta">Type at least 2 characters to see results</p>
        </div>
      )}
    </Card>
  );
}
