import { useEffect, useRef, useState } from 'react';

interface Filters {
  search: string;
  teams: string[];
  statuses: string[];
}

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  teams: string[];
}

const STATUSES = ['Out', 'Questionable', 'Doubtful', 'Probable', 'Available'];

function MultiSelectDropdown({
  options,
  selected,
  placeholder,
  onChange,
}: {
  options: string[];
  selected: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white dark:bg-gray-700 transition-colors ${
          selected.length > 0 ? 'border-blue-400 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
        }`}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span
            className="text-blue-400 hover:text-blue-600 ml-1"
            onClick={e => { e.stopPropagation(); onChange([]); }}
          >
            ✕
          </span>
        )}
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-48 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {options.map(opt => (
            <label
              key={opt}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-gray-600 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="accent-blue-500"
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InjuryFilters({ filters, onChange, teams }: Props) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <input
        type="text"
        placeholder="Search player..."
        value={filters.search}
        onChange={e => onChange({ ...filters, search: e.target.value })}
        className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400 w-full sm:w-48"
      />

      <MultiSelectDropdown
        options={STATUSES}
        selected={filters.statuses}
        placeholder="All Statuses"
        onChange={statuses => onChange({ ...filters, statuses })}
      />

      <MultiSelectDropdown
        options={teams}
        selected={filters.teams}
        placeholder="All Teams"
        onChange={selectedTeams => onChange({ ...filters, teams: selectedTeams })}
      />
    </div>
  );
}
