import { createAction } from "@reduxjs/toolkit";
import type { Actor, Grant, SessionUser } from "./types";

/**
 * The typed actions for the app-level state. They live here so hooks in state/ can dispatch them;
 * the reducers that handle them are in shell/state.
 */
export const sessionActions = {
  signedIn: createAction<SessionUser>("session/signedIn"),
  signedOut: createAction("session/signedOut"),
};

export const accessActions = {
  enable: createAction("access/enable"),
  disable: createAction("access/disable"),
  loading: createAction("access/loading"),
  loaded: createAction<{ grants: Grant[]; activeGrantId: string | null }>("access/loaded"),
  activeGrantChanged: createAction<string>("access/activeGrantChanged"),
};

export const impersonationActions = {
  entered: createAction<{ actor: Actor; returnTo: string }>("impersonation/entered"),
  returnedTo: createAction<number>("impersonation/returnedTo"),
  exited: createAction("impersonation/exited"),
};
