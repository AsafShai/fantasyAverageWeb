/** Score line(s) in the lobby after a run ends. */
export default function MinigameRunOverSummary({
  bestStreak,
  hintsUsed,
}: {
  bestStreak: number | null | undefined
  hintsUsed?: number | null
}) {
  if (bestStreak == null) return null
  return (
    <div className="mb-3 space-y-1 text-center">
      <p className="text-lg text-gray-800 dark:text-gray-100">
        Run over — best streak: <strong>{bestStreak}</strong>
      </p>
      {hintsUsed != null && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Hints used this run: {hintsUsed}</p>
      )}
    </div>
  )
}
