import { useState } from 'react';
import type { Player, Team } from '../../../types/api';
import type { TradeMode } from '../../../hooks/useTradeState';
import type { PlayerValueLookup } from '../utils/playerValues';
import {
  aggregateExtraAverages,
  aggregateExtraTotals,
  aggregatePlayerAverages,
  aggregatePlayerStats,
  extraCountingCategories,
} from '../utils/tradeCalculations';
import {
  formatBundlePct,
  categoryTone,
  signedCategoryZ,
  tradeSideCategoryZs,
  viewModeToCalcMode,
} from '../utils/tradeCategoryZ';
import { categoryZAgainstPool, type RankingCategory } from '../../../utils/playerRankings';
import type { TradeRankingContext } from '../utils/playerValues';
import { averageZ } from '../utils/playerValues';
import {
  type DisplayColumn,
  scoringCategoryForColumn,
} from './tradeComparisonColumns';
import { PlayerFace, TradeVersusRow, VersusHeaderRow, type CategoryPlayerLine, type VersusSideDisplay } from './TradeVersusRow';
import type { AggregatedStats } from '../utils/tradeCalculations';
import { maxZGap, pillClassForLabel } from './tradeVersusMath';
import '../trade-comparison.css';

interface TradeVersusComparisonProps {
  teamA: Team | null;
  teamB: Team | null;
  playersA: Player[];
  playersB: Player[];
  viewMode: 'totals' | 'averages';
  tradeMode: TradeMode;
  playerValue?: PlayerValueLookup;
  tradeRanking?: TradeRankingContext;
  scoringColumns: DisplayColumn[];
  /** When true, FG/FT rows use composite made-att lines. */
  compositeShooting: boolean;
  light?: boolean;
  /** Omit outer gradient shell when the parent already provides one. */
  embedded?: boolean;
  /** Page layout: 2 team cards, no player-count divider, share-style row coloring. */
  proLayout?: boolean;
}

const mainWinnerFromZ = (left: number | null, right: number | null): 0 | 1 | null => {
  const tone = categoryTone(left, right);
  if (tone === 'win') return 0;
  if (tone === 'lose') return 1;
  return null;
};

const formatPlayerBadge = (p: Player, lookup?: PlayerValueLookup) => {
  const v = lookup?.(p);
  if (!v) return null;
  return `#${v.rank} · Z ${signedCategoryZ(v.z)}`;
};

function formatCounting(value: number, viewMode: 'totals' | 'averages'): string {
  if (viewMode === 'averages') return value.toFixed(1);
  return Math.abs(value) >= 10000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value).toString();
}

function formatSlash(made: number, att: number, viewMode: 'totals' | 'averages'): string {
  if (viewMode === 'averages') return `${made.toFixed(1)} / ${att.toFixed(1)}`;
  return `${Math.round(made)} / ${Math.round(att)}`;
}

const COUNTING_FIELD: Record<string, keyof Player['stats']> = {
  PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'three_pm',
};

function playerCategoryLine(
  player: Player,
  category: string,
  viewMode: 'totals' | 'averages',
  tradeRanking?: TradeRankingContext,
): CategoryPlayerLine {
  const gp = Math.max(player.stats.gp || 0, 1);
  const perGame = viewMode === 'averages';
  let main = '—';
  let sub: string | undefined;
  if (category === 'FG%' || category === 'FT%') {
    const made = category === 'FG%' ? player.stats.fgm : player.stats.ftm;
    const att = category === 'FG%' ? player.stats.fga : player.stats.fta;
    main = formatBundlePct(made, att);
    sub = formatSlash(perGame ? made / gp : made, perGame ? att / gp : att, viewMode);
  } else {
    const fromDict = player.stats.stats?.[category];
    const field = COUNTING_FIELD[category];
    const raw = typeof fromDict === 'number' ? fromDict : field ? Number(player.stats[field] ?? 0) : 0;
    main = formatCounting(perGame ? raw / gp : raw, viewMode);
  }
  let z: number | null = null;
  if (tradeRanking?.referencePool.length) {
    z = categoryZAgainstPool(
      player,
      tradeRanking.referencePool,
      viewModeToCalcMode(viewMode),
      [category],
      tradeRanking.reverseCategories,
    )[category] ?? null;
  }
  return { name: player.player_name, playerId: player.player_id, main, sub, z };
}

