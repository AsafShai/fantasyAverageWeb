import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';

const PREFIX = 'fw:';

function readStorage<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? defaultValue : (JSON.parse(raw) as T);
  } catch {
    return defaultValue;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // private browsing / quota exceeded — persistence is best-effort
  }
}

/**
 * Like useState, but the value is read from localStorage on mount and
 * written back on every change. Falls back to defaultValue when storage
 * is unavailable or corrupted.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStorage(key, defaultValue));

  useEffect(() => {
    writeStorage(key, value);
  }, [key, value]);

  return [value, setValue];
}

/**
 * Set<T> variant of usePersistedState — Sets don't survive JSON.stringify,
 * so this stores/reads them as arrays under the hood.
 */
export function usePersistedSetState<T>(
  key: string,
  defaultValue: Set<T>
): [Set<T>, Dispatch<SetStateAction<Set<T>>>] {
  const [value, setValue] = useState<Set<T>>(
    () => new Set(readStorage<T[]>(key, [...defaultValue]))
  );

  useEffect(() => {
    writeStorage(key, [...value]);
  }, [key, value]);

  return [value, setValue];
}
