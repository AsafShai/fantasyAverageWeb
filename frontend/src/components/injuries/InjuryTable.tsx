import { InjuryRecord } from '../../types/injury';

const STATUS_STYLES: Record<string, string> = {
  'Out': 'bg-red-100 text-red-800',
  'Questionable': 'bg-yellow-100 text-yellow-800',
  'Doubtful': 'bg-orange-100 text-orange-800',
  'Game Time Decision': 'bg-blue-100 text-blue-800',
  'Available': 'bg-green-100 text-green-800',
};

function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700';
}

interface Props {
  records: InjuryRecord[];
  totalCount: number;
}

export default function InjuryTable({ records, totalCount }: Props) {
  if (totalCount === 0) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        No injury data available
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        No results match your filters
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['Team', 'Game', 'Player', 'Status', 'Injury', 'Last Update'].map(col => (
              <th
                key={col}
                className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {records.map((r, i) => (
            <tr key={`${r.team}|${r.player}|${i}`} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{r.team}</td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.game || '—'}</td>
              <td className="px-4 py-3 text-gray-800 whitespace-nowrap">{r.player}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle(r.status)}`}>
                  {r.status}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600">{r.injury || '—'}</td>
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{r.last_update}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
