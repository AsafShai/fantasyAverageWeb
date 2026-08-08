import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router';
import { fantasyApi } from '../store/api/fantasyApi';

export function createTestStore() {
  return configureStore({
    reducer: { [fantasyApi.reducerPath]: fantasyApi.reducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }).concat(
        fantasyApi.middleware,
      ),
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options: { store?: ReturnType<typeof createTestStore> } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { store = createTestStore(), ...renderOptions } = options;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <Provider store={store}>{children}</Provider>
      </MemoryRouter>
    );
  }
  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}
