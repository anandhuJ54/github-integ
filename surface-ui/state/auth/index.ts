import type { AuthProvider } from "./auth-provider";
import { apiAuthProvider } from "./adapters/api";
import { supabaseAuthProvider } from "./adapters/supabase/adapter";

export type { AuthEvent, AuthProvider, AuthSession, SignInResult } from "./auth-provider";

let current: AuthProvider | null = null;

/** Choose the auth adapter. Call once at start-up; without a call the Supabase adapter is used. */
export function setAuthProvider(provider: AuthProvider): void {
  current = provider;
}

export function getAuthProvider(): AuthProvider {
  return current ?? supabaseAuthProvider;
}

/**
 * The adapter named by VITE_AUTH_PROVIDER: `api` (the API's own sign-in) or `supabase` (also when unset).
 * Anything else is an error rather than a silent default, so a typo cannot land on the wrong login.
 */
export function authProviderFromEnv(name: string | undefined): AuthProvider {
  const value = (name ?? "").trim().toLowerCase();
  if (value === "" || value === "supabase") return supabaseAuthProvider;
  if (value === "api") return apiAuthProvider;
  throw new Error(`VITE_AUTH_PROVIDER must be "api" or "supabase", got "${name}"`);
}

/** Where a signed-out person is sent to sign in: the API sign-in page, or the Admin Console one. */
export function signInPath(): string {
  return getAuthProvider().name === "api" ? "/sign-in" : "/auth";
}