function buildSideDisplay(
  column: DisplayColumn,
  fixed: AggregatedStats,
  extras: Record<string, number>,
  z: number | null,
  viewMode: 'totals' | 'averages',
  compositeShooting: boolean,
): VersusSideDisplay {
  if (column.composite === 'fg') {
    return {
      main: formatBundlePct(fixed.fgm, fixed.fga),
      sub: formatSlash(fixed.fgm, fixed.fga, viewMode),
      z,
    };
  }
  if (column.composite === 'ft') {
    return {
      main: formatBundlePct(fixed.ftm, fixed.fta),
      sub: formatSlash(fixed.ftm, fixed.fta, viewMode),
      z,
    };
  }
  const key = column.key;
  const isPct = key === 'fg_percentage' || key === 'ft_percentage';
  const raw = column.extraCategory ? extras[column.extraCategory] : fixed[key as keyof AggregatedStats];
  if (isPct && !compositeShooting) {
    const made = key === 'fg_percentage' ? fixed.fgm : fixed.ftm;
    const att = key === 'fg_percentage' ? fixed.fga : fixed.fta;
    return { main: formatBundlePct(made, att), z };
  }
  const main = formatCounting(Number(raw) || 0, viewMode);
  if (isPct) {
    const made = key === 'fg_percentage' ? fixed.fgm : fixed.ftm;
    const att = key === 'fg_percentage' ? fixed.fga : fixed.fta;
    return { main: formatBundlePct(made, att), z };
  }
  return { main, z };
}

