import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

export interface UrlParam<T> {
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
  default: T;
}

export type UrlSchema<V> = { [K in keyof V]: UrlParam<V[K]> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function stringParam(defaultValue = ''): UrlParam<string> {
  return { parse: (raw) => raw, serialize: (value) => value, default: defaultValue };
}

export function enumParam<T extends string>(
  allowed: readonly T[],
  defaultValue: T,
): UrlParam<T> {
  return {
    parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : undefined),
    serialize: (value) => value,
    default: defaultValue,
  };
}

export function csvParam<T extends string>(
  allowed: readonly T[],
  defaultValue: T[] = [],
): UrlParam<T[]> {
  return {
    parse: (raw) => {
      const items = raw
        .split(',')
        .map((part) => part.trim())
        .filter((part): part is T => allowed.includes(part as T));
      return items.length > 0 ? items : undefined;
    },
    serialize: (value) => value.join(','),
    default: defaultValue,
  };
}

export function boolParam(defaultValue: boolean): UrlParam<boolean> {
  return {
    parse: (raw) => (raw === '1' ? true : raw === '0' ? false : undefined),
    serialize: (value) => (value ? '1' : '0'),
    default: defaultValue,
  };
}

export function intParam(defaultValue: number, allowed?: readonly number[]): UrlParam<number> {
  return {
    parse: (raw) => {
      if (raw.trim() === '') return undefined;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed)) return undefined;
      if (allowed && !allowed.includes(parsed)) return undefined;
      return parsed;
    },
    serialize: (value) => String(value),
    default: defaultValue,
  };
}

export function isoDateParam(defaultValue = ''): UrlParam<string> {
  return {
    parse: (raw) => (ISO_DATE.test(raw) ? raw : undefined),
    serialize: (value) => value,
    default: defaultValue,
  };
}

export function useUrlState<V extends Record<string, unknown>>(
  schema: UrlSchema<V>,
): [V, (patch: Partial<V>) => void, ReadonlySet<string>] {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.toString();

  const values = useMemo(() => {
    const params = new URLSearchParams(query);
    const parsed = {} as V;
    for (const key of Object.keys(schema) as (keyof V & string)[]) {
      const param = schema[key];
      const raw = params.get(key);
      const value = raw === null ? undefined : param.parse(raw);
      parsed[key] = value === undefined ? param.default : value;
    }
    return parsed;
  }, [query, schema]);

  const [initialKeys] = useState<ReadonlySet<string>>(
    () => new Set([...new URLSearchParams(query).keys()].filter((key) => key in schema)),
  );

  const setValues = useCallback(
    (patch: Partial<V>) => {
      const next = new URLSearchParams(searchParams);
      for (const key of Object.keys(patch) as (keyof V & string)[]) {
        const param = schema[key];
        const value = patch[key] as V[keyof V & string];
        const raw = param.serialize(value);
        if (raw === '' || raw === param.serialize(param.default)) next.delete(key);
        else next.set(key, raw);
      }
      if (next.toString() === searchParams.toString()) return;
      setSearchParams(next, { replace: true });
    },
    [schema, searchParams, setSearchParams],
  );

  return [values, setValues, initialKeys];
}
