import { createSlice } from "@reduxjs/toolkit";
import { impersonationActions, sessionActions } from "@v3/state/actions";
import { readStored } from "@v3/state/persist";
import { IMPERSONATION_STORAGE_KEY } from "@v3/state/persist-rules";
import { DEFAULT_RETURN } from "@v3/state/impersonation/impersonation";
import type { ImpersonationState } from "@v3/state/types";

/** The stack saved in this tab's sessionStorage, if it is well formed. */
function read(): ImpersonationState {
  const empty: ImpersonationState = { stack: [], returnTo: DEFAULT_RETURN };
  try {
    const raw = readStored("session", IMPERSONATION_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as ImpersonationState;
    if (!Array.isArray(parsed.stack)) return empty;
    return { stack: parsed.stack, returnTo: parsed.returnTo || DEFAULT_RETURN };
  } catch {
    return empty;
  }
}

export const impersonationSlice = createSlice({
  name: "impersonation",
  initialState: read,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(impersonationActions.entered, (state, action) => {
        if (state.stack.length === 0) state.returnTo = action.payload.returnTo;
        state.stack.push(action.payload.actor);
      })
      .addCase(impersonationActions.returnedTo, (state, action) => {
        state.stack = state.stack.slice(0, action.payload + 1);
      })
      .addCase(impersonationActions.exited, () => ({ stack: [], returnTo: DEFAULT_RETURN }))
      .addCase(sessionActions.signedOut, () => ({ stack: [], returnTo: DEFAULT_RETURN }));
  },
});
