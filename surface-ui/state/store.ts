import {
  combineSlices,
  configureStore,
  type Reducer,
  type ThunkAction,
  type UnknownAction,
} from "@reduxjs/toolkit";
import type { AppState, LazyLoadedSlices } from "./types";

// One central store. It starts with no reducers: shell/state registers the app-level slices and
// every Surface registers its own with `injectSlice` when its code loads.
export const rootReducer = combineSlices().withLazyLoadedSlices<LazyLoadedSlices>();

/** The app-level slices are always present once shell/state has registered them. */
export type RootState = AppState & ReturnType<typeof rootReducer>;

export const store = configureStore({ reducer: rootReducer as unknown as Reducer<RootState, UnknownAction> });

export type AppDispatch = typeof store.dispatch;
export type AppStore = typeof store;
export type AppThunk<R = void> = ThunkAction<R, RootState, unknown, UnknownAction>;
