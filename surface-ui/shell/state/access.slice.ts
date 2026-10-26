import { createSlice } from "@reduxjs/toolkit";
import { accessActions, sessionActions } from "@v3/state/actions";
import type { AccessState } from "@v3/state/types";

const initialState: AccessState = { enabled: false, loading: true, grants: [], activeGrantId: null };

export const accessSlice = createSlice({
  name: "access",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(accessActions.enable, (state) => {
        state.enabled = true;
      })
      .addCase(accessActions.disable, (state) => {
        state.enabled = false;
      })
      .addCase(accessActions.loading, (state) => {
        state.loading = true;
      })
      .addCase(accessActions.loaded, (state, action) => {
        state.grants = action.payload.grants;
        state.activeGrantId = action.payload.activeGrantId;
        state.loading = false;
      })
      .addCase(accessActions.activeGrantChanged, (state, action) => {
        state.activeGrantId = action.payload;
      })
      // Signing out drops the loaded grants. The remembered workspace stays in storage.
      .addCase(sessionActions.signedOut, (state) => {
        state.grants = [];
        state.activeGrantId = null;
        state.loading = true;
        state.enabled = false;
      });
  },
});
