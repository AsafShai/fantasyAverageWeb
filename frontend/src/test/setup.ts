import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => {
    // Desktop by default (Tailwind `sm` = 640px): wide layout, not phone cards.
    let matches = false
    if (query.includes('max-width') && query.includes('639px')) matches = false
    else if (query.includes('max-width') && query.includes('1023px')) matches = false
    else if (query.includes('min-width') && query.includes('640px')) matches = true
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  }),
});
