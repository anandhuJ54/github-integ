import { AuthError } from "@v3/state/auth/adapters/api";
import { isInAppPath } from "@v3/state/auth/paths";

/** Plain-language text for a failed sign-in. Never the raw error: it could carry a host or a secret. */
export function signInErrorMessage(err: unknown): string {
  if (err instanceof AuthError) {
    if (err.code === "invalid_credentials") return "The email or password is not right.";
    if (err.code === "no_professional_seat") return "This user has no professional seat, so there is no home to open.";
  }
  return "Sign-in is not available right now. Try again.";
}

/** The path to open after sign-in: the API's landing path when it is inside the app, else the home page. */
export function safeLanding(path: string | undefined): string {
  return isInAppPath(path) ? path : "/";
}

/** The seat's Sign out control is for people signed in through the API; the Admin Console layout has its own. */
export function showSignOut(providerName: string): boolean {
  return providerName === "api";
}
