import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../errorMessage';

const FALLBACK = 'Failed to load data.';

describe('getErrorMessage', () => {
  it('returns the detail from a 503 response', () => {
    const error = { status: 503, data: { detail: 'No data available yet for this league/season.' } };
    expect(getErrorMessage(error, FALLBACK)).toBe('No data available yet for this league/season.');
  });

  it('falls back to a specific 503 message when the response has no detail', () => {
    const error = { status: 503, data: {} };
    expect(getErrorMessage(error, FALLBACK)).toBe('No data available yet for this league/season.');
  });

  it('returns the detail from a 404 response', () => {
    const error = { status: 404, data: { detail: 'Team with ID 99 not found' } };
    expect(getErrorMessage(error, FALLBACK)).toBe('Team with ID 99 not found');
  });

  it('falls back to the generic fallback on a 404 with no detail', () => {
    const error = { status: 404, data: {} };
    expect(getErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back to the generic fallback on a 500 response, ignoring any detail', () => {
    const error = { status: 500, data: { detail: 'Internal server error' } };
    expect(getErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back to the generic fallback for a network/fetch error (string status)', () => {
    const error = { status: 'FETCH_ERROR', error: 'Failed to fetch' };
    expect(getErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back to the generic fallback for a SerializedError (RTK thunk rejection)', () => {
    const error = { name: 'Error', message: 'Something broke' };
    expect(getErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back to the generic fallback for null/undefined errors', () => {
    expect(getErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(getErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back to the generic fallback when detail is present but not a string', () => {
    const error = { status: 503, data: { detail: { nested: true } } };
    expect(getErrorMessage(error, FALLBACK)).toBe('No data available yet for this league/season.');
  });
});
