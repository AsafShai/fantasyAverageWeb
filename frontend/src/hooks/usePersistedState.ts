import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';

const PREFIX = 'fw:';
const SYNC_EVENT = 'fw:persisted-state';

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
 * is unavailable or corrupted. An initialOverride (e.g. a value carried in
 * the URL) takes precedence over what storage holds.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  initialOverride?: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    initialOverride === undefined ? readStorage(key, defaultValue) : initialOverride
  );

  useEffect(() => {
    writeStorage(key, value);
    // Tell other components using the same key (e.g. the live badge's No
    // spoilers toggle and the Daily roster on one page) so they follow at once.
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key, raw: JSON.stringify(value) } }));
  }, [key, value]);

  useEffect(() => {
    const onSync = (e: Event) => {
      const { key: changed, raw } = (e as CustomEvent<{ key: string; raw: string }>).detail;
      if (changed !== key) return;
      setValue(current => (JSON.stringify(current) === raw ? current : (JSON.parse(raw) as T)));
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [key]);

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
