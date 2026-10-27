import type { SessionUser } from "../../types";
import type { AuthEvent, AuthProvider, AuthSession, SignInResult } from "../auth-provider";
import { isInAppPath } from "../paths";

/**
 * The API's own sign-in (srp/local-login-srp-home): POST /srp/auth/login checks the password and returns a
 * token the API signs. No Supabase anywhere. The session lives in sessionStorage (tab-scoped), with a
 * memory copy for when storage is blocked. There is no refresh token: when the token expires the person
 * signs in again.
 *
 * Nothing here logs, and no error carries the password or the token.
 */

const KEY = "v3.srp.session";
const API_BASE = (import.meta.env.VITE_API_BASE_URL?.trim() || "/api").replace(/\/+$/, "");
const MAX_TIMEOUT_MS = 2_147_483_647;

export type AuthErrorCode = "invalid_credentials" | "no_professional_seat" | "unavailable";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}

type Stored = { accessToken: string; expiresAt: string; user: SessionUser; landingPath: string };

let memory: Stored | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(event: AuthEvent, session: AuthSession | null) => void>();

const emit = (event: AuthEvent, session: AuthSession | null) => listeners.forEach((l) => l(event, session));
const toSession = (r: Stored): AuthSession => ({ accessToken: r.accessToken, user: r.user, landingPath: r.landingPath });
const expired = (r: Stored) => Date.parse(r.expiresAt) <= Date.now();

function parseUser(raw: unknown): SessionUser | null {
  const u = raw as { id?: unknown; email?: unknown; first_name?: unknown; last_name?: unknown } | null;
  if (!u || typeof u.id !== "string" || typeof u.email !== "string") return null;
  return {
    id: u.id,
    email: u.email,
    user_metadata: { first_name: u.first_name ?? null, last_name: u.last_name ?? null },
  };
}

function parseStored(raw: unknown): Stored | null {
  const r = raw as Partial<Stored> | null;
  if (!r || typeof r.accessToken !== "string" || !r.accessToken) return null;
  if (typeof r.expiresAt !== "string" || Number.isNaN(Date.parse(r.expiresAt))) return null;
  const u = r.user as { id?: unknown; email?: unknown } | undefined;
  if (!u || typeof u.id !== "string") return null;
  return {
    accessToken: r.accessToken,
    expiresAt: r.expiresAt,
    user: r.user as SessionUser,
    landingPath: isInAppPath(r.landingPath) ? r.landingPath : "/",
  };
}

function readStored(): Stored | null {
  let raw: string | null;
  try {
    raw = globalThis.sessionStorage?.getItem(KEY) ?? null;
  } catch {
    return memory; // storage blocked: the memory copy is the session
  }
  if (raw === null) return memory;
  try {
    const parsed = parseStored(JSON.parse(raw));
    if (parsed) return parsed;
  } catch {
    // fall through: a damaged record is dropped
  }
  clearStored();
  return null;
}

function writeStored(record: Stored): void {
  memory = record;
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(record));
  } catch {
    // the memory copy still holds the session for this page
  }
}

function clearStored(): void {
  memory = null;
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

function scheduleExpiry(record: Stored): void {
  if (timer) clearTimeout(timer);
  const delay = Math.min(Math.max(Date.parse(record.expiresAt) - Date.now(), 0), MAX_TIMEOUT_MS);
  timer = setTimeout(() => {
    clearStored();
    emit("SIGNED_OUT", null);
  }, delay);
  (timer as { unref?: () => void }).unref?.();
}

async function post(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new AuthError("unavailable"); // the cause can hold the request, so it is not kept
  }
}

async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const res = await post("/srp/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401 || res.status === 422) throw new AuthError("invalid_credentials");
  if (res.status === 403) throw new AuthError("no_professional_seat");
  if (!res.ok) throw new AuthError("unavailable");

  const body = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    expires_at?: unknown;
    user?: unknown;
    landing?: { path?: unknown };
  } | null;
  const user = parseUser(body?.user);
  const landingPath = body?.landing?.path;
  if (
    !body ||
    typeof body.access_token !== "string" ||
    !body.access_token ||
    typeof body.expires_at !== "string" ||
    Number.isNaN(Date.parse(body.expires_at)) ||
    !user ||
    !isInAppPath(landingPath)
  ) {
    throw new AuthError("unavailable");
  }

  const record: Stored = { accessToken: body.access_token, expiresAt: body.expires_at, user, landingPath };
  writeStored(record);
  scheduleExpiry(record);
  const session = toSession(record);
  emit("SIGNED_IN", session);
  return { session, landingPath };
}

/** Target adapter: the API issues the access token. Refresh is not built; the person signs in again. */
export const apiAuthProvider: AuthProvider = {
  name: "api",
  signInWithPassword,

  async getSession() {
    const record = readStored();
    if (!record) return null;
    if (expired(record)) {
      clearStored();
      return null;
    }
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/srp/auth/me`, { headers: { authorization: `Bearer ${record.accessToken}` } });
    } catch {
      return null; // API unreachable: no session for now; the stored one is kept for the next try
    }
    if (res.status === 401 || res.status === 403) {
      clearStored(); // deactivated, signed-out elsewhere or no seat any more
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { user?: unknown; landing?: { path?: unknown } } | null;
    const user = parseUser(body?.user);
    if (!user) return null;
    const next: Stored = {
      ...record,
      user,
      landingPath: isInAppPath(body?.landing?.path) ? body.landing.path : record.landingPath,
    };
    writeStored(next);
    scheduleExpiry(next);
    return toSession(next);
  },

  async getAccessToken() {
    const record = readStored();
    if (!record) return null;
    if (expired(record)) {
      clearStored();
      emit("SIGNED_OUT", null);
      return null;
    }
    return record.accessToken;
  },

  async signOut() {
    clearStored();
    emit("SIGNED_OUT", null);
  },

  onChange(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
