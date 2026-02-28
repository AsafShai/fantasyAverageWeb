import { useState, useEffect, useCallback } from 'react';
import { InjuryRecord, InjuryNotification } from '../types/injury';
import { useInjuryNotifications } from './useInjuryNotifications';
import { StoredNotification } from '../types/injury';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';

function applyNotificationToRecords(
  records: InjuryRecord[],
  notif: InjuryNotification,
): InjuryRecord[] {
  switch (notif.type) {
    case 'added': {
      const exists = records.some(r => r.team === notif.team && r.player === notif.player);
      if (exists) return records;
      return [
        ...records,
        {
          game: '',
          team: notif.team,
          player: notif.player,
          status: notif.new_status ?? '',
          injury: '',
          last_update: notif.timestamp,
        },
      ];
    }
    case 'removed':
      return records.filter(r => !(r.team === notif.team && r.player === notif.player));

    case 'status_change':
      return records.map(r =>
        r.team === notif.team && r.player === notif.player
          ? { ...r, status: notif.new_status ?? r.status, last_update: notif.timestamp }
          : r,
      );

    default:
      return records;
  }
}

export function useInjuryData(): {
  records: InjuryRecord[];
  loading: boolean;
  error: string | null;
  notifications: StoredNotification[];
} {
  const [records, setRecords] = useState<InjuryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { notifications, addNotification } = useInjuryNotifications();

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/injuries`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InjuryRecord[] = await res.json();
      setRecords(data);
      setError(null);
    } catch {
      setError('Failed to load injury data. Retrying on reconnect.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // SSE subscription
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/injuries/stream`);

    es.onmessage = event => {
      try {
        const notif: InjuryNotification = JSON.parse(event.data as string);
        setRecords(prev => applyNotificationToRecords(prev, notif));
        addNotification(notif);
      } catch {
        // Malformed event — ignore
      }
    };

    es.onerror = () => {
      // Browser auto-reconnects; refresh the full table once the connection is back
      es.addEventListener('open', () => fetchAll(), { once: true });
    };

    return () => es.close();
  }, [addNotification, fetchAll]);

  return { records, loading, error, notifications };
}
