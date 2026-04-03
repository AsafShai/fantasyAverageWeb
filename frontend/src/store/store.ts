import { configureStore } from '@reduxjs/toolkit';
import { fantasyApi } from './api/fantasyApi';

const DEV_CHECK_MS = 500;

export const store = configureStore({
  reducer: {
    [fantasyApi.reducerPath]: fantasyApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      ...(import.meta.env.DEV
        ? {
            serializableCheck: { warnAfter: DEV_CHECK_MS },
            immutableCheck: { warnAfter: DEV_CHECK_MS },
          }
        : {}),
    }).concat(fantasyApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;