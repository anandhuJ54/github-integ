import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { store } from "@v3/state/store";

/** Everything the app mounts around the router: the central store. */
export function AppProviders({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}
