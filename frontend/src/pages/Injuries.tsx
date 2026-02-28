import { useMemo, useState } from 'react';
import { useInjuryData } from '../hooks/useInjuryData';
import { useDebounce } from '../hooks/useDebounce';
import InjuryFilters from '../components/injuries/InjuryFilters';
import InjuryTable from '../components/injuries/InjuryTable';
import NotificationsPanel from '../components/injuries/NotificationsPanel';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

interface Filters {
  search: string;
  team: string;
  status: string;
}

export default function Injuries() {
  const { records, loading, error, notifications } = useInjuryData();
  const [filters, setFilters] = useState<Filters>({ search: '', team: '', status: '' });
  const debouncedSearch = useDebounce(filters.search, 300);

  const teams = useMemo(() => {
    const unique = Array.from(new Set(records.map(r => r.team))).sort();
    return unique;
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchesSearch =
        !debouncedSearch ||
        r.player.toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchesTeam = !filters.team || r.team === filters.team;
      const matchesStatus = !filters.status || r.status === filters.status;
      return matchesSearch && matchesTeam && matchesStatus;
    });
  }, [records, debouncedSearch, filters.team, filters.status]);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Injury Report</h1>
        <p className="text-sm text-gray-500 mt-1">
          Live NBA injury statuses — updated every 15 minutes. Times shown in Israel time.
        </p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <div className="flex gap-4 items-start">
          {/* Left panel — filters + table */}
          <div className="flex-1 min-w-0">
            <InjuryFilters filters={filters} onChange={setFilters} teams={teams} />
            <InjuryTable records={filteredRecords} totalCount={records.length} />
            {records.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                Showing {filteredRecords.length} of {records.length} player(s)
              </p>
            )}
          </div>

          {/* Right panel — notifications */}
          <div className="w-72 shrink-0 sticky top-4" style={{ height: 'calc(100vh - 10rem)' }}>
            <NotificationsPanel notifications={notifications} />
          </div>
        </div>
      )}
    </div>
  );
}
