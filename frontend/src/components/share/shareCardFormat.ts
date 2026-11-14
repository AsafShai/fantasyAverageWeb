// Formatting shared by the share-card layouts. Cards are 400px wide, so
// values are shorter than the on-page tables (which show 4 decimals).

import { categoryTone } from '../../pages/Trade/utils/tradeCategoryZ';

const PERCENTAGE_CATEGORIES = new Set(['FG%', 'FT%', '3P%', 'AFG%']);

export const isPercentageCategory = (category: string) => PERCENTAGE_CATEGORIES.has(category);

/** "2026-10-19" → "Oct 19, 2026"; anything else (or nothing) passes through
 * so a backend-formatted date still shows as-is. */
export function formatAsOf(date?: string, now: Date = new Date()): string {
  const toLabel = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!date) return toLabel(now);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? toLabel(new Date(date + 'T00:00:00')) : date;
}

/** Percentages accept either a 0-1 fraction (backend) or 0-100 (trade
 * aggregates) and show one decimal: 0.4791 / 47.91 → "47.9". */
export function formatPercent(value: number): string {
  return (value <= 1 ? value * 100 : value).toFixed(1);
}

/** A category value for a compact card cell. Totals above 10k collapse to
 * "12.3k" so a season's points total still fits its column. */
export function formatCardValue(category: string, value: number, mode: 'averages' | 'totals'): string {
  if (isPercentageCategory(category)) return formatPercent(value);
  if (mode === 'averages') return value.toFixed(1);
  return Math.abs(value) >= 10000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value).toString();
}

export const formatPoints = (value: number) => (value % 1 === 0 ? value.toString() : value.toFixed(1));

/** Tint for a category's roto points (the API's `category_ranks`: 1 for
 * last up to `teamCount` for first): top 3 good, bottom 3 bad. */
export function rotoTone(points: number | undefined, teamCount: number): 'good' | 'bad' | null {
  if (points === undefined) return null;
  if (points > teamCount - 3) return 'good';
  if (points <= 3) return 'bad';
  return null;
}

/** Roto points in a category → league place: 12 of 12 teams → 1st. */
export const rotoPlace = (points: number, teamCount: number) => Math.max(1, Math.round(teamCount + 1 - points));

/** One category row of the trade card: each side's combined value. */
export interface TradeShareRow {
  category: string;
  values: [number, number];
  lowerIsBetter?: boolean;
  /** When set, win coloring uses category Z instead of raw `values`. */
  zValues?: [number | null, number | null];
  /** FG / FT made–attempted line for each side. */
  madeAtt?: [string, string];
  /** FG / FT percentage line for each side. */
  pctLine?: [string, string];
}

/** Index of the better side for a row, or null on a tie. */
export const rowWinner = (row: TradeShareRow): 0 | 1 | null => {
  if (row.zValues) {
    const tone = categoryTone(row.zValues[0], row.zValues[1]);
    return tone === 'win' ? 0 : tone === 'lose' ? 1 : null;
  }
  const { values: [a, b], lowerIsBetter } = row;
  if (a === b) return null;
  return (a > b) !== !!lowerIsBetter ? 0 : 1;
};

const signedZ = (z: number) => `${z >= 0 ? '+' : ''}${z.toFixed(2)}`;

export interface TradeShareCellLines {
  main: string;
  attempts?: string;
  z?: string;
}

/** Lines in a trade share cell (main stat vs neutral sublines). */
export function tradeShareCellLines(row: TradeShareRow, side: 0 | 1, mode: 'averages' | 'totals'): TradeShareCellLines {
  const z = row.zValues?.[side];
  if (row.madeAtt) {
    return {
      main: row.pctLine?.[side] ?? '—',
      attempts: row.madeAtt[side],
      z: z != null ? `Z ${signedZ(z)}` : undefined,
    };
  }
  return {
    main: formatCardValue(row.category, row.values[side], mode),
    z: z != null ? `Z ${signedZ(z)}` : undefined,
  };
}

/** Text in a trade share cell: shooting lines or stat + optional Z. */
export function formatTradeShareCell(row: TradeShareRow, side: 0 | 1, mode: 'averages' | 'totals'): string {
  const { main, attempts, z } = tradeShareCellLines(row, side, mode);
  return [main, attempts, z].filter(Boolean).join('\n');
}