export const TradeVersusComparison = ({
  teamA,
  teamB,
  playersA,
  playersB,
  viewMode,
  tradeMode,
  playerValue,
  tradeRanking,
  scoringColumns,
  compositeShooting,
  light = false,
  embedded = false,
  proLayout = false,
}: TradeVersusComparisonProps) => {
  // undefined = untouched: the first category row starts open, so the
  // breakdown is visible and the table below it stays in one piece.
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined);
  const isTeam = tradeMode === 'team';
  const getsA = isTeam ? playersB : playersA;
  const getsB = isTeam ? playersA : playersB;
  const agg = viewMode === 'averages' ? aggregatePlayerAverages : aggregatePlayerStats;
  const aggExtras = viewMode === 'averages' ? aggregateExtraAverages : aggregateExtraTotals;
  const extras = extraCountingCategories([...getsA, ...getsB]);
  const statsA = agg(getsA);
  const statsB = agg(getsB);
  const extraA = aggExtras(getsA, extras);
  const extraB = aggExtras(getsB, extras);

  const avgZA = proLayout ? averageZ(getsA, playerValue) : null;
  const avgZB = proLayout ? averageZ(getsB, playerValue) : null;

  const catZsA = tradeRanking?.referencePool.length
    ? tradeSideCategoryZs(getsA, tradeRanking.referencePool, tradeRanking.categories, tradeRanking.reverseCategories, viewMode)
    : null;
  const catZsB = tradeRanking?.referencePool.length
    ? tradeSideCategoryZs(getsB, tradeRanking.referencePool, tradeRanking.categories, tradeRanking.reverseCategories, viewMode)
    : null;

  const nameA = teamA?.team_name ?? (tradeMode === 'freeAgent' ? 'Your team' : 'Team A');
  const nameB = tradeMode === 'freeAgent' ? 'Free agents' : (teamB?.team_name ?? 'Team B');

  const categoryZ = (column: DisplayColumn, left: boolean) => {
    const cat = scoringCategoryForColumn(column);
    if (!cat || !catZsA || !catZsB) return null;
    const map = left ? catZsA : catZsB;
    return map[cat as RankingCategory] ?? null;
  };

  const rows = scoringColumns.filter(c => scoringCategoryForColumn(c));
  const shownKey = openKey === undefined
    ? rows[0]?.key ?? null
    : openKey;
  const zGapScale = maxZGap(rows.map(c => [categoryZ(c, true), categoryZ(c, false)]));

  const body = (
    <>
      <div className={`tc-versus__teams${proLayout ? ' tc-versus__teams--duo' : ''}`}>
        <TeamGetsCard
          teamName={nameA}
          getsLabel={isTeam ? 'gets' : 'drops'}
          players={getsA}
          playerValue={playerValue}
          pro={proLayout}
          avgZ={avgZA}
        />
        {!proLayout && (
          <div className="tc-versus__mid">
            <MatchScore left={getsA.length} right={getsB.length} />
          </div>
        )}
        {/* Free-agent mode: both cards are your team's move (drop / add). */}
        <TeamGetsCard
          teamName={isTeam ? nameB : nameA}
          getsLabel={isTeam ? 'gets' : 'adds'}
          players={getsB}
          playerValue={playerValue}
          pro={proLayout}
          avgZ={avgZB}
        />
      </div>
      <div className="tc-versus__rows" role="table" aria-label="Category comparison">
        {proLayout && <VersusHeaderRow valueLabel={viewMode === 'averages' ? 'Avg' : 'Total'} />}
        {rows.map(column => {
          const zL = categoryZ(column, true);
          const zR = categoryZ(column, false);
          const cat = scoringCategoryForColumn(column)!;
          return (
            <TradeVersusRow
              key={column.key}
              label={column.label}
              pillClass={pillClassForLabel(column.label)}
              vsStyle={proLayout ? 'slider' : 'chip'}
              mainWinner={proLayout ? undefined : mainWinnerFromZ(zL, zR)}
              muteZColor
              maxZGap={zGapScale}
              expanded={shownKey === column.key}
              onToggle={proLayout ? () => setOpenKey(shownKey === column.key ? null : column.key) : undefined}
              breakdown={proLayout ? {
                leftTitle: isTeam ? `${nameA} gets` : 'Drop',
                rightTitle: isTeam ? `${nameB} gets` : 'Add',
                left: getsA.map(p => playerCategoryLine(p, cat, viewMode, tradeRanking)),
                right: getsB.map(p => playerCategoryLine(p, cat, viewMode, tradeRanking)),
              } : undefined}
              left={buildSideDisplay(column, statsA, extraA, zL, viewMode, compositeShooting)}
              right={buildSideDisplay(column, statsB, extraB, zR, viewMode, compositeShooting)}
            />
          );
        })}
      </div>
    </>
  );

  if (embedded) return body;
  return <div className={`tc-shell${light ? ' tc-shell--light' : ''}`}>{body}</div>;
};

function MatchScore({ left, right }: { left: number; right: number }) {
  return <div className="tc-match-score">{left}–{right}</div>;
}

function TeamGetsCard({
  teamName,
  getsLabel,
  players,
  playerValue,
  pro,
  avgZ,
}: {
  teamName: string;
  getsLabel: string;
  players: Player[];
  playerValue?: PlayerValueLookup;
  pro?: boolean;
  avgZ?: number | null;
}) {
  return (
    <div className={`tc-team-card${pro ? ' tc-team-card--pro' : ''}`}>
      <div className="tc-team-card__head">
        <div>
          <div className="tc-team-card__name">{teamName}</div>
          <div className="tc-team-card__gets">{getsLabel}</div>
        </div>
      </div>
      <ul className="tc-player-list">
        {players.map(p => (
          <li key={p.player_name} className="tc-player-chip">
            <PlayerFace name={p.player_name} playerId={p.player_id} size="chip" />
            <span className="tc-player-chip__text">
              <span className="tc-player-chip__name">{p.player_name}</span>
              {formatPlayerBadge(p, playerValue) && (
                <span className="tc-player-chip__value">{formatPlayerBadge(p, playerValue)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {pro && playerValue && avgZ != null && (
        <div className="tc-team-card__avg-meta" title="Average player Z on incoming players">
          Avg Z {signedCategoryZ(avgZ)}
        </div>
      )}
    </div>
  );
}