import { useState, useCallback } from 'react';
import { InjuryNotification, StoredNotification } from '../types/injury';

const STORAGE_KEY = 'injury_notifications';
const MAX_NOTIFICATIONS = 50;

function loadFromStorage(): StoredNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredNotification[]) : [];
  } catch {
    return [];
  }
}

export function useInjuryNotifications() {
  const [notifications, setNotifications] = useState<StoredNotification[]>(loadFromStorage);

  const addNotification = useCallback((notif: InjuryNotification) => {
    const stored: StoredNotification = {
      ...notif,
      id: crypto.randomUUID(),
      received_at: new Date().toLocaleString('he-IL'),
    };
    setNotifications(prev => {
      const updated = [stored, ...prev].slice(0, MAX_NOTIFICATIONS);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // localStorage full or unavailable — continue in-memory only
      }
      return updated;
    });
  }, []);

  return { notifications, addNotification };
}
