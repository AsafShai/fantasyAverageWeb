export type StreakState = {
  currentStreak: number
  bestStreak: number
  runHintsUsed: number
  minHintsForBestTie: number | null
}

export function createStreakState(): StreakState {
  return {
    currentStreak: 0,
    bestStreak: 0,
    runHintsUsed: 0,
    minHintsForBestTie: null,
  }
}

/** Port of applyStreakOnRoundWin / on_round_win. Mutates and returns state. */
export function onRoundWin(d: StreakState): StreakState {
  const previousBest = d.bestStreak
  const newStreak = d.currentStreak + 1
  const runHintsAtThisWin = d.runHintsUsed

  if (newStreak > previousBest) {
    return {
      ...d,
      bestStreak: newStreak,
      currentStreak: newStreak,
      minHintsForBestTie: runHintsAtThisWin,
    }
  }
  if (newStreak === previousBest && previousBest > 0) {
    const prev = d.minHintsForBestTie
    return {
      ...d,
      currentStreak: newStreak,
      minHintsForBestTie:
        prev == null ? runHintsAtThisWin : Math.min(prev, runHintsAtThisWin),
    }
  }
  return { ...d, currentStreak: newStreak }
}

export function onRoundLoss(d: StreakState): StreakState {
  return { ...d, currentStreak: 0, runHintsUsed: 0 }
}

export function incrementHints(d: StreakState): StreakState {
  return { ...d, runHintsUsed: d.runHintsUsed + 1 }
}
