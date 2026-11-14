import { useState } from 'react';
import { categoryTone, signedCategoryZ } from '../utils/tradeCategoryZ';
import { playerInitials, zEdgeBarPercent } from './tradeVersusMath';

export interface VersusSideDisplay {
  main: string;
  sub?: string;
  z: number | null;
}

export interface CategoryPlayerLine {
  name: string;
  playerId?: number | null;
  main: string;
  sub?: string;
  z: number | null;
}

export interface CategoryBreakdown {
  leftTitle: string;
  rightTitle: string;
  left: CategoryPlayerLine[];
  right: CategoryPlayerLine[];
}

export interface TradeVersusRowProps {
  label: string;
  pillClass?: string;
  left: VersusSideDisplay;
  right: VersusSideDisplay;
  compact?: boolean;
  /** When set, main stat color follows share winner instead of category Z. */
  mainWinner?: 0 | 1 | null;
  /** Z lines stay neutral (share). */
  muteZColor?: boolean;
  /** Compact vs chip (share) or the Z slider used on the live page. */
  vsStyle?: 'chip' | 'slider';
  breakdown?: CategoryBreakdown;
  expanded?: boolean;
  onToggle?: () => void;
  /** Largest Z gap among the rows shown together; bars are drawn to that scale. */
  maxZGap?: number;
}

const sideTone = (mine: number | null, other: number | null) => {
  const t = categoryTone(mine, other);
  if (t === 'win') return { main: 'tc-side-stat__main--win', z: 'tc-side-stat__z--win' };
  if (t === 'lose') return { main: 'tc-side-stat__main--lose', z: 'tc-side-stat__z--lose' };
  return { main: '', z: '' };
};

const formatZ = (z: number | null) => (z == null ? null : `${z >= 0 ? '+' : ''}${z.toFixed(2)}`);

