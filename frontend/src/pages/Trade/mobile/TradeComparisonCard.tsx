import { TradeSummaryPanel } from '../components/TradeSummaryPanel';
import type { TradeComparisonProps } from './comparison';
import type { ViewMode } from './format';
import '../trade-comparison.css';
import './trade-mobile.css';

export interface TradeComparisonCardProps extends TradeComparisonProps {
  setViewMode?: (mode: ViewMode) => void;
}

/** Mobile trade comparison — same versus board + detail grid as desktop. */
export function TradeComparisonCard({
  teamA,
  teamB,
  playersA,
  playersB,
  viewMode,
  tradeMode,
  periodLabel,
  playerValue,
  tradeRanking,
  setViewMode,
}: TradeComparisonCardProps) {
  return (
    <div className="mr-trade-versus">
      <TradeSummaryPanel
        teamA={teamA}
        teamB={teamB}
        playersA={playersA}
        playersB={playersB}
        viewMode={viewMode}
        tradeMode={tradeMode}
        periodLabel={periodLabel}
        playerValue={playerValue}
        tradeRanking={tradeRanking}
        onViewModeChange={setViewMode}
      />
    </div>
  );
}