import type { DepthChartPosition } from '../types/api';

const OUT_STATUS = 'Out';
const MAX_DEPTH = 5;

export function applyDepthChartFilters(
  positions: DepthChartPosition[],
  hideInjured: boolean,
  removeDuplicates: boolean
): DepthChartPosition[] {
  let result = positions.map((pos) => ({ ...pos, players: [...pos.players] }));

  if (hideInjured) {
    result = result.map((pos) => ({
      ...pos,
      players: pos.players.filter((p) => p.injury?.status !== OUT_STATUS),
    }));
  }

  if (removeDuplicates) {
    result = deduplicatePlayers(result);
  }

  return result.map((pos) => ({
    ...pos,
    players: pos.players.slice(0, MAX_DEPTH),
  }));
}

function deduplicatePlayers(positions: DepthChartPosition[]): DepthChartPosition[] {
  const playerBestPosition = new Map<string, { positionIndex: number; rankInPosition: number }>();

  positions.forEach((pos, positionIndex) => {
    pos.players.forEach((player, rankInPosition) => {
      const existing = playerBestPosition.get(player.id);
      const isBetter =
        !existing ||
        rankInPosition < existing.rankInPosition ||
        (rankInPosition === existing.rankInPosition && positionIndex < existing.positionIndex);

      if (isBetter) {
        playerBestPosition.set(player.id, { positionIndex, rankInPosition });
      }
    });
  });

  return positions.map((pos, positionIndex) => ({
    ...pos,
    players: pos.players.filter(
      (player) => playerBestPosition.get(player.id)?.positionIndex === positionIndex
    ),
  }));
}
