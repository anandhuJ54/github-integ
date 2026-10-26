import type { Slice } from "@reduxjs/toolkit";
import { rootReducer, store } from "./store";

/**
 * Register a slice with the central store. A Surface calls this from <surface>/src/state/index.ts, so
 * its state is added the first time its code loads. Registering the same slice twice is a no-op.
 */
export function injectSlice<S extends Slice>(slice: S): S {
  // The slice's own `reducerPath` is its name; typing of lazily declared slices is per Surface.
  (rootReducer as unknown as { inject: (s: Slice) => void }).inject(slice);
  // A slice's state only appears once an action has passed through the reducer.
  store.dispatch({ type: `state/inject/${slice.name}` });
  return slice;
}
