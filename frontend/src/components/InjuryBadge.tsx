const STATUS_STYLE: Record<string, string> = {
  Out: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  Doubtful: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  Questionable: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  Probable: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
};

export default function InjuryBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const style = STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${style}`}>
      {status}
    </span>
  );
}
