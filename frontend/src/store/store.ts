import { configureStore } from '@reduxjs/toolkit';
import { fantasyApi } from './api/fantasyApi';

export const store = configureStore({
  reducer: {
    [fantasyApi.reducerPath]: fantasyApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(fantasyApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;