import { POSITION_PILL_CLASS } from './positionColors'

export default function PositionPills({
  positions,
  nowrap = false,
}: {
  positions: string[]
  nowrap?: boolean
}) {
  if (!positions.length) return <span className="text-gray-400">—</span>
  return (
    <span className={`inline-flex items-center gap-0.5 ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      {positions.map((pos) => (
        <span
          key={pos}
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold leading-none whitespace-nowrap ${POSITION_PILL_CLASS[pos] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}
        >
          {pos}
        </span>
      ))}
    </span>
  )
}
