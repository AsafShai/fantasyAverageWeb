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
  teams: string[];
  statuses: string[];
}

export default function Injuries() {
  const { records, loading, error, notifications } = useInjuryData();
  const [filters, setFilters] = useState<Filters>({ search: '', teams: [], statuses: [] });
  const [notifOpen, setNotifOpen] = useState(false);
  const debouncedSearch = useDebounce(filters.search, 300);

  const teams = useMemo(() => {
    const unique = Array.from(new Set(records.map(r => r.team))).sort();
    return unique;
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records
      .filter(r => {
        const matchesSearch =
          !debouncedSearch ||
          r.player.toLowerCase().includes(debouncedSearch.toLowerCase());
        const matchesTeam = filters.teams.length === 0 || filters.teams.includes(r.team);
        const matchesStatus = filters.statuses.length === 0 || filters.statuses.includes(r.status);
        return matchesSearch && matchesTeam && matchesStatus;
      })
      .sort((a, b) => b.last_update.localeCompare(a.last_update));
  }, [records, debouncedSearch, filters.teams, filters.statuses]);

  return (
    <>
      {/* Scoped styles for responsive height constraints */}
      <style>{`
        .injury-table-scroll { overflow-y: auto; }
        .injury-sidebar { min-height: 12rem; }
        @media (min-width: 1024px) {
          .injury-table-scroll { max-height: calc(100vh - 22rem); }
          .injury-sidebar { height: calc(100vh - 16rem); }
        }
      `}</style>

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-hidden lg:overflow-x-visible">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Injury Report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Live NBA injury statuses - updated every 15 minutes. Last update times shown in Israel time.
          </p>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage message={error} />
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Mobile-only collapsible notifications strip */}
            <div className="lg:hidden">
              <button
                type="button"
                onClick={() => setNotifOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-white border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700"
              >
                <span className="flex items-center gap-2">
                  <span>Notifications</span>
                  {notifications.length > 0 && (
                    <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {notifications.length}
                    </span>
                  )}
                </span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${notifOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {notifOpen && (
                <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden" style={{ maxHeight: '16rem' }}>
                  <NotificationsPanel notifications={notifications} />
                </div>
              )}
            </div>

            {/* Left panel — filters + table */}
            <div className="flex-1 min-w-0">
              <InjuryFilters filters={filters} onChange={setFilters} teams={teams} />
              <div className="injury-table-scroll">
                <InjuryTable records={filteredRecords} totalCount={records.length} />
              </div>
              {records.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  Showing {filteredRecords.length} of {records.length} player(s)
                </p>
              )}
            </div>

            {/* Desktop sidebar — notifications */}
            <div className="injury-sidebar hidden lg:block lg:w-72 lg:shrink-0">
              <NotificationsPanel notifications={notifications} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
