import type { AuthProvider } from "./auth-provider";
import { supabaseAuthProvider } from "./adapters/supabase/adapter";

export type { AuthEvent, AuthProvider, AuthSession } from "./auth-provider";

let current: AuthProvider | null = null;

/** Choose the auth adapter. Call once at start-up; without a call the Supabase adapter is used. */
export function setAuthProvider(provider: AuthProvider): void {
  current = provider;
}

export function getAuthProvider(): AuthProvider {
  return current ?? supabaseAuthProvider;
}
