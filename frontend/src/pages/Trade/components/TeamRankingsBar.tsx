import React from 'react';
import { getHeatmapColor, getTextColor } from '../../../utils/colorUtils';

interface TeamRankingsBarProps {
  categoryRanks: Record<string, number>;
}

export const TeamRankingsBar: React.FC<TeamRankingsBarProps> = ({ categoryRanks }) => {
  // Column order/set comes straight from the API response (this league's
  // actual scoring categories), not a hardcoded 8-category list.
  const categoryKeys = Object.keys(categoryRanks)
  const teamCount = Object.keys(categoryRanks).length > 0
    ? Math.max(...Object.values(categoryRanks))
    : 1

  const normalizeRank = (rank: number): number => {
    return teamCount > 1 ? (rank - 1) / (teamCount - 1) : 0.5;
  };

  return (
    <div className="mb-3 border border-gray-200 rounded-lg overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50">
            {categoryKeys.map((key) => (
              <th
                key={key}
                className="px-2 py-1 text-center font-semibold text-gray-700 border-r border-gray-200 last:border-r-0"
              >
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {categoryKeys.map((key) => {
              const rank = categoryRanks[key] || 0;
              const normalizedValue = normalizeRank(rank);
              const backgroundColor = getHeatmapColor(normalizedValue);
              const textColor = getTextColor(normalizedValue);

              return (
                <td
                  key={key}
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
