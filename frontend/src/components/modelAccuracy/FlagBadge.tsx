import type { ProjectionFlag } from '../../types/api'
import { FLAG_LABELS } from '../../utils/modelAccuracy'

const STYLES: Record<ProjectionFlag, string> = {
  up: 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40',
  down: 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40',
  flat: 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700',
}
const ICONS: Record<ProjectionFlag, string> = { up: '▲', down: '▼', flat: '●' }

const FlagBadge = ({ flag }: { flag: ProjectionFlag }) => (
  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${STYLES[flag]}`}>
    <span aria-hidden="true">{ICONS[flag]}</span>
    {FLAG_LABELS[flag]}
  </span>
)

export default FlagBadge
