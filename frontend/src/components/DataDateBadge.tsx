interface DataDateBadgeProps {
  dataDate?: string
}

const DataDateBadge = ({ dataDate }: DataDateBadgeProps) => {
  if (!dataDate) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
      </svg>
      Data as of {dataDate}
    </span>
  )
}

export default DataDateBadge