export function PlayerFace({ name, playerId, size = 'row' }: { name: string; playerId?: number | null; size?: 'row' | 'chip' }) {
  const [failed, setFailed] = useState(false);
  const url = !failed && playerId != null && playerId > 0
    ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=96&h=70`
    : null;
  const photoClass = size === 'chip' ? 'tc-player-chip__photo' : 'tc-cat-player__photo';
  if (!url) {
    return <span className={`${photoClass} ${photoClass}--fallback`}>{playerInitials(name)}</span>;
  }
  return (
    <img
      className={photoClass}
      src={url}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function BreakdownSide({
  title,
  side,
  lines,
}: {
  title: string;
  side: 'left' | 'right';
  lines: CategoryPlayerLine[];
}) {
  return (
    <div>
      <div className="tc-cat-break__head">
        <span><i className={`tc-cat-break__dot tc-cat-break__dot--${side}`} aria-hidden />{title}</span>
        <span>Z in this cat</span>
      </div>
      <ul className="tc-cat-break__list">
        {lines.map(line => (
          <li key={line.name} className="tc-cat-player">
            <PlayerFace name={line.name} playerId={line.playerId} size="row" />
            <span className="tc-cat-player__name">{line.name}</span>
            <span className="tc-cat-player__stat">
              {line.main}
              {line.sub && <span className="tc-cat-player__sub">{line.sub}</span>}
            </span>
            <span className={`tc-cat-player__z${line.z != null && line.z < 0 ? ' is-neg' : ''}`}>
              {line.z == null ? '—' : `Z ${signedCategoryZ(line.z)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const TradeVersusRow = ({
  label,
  pillClass,
  left,
  right,
  mainWinner,
  muteZColor = true,
  vsStyle = 'chip',
  breakdown,
  expanded = false,
  onToggle,
  maxZGap,
}: TradeVersusRowProps) => {
  const leftTone = sideTone(left.z, right.z);
  const rightTone = sideTone(right.z, left.z);
  const leftMain = mainWinner === undefined
    ? leftTone.main
    : mainWinner === null
      ? ''
      : mainWinner === 0 ? 'tc-side-stat__main--win' : 'tc-side-stat__main--lose';
  const rightMain = mainWinner === undefined
    ? rightTone.main
    : mainWinner === null
      ? ''
      : mainWinner === 1 ? 'tc-side-stat__main--win' : 'tc-side-stat__main--lose';

  if (vsStyle === 'slider') {
    const zWinner = categoryTone(left.z, right.z);
    const winner = mainWinner === undefined
      ? zWinner
      : mainWinner === null ? 'tie' as const : mainWinner === 0 ? 'win' as const : 'lose' as const;
    const edge = winner === 'tie' ? 0 : zEdgeBarPercent(left.z, right.z, maxZGap);
    const edgeSide = winner === 'win' ? 'left' : 'right';
    const interactive = Boolean(onToggle && breakdown);
    const bar = (
      <>
          <span className={`tc-cat-pill tc-cat-pill--label${pillClass ? ` ${pillClass}` : ''}`}>{label}</span>
          <span className="tc-stat-block tc-stat-block--left">
            <span className={`tc-stat-block__main${winner === 'win' ? ' is-win' : winner === 'lose' ? ' is-lose' : ''}`}>{left.main}</span>
            {left.sub && <span className="tc-stat-block__sub">{left.sub}</span>}
          </span>
          <span className={`tc-z-inline${winner === 'win' ? ' tc-z-inline--left' : ''}`}>{formatZ(left.z) ?? '—'}</span>
          <span className="tc-z-slider" aria-hidden>
            <span className="tc-z-slider__track" />
            {edge > 0 && (
              <span
                className={`tc-z-slider__fill tc-z-slider__fill--${edgeSide}`}
                style={{ width: `${edge}%` }}
              />
            )}
            <span className="tc-z-slider__mid" />
          </span>
          <span className={`tc-z-inline${winner === 'lose' ? ' tc-z-inline--right' : ''}`}>{formatZ(right.z) ?? '—'}</span>
          <span className="tc-stat-block tc-stat-block--right">
            <span className={`tc-stat-block__main${winner === 'lose' ? ' is-win' : winner === 'win' ? ' is-lose' : ''}`}>{right.main}</span>
            {right.sub && <span className="tc-stat-block__sub">{right.sub}</span>}
          </span>
      </>
    );
    return (
      <div className={`tc-stat-row${expanded ? ' tc-stat-row--open' : ''}`}>
        {interactive ? (
          <button
            type="button"
            className="tc-stat-row__bar"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {bar}
          </button>
        ) : (
          <div className="tc-stat-row__bar">{bar}</div>
        )}
        {expanded && breakdown && (
          <div className="tc-cat-break">
            <BreakdownSide title={breakdown.leftTitle} side="left" lines={breakdown.left} />
            <BreakdownSide title={breakdown.rightTitle} side="right" lines={breakdown.right} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tc-versus-row" role="row">
      <div className={`tc-cat-pill${pillClass ? ` ${pillClass}` : ''}`}>{label}</div>
      <div className="tc-side-stat" role="cell">
        <div className={`tc-side-stat__main ${leftMain}`}>{left.main}</div>
        {left.sub && <div className="tc-side-stat__sub">{left.sub}</div>}
        {formatZ(left.z) && (
          <div className={`tc-side-stat__z${muteZColor ? '' : ` ${leftTone.z}`}`}>{formatZ(left.z)}</div>
        )}
      </div>
      <div className="tc-vs-chip" role="cell" aria-label={`${label} versus`}>vs</div>
      <div className="tc-side-stat" role="cell">
        <div className={`tc-side-stat__main ${rightMain}`}>{right.main}</div>
        {right.sub && <div className="tc-side-stat__sub">{right.sub}</div>}
        {formatZ(right.z) && (
          <div className={`tc-side-stat__z${muteZColor ? '' : ` ${rightTone.z}`}`}>{formatZ(right.z)}</div>
        )}
      </div>
    </div>
  );
};

/** Column labels over the category rows, on the same grid as each row. */
export function VersusHeaderRow({ valueLabel }: { valueLabel: string }) {
  return (
    <div className="tc-stat-row__bar tc-stat-row__bar--head" aria-hidden>
      <span>Cat</span>
      <span className="tc-stat-block--left">{valueLabel}</span>
      <span className="tc-z-head">Z</span>
      <span className="tc-z-head">
        <span className="tc-head-wide">Z edge</span>
        <span className="tc-head-narrow">Edge</span>
      </span>
      <span className="tc-z-head">Z</span>
      <span className="tc-stat-block--right">{valueLabel}</span>
    </div>
  );
}
