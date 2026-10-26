import type { PersistRule } from "./persist";
import { GRANT_STORAGE_KEY, ROLE_STORAGE_KEY } from "./access/thunks";

export const IMPERSONATION_STORAGE_KEY = "xp.impersonation.v1";

/** What the app-level state remembers across reloads. The session and tokens are never listed here. */
export const appPersistRules: PersistRule[] = [
  { kind: "local", key: GRANT_STORAGE_KEY, select: (s) => s.access.activeGrantId },
  {
    kind: "local",
    key: ROLE_STORAGE_KEY,
    select: (s) => s.access.grants.find((g) => g.id === s.access.activeGrantId)?.role ?? null,
  },
  {
    kind: "session",
    key: IMPERSONATION_STORAGE_KEY,
    clearOnNull: true,
    select: (s) =>
      s.impersonation.stack.length
        ? JSON.stringify({ stack: s.impersonation.stack, returnTo: s.impersonation.returnTo })
        : null,
  },
];
