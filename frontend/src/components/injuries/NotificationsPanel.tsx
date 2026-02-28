import type { StoredNotification } from '../../types/injury';

function fmtTimestamp(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function formatMessage(notif: StoredNotification): string {
  switch (notif.type) {
    case 'status_change':
      return `${notif.player} (${notif.team}): ${notif.old_status} → ${notif.new_status}`;
    case 'added':
      return `${notif.player} (${notif.team}): Added — ${notif.new_status}`;
    case 'removed':
      return `${notif.player} (${notif.team}): Removed`;
    default:
      return `${notif.player} (${notif.team})`;
  }
}

function typeIcon(type: StoredNotification['type']): string {
  switch (type) {
    case 'status_change': return '🔄';
    case 'added': return '➕';
    case 'removed': return '➖';
    default: return '📋';
  }
}

interface Props {
  notifications: StoredNotification[];
}

export default function NotificationsPanel({ notifications }: Props) {
  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-700">Notifications</h2>
        {notifications.length > 0 && (
          <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {notifications.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            No notifications yet
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map(n => (
              <li key={n.id} className="px-3 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex gap-2 items-start">
                  <span className="text-base leading-tight mt-0.5">{typeIcon(n.type)}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-800 leading-snug break-words">
                      {formatMessage(n)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtTimestamp(n.timestamp)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
