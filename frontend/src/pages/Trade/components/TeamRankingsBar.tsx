import React from 'react';
import { getHeatmapColor, getTextColor } from '../../../utils/colorUtils';

interface TeamRankingsBarProps {
  categoryRanks: Record<string, number>;
}

const CATEGORIES = [
  { key: 'FG%', label: 'FG%' },
  { key: 'FT%', label: 'FT%' },
  { key: '3PM', label: '3PM' },
  { key: 'AST', label: 'AST' },
  { key: 'REB', label: 'REB' },
  { key: 'STL', label: 'STL' },
  { key: 'BLK', label: 'BLK' },
  { key: 'PTS', label: 'PTS' },
];

export const TeamRankingsBar: React.FC<TeamRankingsBarProps> = ({ categoryRanks }) => {
  const normalizeRank = (rank: number): number => {
    return (rank - 1) / 11;
  };

  return (
    <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50">
            {CATEGORIES.map((category) => (
              <th
                key={category.key}
                className="px-2 py-1 text-center font-semibold text-gray-700 border-r border-gray-200 last:border-r-0"
              >
                {category.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {CATEGORIES.map((category) => {
              const rank = categoryRanks[category.key] || 0;
              const normalizedValue = normalizeRank(rank);
              const backgroundColor = getHeatmapColor(normalizedValue);
              const textColor = getTextColor(normalizedValue);

              return (
                <td
                  key={category.key}
                  className="px-2 py-1.5 text-center font-bold border-r border-gray-200 last:border-r-0"
                  style={{
                    backgroundColor,
                    color: textColor,
                  }}
                >
                  {rank}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
};
