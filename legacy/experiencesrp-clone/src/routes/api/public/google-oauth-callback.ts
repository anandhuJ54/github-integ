import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { secretByRef } from "@/lib/google-workspace.server";

// Receives Google's redirect after a human admin approves consent. Validates the one-time state
// before exchanging the code; stores the refresh token in the vault, never in a table.
export const Route = createFileRoute("/api/public/google-oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const back = (q: string) => Response.redirect(`${url.origin}/admin/integrations?google=${encodeURIComponent(q)}`, 302);
        const parsed = z.object({ code: z.string().min(1).max(2048), state: z.string().min(16).max(128) }).safeParse({ code: url.searchParams.get("code"), state: url.searchParams.get("state") });
        if (url.searchParams.get("error")) return back(`denied:${url.searchParams.get("error")}`);
        if (!parsed.success) return back("invalid_request");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as { from: (t: string) => any; rpc: (f: string, a: unknown) => any };
        const { data: row } = await db.from("exp_integration_google").select("*").eq("id", "workspace").maybeSingle();
        if (!row || !row.oauth_state || row.oauth_state !== parsed.data.state || !row.oauth_state_expires_at || Date.parse(row.oauth_state_expires_at) < Date.now()) return back("state_mismatch");
        const clientId = secretByRef(row.client_id_ref);
        const clientSecret = secretByRef(row.client_secret_ref);
        if (!clientId || !clientSecret) return back("missing_client_credentials");
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code: parsed.data.code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${url.origin}/api/public/google-oauth-callback`, grant_type: "authorization_code" }),
        });
        if (!tokenRes.ok) {
          const err = await tokenRes.text();
          console.error(`Google token exchange failed [${tokenRes.status}]: ${err}`);
          await db.from("exp_integration_google").update({ status: "error", last_error: `token exchange ${tokenRes.status}`, oauth_state: null, updated_at: new Date().toISOString() }).eq("id", "workspace");
          return back("token_exchange_failed");
        }
        const tokens = (await tokenRes.json()) as { access_token: string; refresh_token?: string; scope?: string };
        const who = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } });
        const info = who.ok ? ((await who.json()) as { email?: string; hd?: string }) : {};
        if (!info.email || !info.email.toLowerCase().endsWith(`@${String(row.domain).toLowerCase()}`)) {
          await db.from("exp_integration_google").update({ status: "error", last_error: "Authorizing account is not on the company domain", oauth_state: null, updated_at: new Date().toISOString() }).eq("id", "workspace");
          return back("wrong_domain");
        }
        let vaultId: string | null = row.refresh_token_vault_id ?? null;
        if (tokens.refresh_token) {
          const { data: id, error } = await db.rpc("exp_google_vault_put", { p_existing: vaultId, p_secret: tokens.refresh_token });
          if (error) { console.error(error); return back("vault_error"); }
          vaultId = id as string;
        }
        await db.from("exp_integration_google").update({
          status: "connected", connected_by_email: info.email, connected_at: new Date().toISOString(),
          scopes: (tokens.scope ?? "").split(" ").filter(Boolean), refresh_token_vault_id: vaultId,
          oauth_state: null, oauth_state_expires_at: null, last_error: null, updated_at: new Date().toISOString(),
        }).eq("id", "workspace");
        await db.from("audit_log").insert({ user_id: row.connected_by, action: "google_workspace_connected", entity_type: "integration", field_changes: { email: info.email, scopes: tokens.scope ?? "" } });
        return back("connected");
      },
    },
  },
});
