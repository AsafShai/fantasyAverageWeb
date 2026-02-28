interface Filters {
  search: string;
  team: string;
  status: string;
}

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  teams: string[];
}

const STATUSES = ['Out', 'Questionable', 'Doubtful', 'Game Time Decision', 'Available'];

export default function InjuryFilters({ filters, onChange, teams }: Props) {
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <input
        type="text"
        placeholder="Search player..."
        value={filters.search}
        onChange={e => onChange({ ...filters, search: e.target.value })}
        className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-48"
      />

      <select
        value={filters.team}
        onChange={e => onChange({ ...filters, team: e.target.value })}
        className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="">All Teams</option>
        {teams.map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <select
        value={filters.status}
        onChange={e => onChange({ ...filters, status: e.target.value })}
        className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="">All Statuses</option>
        {STATUSES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
