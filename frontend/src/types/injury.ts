export interface InjuryRecord {
  game: string;
  team: string;
  player: string;
  status: string;
  injury: string;
  last_update: string;
  game_time_utc?: string | null;
}

export interface InjuryNotification {
  type: 'status_change' | 'added' | 'removed';
  player: string;
  team: string;
  old_status?: string;
  new_status?: string;
  timestamp: string;
}

export interface StoredNotification extends InjuryNotification {
  id: string;
  received_at: string;
}
