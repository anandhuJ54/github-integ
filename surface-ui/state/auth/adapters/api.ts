import type { AuthProvider } from "../auth-provider";

const notImplemented = (): never => {
  throw new Error("not_implemented: API auth adapter (the FastAPI login and refresh endpoints do not exist yet)");
};

/** Target adapter: the API issues the access token and keeps the refresh credential. Not built yet. */
export const apiAuthProvider: AuthProvider = {
  name: "api",
  getSession: async () => notImplemented(),
  getAccessToken: async () => notImplemented(),
  signOut: async () => notImplemented(),
  onChange: () => notImplemented(),
};
