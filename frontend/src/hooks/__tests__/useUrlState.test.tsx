import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  boolParam,
  csvParam,
  enumParam,
  intParam,
  isoDateParam,
  stringParam,
  useUrlState,
} from '../useUrlState';

const SCHEMA = {
  q: stringParam(),
  pos: csvParam(['PG', 'SG', 'SF', 'PF', 'C'] as const),
  period: enumParam(['season', 'last_7', 'last_30'] as const, 'season'),
  avg: boolParam(true),
  window: intParam(15, [7, 15, 30]),
  from: isoDateParam(),
};

function setup(initialEntry = '/players') {
  return renderHook(
    () => {
      const [values, setValues, initialKeys] = useUrlState(SCHEMA);
      return { values, setValues, initialKeys, search: useLocation().search };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      ),
    },
  );
}

describe('useUrlState', () => {
  it('parses every schema key from the query string', () => {
    const { result } = setup(
      '/players?q=luka&pos=PG,C&period=last_7&avg=0&window=7&from=2026-01-05',
    );
    expect(result.current.values).toEqual({
      q: 'luka',
      pos: ['PG', 'C'],
      period: 'last_7',
      avg: false,
      window: 7,
      from: '2026-01-05',
    });
  });

  it('falls back to defaults when keys are absent', () => {
    const { result } = setup();
    expect(result.current.values).toEqual({
      q: '',
      pos: [],
      period: 'season',
      avg: true,
      window: 15,
      from: '',
    });
  });

  it('falls back to defaults on invalid values', () => {
    const { result } = setup('/players?period=bogus&window=99&avg=maybe&pos=XX&from=05-01-2026');
    expect(result.current.values).toEqual({
      q: '',
      pos: [],
      period: 'season',
      avg: true,
      window: 15,
      from: '',
    });
  });

  it('writes non-default values to the query string', () => {
    const { result } = setup();
    act(() => result.current.setValues({ pos: ['C'], period: 'last_7', avg: false }));
    expect(result.current.search).toBe('?pos=C&period=last_7&avg=0');
  });

  it('omits defaults and drops keys that fall back to their default', () => {
    const { result } = setup('/players?pos=C&period=last_7&avg=0&window=7');
    act(() =>
      result.current.setValues({ pos: [], period: 'season', avg: true, window: 15, q: '' }),
    );
    expect(result.current.search).toBe('');
  });

  it('round-trips values through the URL', () => {
    const { result } = setup();
    const written = { q: 'ja', pos: ['SG', 'SF'] as const, period: 'last_30' as const, window: 30 };
    act(() => result.current.setValues({ ...written, pos: [...written.pos] }));
    expect(result.current.values).toMatchObject({ ...written, pos: [...written.pos] });
  });

  it('leaves unrelated query params untouched', () => {
    const { result } = setup('/players?team=3');
    act(() => result.current.setValues({ q: 'ja' }));
    expect(result.current.search).toBe('?team=3&q=ja');
  });

  it('reports which schema keys were present on first render', () => {
    const { result } = setup('/players?period=last_7&team=3');
    act(() => result.current.setValues({ q: 'ja' }));
    expect([...result.current.initialKeys]).toEqual(['period']);
  });
});
