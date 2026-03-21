import { useState } from 'react';
import { useGetNbaTeamsListQuery, useGetNbaTeamDepthChartQuery } from '../store/api/fantasyApi';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import type { TeamDepthChart } from '../types/api';

const MAX_DEPTH = 5;
const DEPTH_LABELS = ['Starter', '2nd', '3rd', '4th', '5th'];

const INJURY_STYLES: Record<string, string> = {
  Out: 'bg-red-100 text-red-800',
  'Day-To-Day': 'bg-orange-100 text-orange-800',
  Questionable: 'bg-yellow-100 text-yellow-800',
  Doubtful: 'bg-orange-100 text-orange-800',
  Probable: 'bg-blue-100 text-blue-800',
};

function injuryStyle(status: string): string {
  return INJURY_STYLES[status] ?? 'bg-gray-100 text-gray-700';
}

function DepthChartTable({ data }: { data: TeamDepthChart }) {
  const positions = data.positions.map((pos) => ({
    ...pos,
    players: pos.players.slice(0, MAX_DEPTH),
  }));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {data.team_logo && (
          <img src={data.team_logo} alt={data.team_name} className="w-10 h-10 object-contain" />
        )}
        <div>
          <h2 className="text-xl font-bold text-gray-900">{data.team_name}</h2>
          <p className="text-sm text-gray-500">{data.record}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap w-36">Position</th>
              {DEPTH_LABELS.map((label) => (
                <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {positions.map((pos) => (
              <tr key={pos.abbreviation} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap w-36">
                  {pos.display_name}
                </td>
                {Array.from({ length: MAX_DEPTH }, (_, i) => {
                  const player = pos.players[i];
                  return (
                    <td key={i} className="px-4 py-2.5 whitespace-nowrap">
                      {player ? (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-800">{player.display_name}</span>
                          {player.injury && (
                            <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs font-semibold ${injuryStyle(player.injury.status)}`}>
                              {player.injury.status}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DepthChartView({ teamId }: { teamId: string }) {
  const { data, isLoading, error } = useGetNbaTeamDepthChartQuery(teamId);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Failed to load depth chart" />;
  if (!data) return null;

  return <DepthChartTable data={data} />;
}

export default function NbaTeams() {
  const { data: teams, isLoading, error } = useGetNbaTeamsListQuery();
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
          NBA Teams
        </h1>
        <p className="text-gray-600">Select a team to view their depth chart</p>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message="Failed to load teams" />
      ) : (
        <>
          <div className="mb-6">
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="w-full sm:w-72 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a team...</option>
              {teams?.map((team) => (
                <option key={team.team_id} value={team.team_id}>
                  {team.team_name}
                </option>
              ))}
            </select>
          </div>

          {selectedTeamId && <DepthChartView teamId={selectedTeamId} />}
        </>
      )}
    </div>
  );
}
