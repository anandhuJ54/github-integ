import type { Session } from "@supabase/supabase-js";
import type { AuthEvent, AuthProvider, AuthSession } from "../../auth-provider";
import { supabase } from "./client";

function toSession(s: Session | null): AuthSession | null {
  if (!s) return null;
  return {
    accessToken: s.access_token,
    user: {
      id: s.user.id,
      email: s.user.email ?? null,
      user_metadata: s.user.user_metadata,
      app_metadata: s.user.app_metadata,
    },
  };
}

/** Temporary adapter over Supabase Auth. Removed when the API login lands. */
export const supabaseAuthProvider: AuthProvider = {
  name: "supabase",
  async getSession() {
    const { data } = await supabase.auth.getSession();
    return toSession(data.session);
  },
  async getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  async signOut() {
    await supabase.auth.signOut();
  },
  onChange(listener) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      listener(event as AuthEvent, toSession(session));
    });
    return () => data.subscription.unsubscribe();
  },
};
