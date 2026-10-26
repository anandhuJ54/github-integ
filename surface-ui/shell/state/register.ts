import { injectSlice } from "@v3/state/inject";
import { persistOnChange } from "@v3/state/persist";
import { appPersistRules } from "@v3/state/persist-rules";
import { store } from "@v3/state/store";
import { accessSlice } from "./access.slice";
import { impersonationSlice } from "./impersonation.slice";
import { sessionSlice } from "./session.slice";

let registered = false;

/** Add the app-level slices to the central store and start remembering what the rules select. */
export function registerAppState(): void {
  if (registered) return;
  registered = true;
  injectSlice(sessionSlice);
  injectSlice(accessSlice);
  injectSlice(impersonationSlice);
  persistOnChange(appPersistRules, store);
}
