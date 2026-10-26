import { createSlice } from "@reduxjs/toolkit";
import { sessionActions } from "@v3/state/actions";
import type { SessionState } from "@v3/state/types";

const initialState: SessionState = { status: "loading", user: null };

export const sessionSlice = createSlice({
  name: "session",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(sessionActions.signedIn, (state, action) => {
        state.status = "authed";
        state.user = action.payload;
      })
      .addCase(sessionActions.signedOut, (state) => {
        state.status = "anon";
        state.user = null;
      });
  },
});
