import { useState } from 'react';
import type { Player } from '../../../types/api';
import { BottomSheet, Button, Card, Chip, DataTable, useSheetHistory, type Column } from '../../../mobile/ui';
import { KNOWN_REVERSE_CATEGORIES } from '../utils/tradeCalculations';
import { buildTradeComparison, type SideRow, type TradeComparisonProps } from './comparison';
import { SHARE_CATEGORIES, tradeShareRows } from '../utils/tradeShare';
import { useMyTeam } from '../../../context/MyTeamContext';
import { ShareCardButton } from '../../../components/share/ShareCardButton';
import { TradeShareCard, type TradeShareSide } from '../../../components/share/TradeShareCard';
import { formatAsOf } from '../../../components/share/shareCardFormat';
import { signedZ } from '../../../components/activity/stintValue';
import { formatMobileStat, STAT_FIELDS } from './format';

const EXTRA = 'extra:';

interface StatColumn {
  key: string;
  label: string;
  extraCategory?: string;
}

export function TradeComparisonCard(props: TradeComparisonProps) {
  const { teamA, teamB, playersA, playersB, viewMode, tradeMode, periodLabel, playerValue } = props;
  const { myTeamId } = useMyTeam();
  const { rows, extraCategories, ready, showZ } = buildTradeComparison(props);
  const columnsSheet = useSheetHistory('trade-columns');

  const fixedColumns: StatColumn[] = STAT_FIELDS.map(({ field, label }) => ({ key: field, label }));
  const extraColumns: StatColumn[] = extraCategories.map((c) => ({ key: `${EXTRA}${c}`, label: c, extraCategory: c }));
  const statColumns = [...fixedColumns.slice(0, -1), ...extraColumns, fixedColumns[fixedColumns.length - 1]];
  const categoryKeys = new Set<string>([...SHARE_CATEGORIES.map((c) => c.field), ...extraColumns.map((c) => c.key)]);

  // null = the phone default (categories only); otherwise an explicit choice.
  const [shown, setShown] = useState<Record<string, boolean> | null>(null);
  const [beforeCats, setBeforeCats] = useState<Record<string, boolean> | null>(null);
  const isShown = (key: string) => (shown ? shown[key] ?? true : categoryKeys.has(key));
  const categoriesOnly = statColumns.every(({ key }) => isShown(key) === categoryKeys.has(key));
  const snapshot = () => Object.fromEntries(statColumns.map(({ key }) => [key, isShown(key)]));
  const setAll = (on: boolean) => setShown(Object.fromEntries(statColumns.map(({ key }) => [key, on])));
  const toggleColumn = (key: string) => setShown({ ...snapshot(), [key]: !isShown(key) });
  const toggleCategoriesOnly = () => {
    if (categoriesOnly) {
      if (beforeCats) setShown(beforeCats);
      else setAll(true);
      setBeforeCats(null);
      return;
    }
    setBeforeCats(snapshot());
    setShown(Object.fromEntries(statColumns.map(({ key }) => [key, categoryKeys.has(key)])));
  };

  if (!ready) {
    const fa = tradeMode === 'freeAgent';
    return (
      <Card>
        <div className="mr-trade-empty">
          <div aria-hidden="true">{fa ? '🔍' : '🔄'}</div>
          <p><b>{fa ? 'No Comparison Selected' : 'No Trade Selected'}</b></p>
          <p className="mr-meta">{fa ? 'Select players from your team and free agents to see comparison' : 'Select players from both teams to see trade analysis'}</p>
        </div>
      </Card>
    );
  }

  const valueOf = (row: SideRow, col: StatColumn) => (col.extraCategory !== undefined ? row.extras[col.extraCategory] : row.fixed[col.key]);
  const tone = (mine: number | null, other: number | null, lowerIsBetter = false) => {
    if (mine === null || other === null || mine === other) return '';
    return (lowerIsBetter ? mine < other : mine > other) ? 'mr-trade-up' : 'mr-trade-dn';
  };
  const otherOf = (row: SideRow) => rows.find((r) => r.id !== row.id)!;

  const visible = statColumns.filter((c) => isShown(c.key));
  const columns: Column<SideRow>[] = [
    { key: 'side', header: '', headerLabel: 'Side', pinned: true, cell: (r) => <span title={r.label}>{r.label}</span>, className: 'mr-trade-side' },
    ...(showZ ? [{
      key: 'z', header: 'AVG Z',
      cell: (r: SideRow) => {
        const other = otherOf(r).z;
        const tie = r.z !== null && other !== null && signedZ(r.z) === signedZ(other);
        return <span className={tie ? '' : tone(r.z, other)}>{r.z === null ? '—' : signedZ(r.z)}</span>;
      },
    }] : []),
    ...visible.map((c): Column<SideRow> => ({
      key: c.key,
      header: c.label,
      cell: (r) => {
        const lower = c.extraCategory !== undefined && KNOWN_REVERSE_CATEGORIES.has(c.extraCategory);
        const v = valueOf(r, c);
        const other = valueOf(otherOf(r), c);
        const field = c.extraCategory !== undefined ? 'extra' : c.key;
        const text = formatMobileStat(field, v, viewMode, 100);
        // Same number on screen reads as a tie, so no color for it.
        const tie = text === formatMobileStat(field, other, viewMode, 100);
        return <span className={tie ? '' : tone(v, other, lower)}>{text}</span>;
      },
    })),
  ];

  // Share card (unchanged from desktop): each column is what that team receives.
  const isTeamTrade = tradeMode === 'team';
  const teamAName = teamA?.team_name ?? 'Your team';
  const teamBName = teamB?.team_name ?? 'Team B';
  const shareRows = isTeamTrade ? tradeShareRows(playersB, playersA, viewMode) : tradeShareRows(playersA, playersB, viewMode);
  const sharePlayers = (players: Player[]) => players.map((p) => ({ name: p.player_name, value: playerValue?.(p) }));
  const shareSides: [TradeShareSide, TradeShareSide] = isTeamTrade
    ? [{ heading: `${teamAName} gets`, players: sharePlayers(playersB) }, { heading: `${teamBName} gets`, players: sharePlayers(playersA) }]
    : [{ heading: 'Drop', players: sharePlayers(playersA) }, { heading: 'Add', players: sharePlayers(playersB) }];
  const mySide = !isTeamTrade || myTeamId === null ? null : teamA?.team_id === myTeamId ? 0 : teamB?.team_id === myTeamId ? 1 : null;
  const shareTitle = isTeamTrade ? `${teamAName} ⇄ ${teamBName}` : `${teamAName} pickup check`;

  return (
    <Card
      className="mr-trade-sum"
      title={tradeMode === 'freeAgent' ? '📊 Player Comparison: Your Team vs Free Agents' : '📊 Trade Comparison'}
      action={
        <ShareCardButton
          title={isTeamTrade ? 'Trade Analysis' : 'Pickup Check'}
          highlightOption={mySide !== null}
          renderCard={({ dark, highlightMyTeam }) => (
            <TradeShareCard
              dark={dark}
              title={shareTitle}
              subtitle={`${periodLabel} · ${viewMode} · as of ${formatAsOf()}`}
              sides={shareSides}
              rows={shareRows}
              mode={viewMode}
              highlightSide={highlightMyTeam ? mySide : null}
            />
          )}
        />
      }
    >
      <DataTable caption="Trade comparison" columns={columns} rows={rows} rowKey={(r) => r.id} />
      <div className="mr-trade-colbar">
        <button type="button" className="mr-link" onClick={columnsSheet.show} aria-haspopup="dialog">Show/Hide Columns</button>
        <Chip selected={categoriesOnly} onClick={toggleCategoriesOnly} title="Show only the scoring categories; tap again for the columns you had before">
          {categoryKeys.size} cats only
        </Chip>
      </div>
      <BottomSheet
        open={columnsSheet.open}
        onClose={columnsSheet.hide}
        title="Show/Hide Columns"
        action={<button type="button" className="mr-link" onClick={columnsSheet.hide}>Done</button>}
      >
        <div className="mr-trade-colbtns">
          <Button size="sm" onClick={() => setAll(true)}>Show All</Button>
          <Button size="sm" onClick={() => setAll(false)}>Hide All</Button>
        </div>
        <div className="mr-trade-colgrid">
          {statColumns.map((c) => (
            <label key={c.key} className="mr-trade-colopt">
              <input type="checkbox" checked={isShown(c.key)} onChange={() => toggleColumn(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </BottomSheet>
    </Card>
  );
}

/** Sticky Avg Z summary above the tab bar, once both sides have players. */
export function TradeAvgZBar(props: TradeComparisonProps) {
  const { rows, ready, showZ } = buildTradeComparison(props);
  if (!ready || !showZ || rows.every((r) => r.z === null)) return null;
  const [a, b] = rows;
  const cls = (mine: number | null, other: number | null) =>
    mine === null || other === null || mine === other ? '' : mine > other ? 'mr-trade-up' : 'mr-trade-dn';
  return (
    <div className="mr-trade-sticky" role="status" aria-label="Average Z-score per side">
      <span className="mr-trade-sticky-k">Avg Z</span>
      {[a, b].map((r) => (
        <b key={r.id}>
          <span className="mr-trade-sticky-name">{r.label}</span>{' '}
          <span className={`mr-num ${cls(r.z, (r.id === 'A' ? b : a).z)}`}>{r.z === null ? '—' : signedZ(r.z)}</span>
        </b>
      ))}
    </div>
  );
}
