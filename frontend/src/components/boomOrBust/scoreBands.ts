/** Cuts on the standard-normal score. 0 is the expected night. */
export function scoreTextClass(score: number): string {
  if (score <= -1.8) return 'text-red-600 dark:text-red-400';
  if (score < -1) return 'text-red-400 dark:text-red-300';
  if (score <= 1) return 'text-gray-500 dark:text-gray-400';
  if (score < 1.8) return 'text-blue-500 dark:text-blue-300';
  return 'text-blue-600 dark:text-blue-400';
}

/** Same bands as the score scale, for the bar beside the number. */
export function scoreBarClass(score: number): string {
  if (score <= -1.8) return 'bg-red-500';
  if (score < -1) return 'bg-red-300';
  if (score <= 1) return 'bg-gray-400';
  if (score < 1.8) return 'bg-blue-300';
  return 'bg-blue-500';
}
