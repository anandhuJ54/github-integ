import { getAuthProvider } from "@v3/state/auth";

/**
 * True when the app signs in through the API's own login (the SRP login, `VITE_AUTH_PROVIDER=api`). Those sessions have no Super Admin to return to and a demo audience
 * does not need the "Viewing as" bar or the sample-data notice, so both are hidden for them; the admin console sign-in keeps both.
 */
export function usesLocalSignIn(): boolean {
  return getAuthProvider().name === "api";
}
