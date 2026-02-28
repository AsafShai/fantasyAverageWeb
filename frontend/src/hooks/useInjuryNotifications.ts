import { useState, useCallback } from 'react';
import type { InjuryNotification, StoredNotification } from '../types/injury';

const MAX_NOTIFICATIONS = 150;

function toStored(notif: InjuryNotification): StoredNotification {
  return {
    ...notif,
    id: crypto.randomUUID(),
    received_at: new Date().toLocaleString('he-IL'),
  };
}

export function useInjuryNotifications() {
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);

  const loadHistory = useCallback((past: InjuryNotification[]) => {
    setNotifications(past.map(toStored).slice(0, MAX_NOTIFICATIONS));
  }, []);

  const addNotification = useCallback((notif: InjuryNotification) => {
    setNotifications(prev => [toStored(notif), ...prev].slice(0, MAX_NOTIFICATIONS));
  }, []);

  return { notifications, loadHistory, addNotification };
}
