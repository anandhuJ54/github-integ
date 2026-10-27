import type { SessionUser } from "../types";

export type AuthEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY";

export type AuthSession = {
  user: SessionUser;
  accessToken: string;
  /** Where the person's home is, when the adapter knows it (the API sign-in does). */
  landingPath?: string;
};

export type SignInResult = { session: AuthSession; landingPath: string };

/**
 * What the app needs from whatever signs users in. Supabase is the temporary adapter; the API's own
 * login replaces it by implementing this interface, so nothing outside state/auth knows which is live.
 */
export interface AuthProvider {
  readonly name: string;
  /** Sign in with an email and password, for adapters that own the credentials (the API login). */
  signInWithPassword?(email: string, password: string): Promise<SignInResult>;
  getSession(): Promise<AuthSession | null>;
  /** The bearer token for API calls, or null when signed out. */
  getAccessToken(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Subscribe to sign-in, sign-out and user changes. Returns the unsubscribe. */
  onChange(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void;
}
