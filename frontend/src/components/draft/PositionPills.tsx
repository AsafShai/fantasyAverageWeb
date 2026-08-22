const PILL: Record<string, string> = {
  PG: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  SG: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  SF: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  PF: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  C: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  G: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
  F: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
}

export default function PositionPills({ positions }: { positions: string[] }) {
  if (!positions.length) return <span className="text-gray-400">—</span>
  return (
    <span className="inline-flex flex-wrap gap-0.5">
      {positions.map((pos) => (
        <span
          key={pos}
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold leading-none ${PILL[pos] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}
        >
          {pos}
        </span>
      ))}
    </span>
  )
}
