import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@v3/ui/lib/server-fn";
import { CheckCircle2, Circle, Copy, Mail, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { Button } from "@v3/ui/components/ui/button";
import { Badge } from "@v3/ui/components/ui/badge";
import { Input } from "@v3/ui/components/ui/input";
import { useRole } from "@v3/ui/lib/roles";
import { checkDomainVerification, dispatchGoogleOutbox, getGoogleIntegration, startDomainVerification, startGoogleConnect } from "@v3/ui/lib/google-workspace.functions";
import { getNoraIntegrations, updateNoraIntegration } from "@v3/admin/lib/integrations.functions";
import { INTEGRATION_STATUS_LABEL, INTEGRATIONS, type IntegrationStatus } from "@v3/admin/lib/integrations";
import { ALERT_RULES, ALERT_TIER_LABEL, runAlertEngineNow } from "@v3/ui/lib/sales-alerts";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations · Experience.com Admin Console" },
      { name: "description", content: "Company-wide Google Workspace connection for Gmail and Google Calendar across all experience.com employees." },
      { property: "og:title", content: "Integrations · Experience.com Admin Console" },
      { property: "og:description", content: "Connect Google Workspace and verify the experience.com domain for org-wide email and calendar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPage,
});

const STATUS_LABEL: Record<string, string> = { not_connected: "Not connected", awaiting_admin_authorize: "Awaiting admin authorize", connected: "Connected", error: "Error" };
const SCOPE_LABEL: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.send": "Gmail · send",
  "https://www.googleapis.com/auth/gmail.readonly": "Gmail · read",
  "https://www.googleapis.com/auth/calendar.events": "Calendar · read/write events",
  "https://www.googleapis.com/auth/calendar.readonly": "Calendar · read",
};

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return <li className="flex items-start gap-2 py-1.5 text-sm">{done ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary"/> : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground"/>}<div>{children}</div></li>;
}

function NoraIntegrationCard({ s }: { s: IntegrationStatus }) {
  const qc = useQueryClient();
  const update = useServerFn(updateNoraIntegration);
  const def = INTEGRATIONS[s.key];
  const [refs, setRefs] = useState<Record<string, string>>(s.refs);
  const [settings, setSettings] = useState<Record<string, string>>(s.settings);
  const m = useMutation({ mutationFn: (mode?: "stub" | "live") => update({ data: { key: s.key, refs, settings, mode } }), onSuccess: () => { toast.success(`${def.name} saved`); void qc.invalidateQueries({ queryKey: ["nora-integrations"] }); }, onError: (e: Error) => toast.error(e.message) });
  const redirect = def.redirectPath ? `${typeof window !== "undefined" ? window.location.origin : ""}${def.redirectPath}` : null;
  return <section className="rounded-lg border p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Plug className="h-5 w-5"/>{def.name}</h2><p className="text-sm text-muted-foreground">{def.purpose}</p></div>
      <div className="flex gap-2"><Badge variant={s.status === "live" ? "default" : "outline"}>{INTEGRATION_STATUS_LABEL[s.status]}</Badge>{s.status !== "live" ? <Badge variant="outline">Stub — no live calls</Badge> : null}</div>
    </div>
    <ol className="mt-3">
      {def.secrets.map((x) => <Step key={x.id} done={!!s.secrets[x.id]}><span>{x.label}, saved as secret </span><Input className="mt-1 h-8 w-72 font-mono text-xs" value={refs[x.id] ?? ""} onChange={(e) => setRefs({ ...refs, [x.id]: e.target.value })} aria-label={`${x.label} secret name`}/></Step>)}
      {def.settings.map((x) => <Step key={x.id} done={!!s.settings[x.id]?.trim()}><span>{x.label}{x.help ? <span className="text-xs text-muted-foreground"> · {x.help}</span> : null}</span><Input className="mt-1 h-8 w-72 font-mono text-xs" value={settings[x.id] ?? ""} onChange={(e) => setSettings({ ...settings, [x.id]: e.target.value })} aria-label={x.label}/></Step>)}
    </ol>
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      {def.scopes ? <div><dt className="text-muted-foreground">Required scopes</dt><dd className="break-all">{def.scopes.join(" ")}</dd></div> : null}
      {redirect ? <div><dt className="text-muted-foreground">Authorized redirect URI</dt><dd className="flex items-center gap-1"><code className="break-all text-xs">{redirect}</code><Button size="icon" variant="ghost" aria-label="Copy redirect URI" onClick={() => { void navigator.clipboard.writeText(redirect); toast.success("Copied"); }}><Copy/></Button></dd></div> : null}
      {def.costNote ? <div><dt className="text-muted-foreground">Cost</dt><dd>{def.costNote}</dd></div> : null}
      <div><dt className="text-muted-foreground">Mode</dt><dd>{s.status === "live" ? "Live — real API calls" : `Stub — no live calls; NORA returns "not configured"${s.missing.length ? ` (missing ${s.missing.join(", ")})` : ""}`}</dd></div>
    </dl>
    {!s.persisted ? <p className="mt-3 text-xs text-muted-foreground">Settings table not migrated yet — showing defaults; cannot go live until migration 0017 is applied.</p> : null}
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="outline" disabled={m.isPending} onClick={() => m.mutate(undefined)}>Save</Button>
      {s.status === "live" ? <Button variant="outline" disabled={m.isPending} onClick={() => m.mutate("stub")}>Return to stub</Button> : <Button disabled={m.isPending || !s.persisted || s.status !== "configured_stub"} onClick={() => m.mutate("live")}>Go live</Button>}
    </div>
  </section>;
}

function IntegrationsPage() {
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const get = useServerFn(getGoogleIntegration);
  const connect = useServerFn(startGoogleConnect);
  const startVerify = useServerFn(startDomainVerification);
  const checkVerify = useServerFn(checkDomainVerification);
  const dispatch = useServerFn(dispatchGoogleOutbox);
  const q = useQuery({ queryKey: ["google-integration"], queryFn: () => get(), enabled: isSuperAdmin });
  const refresh = () => qc.invalidateQueries({ queryKey: ["google-integration"] });
  const getNora = useServerFn(getNoraIntegrations);
  const nora = useQuery({ queryKey: ["nora-integrations"], queryFn: () => getNora(), enabled: isSuperAdmin });

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("google");
    if (flag) { flag === "connected" ? toast.success("Google Workspace connected") : toast.error(`Google authorization did not complete: ${flag}`); }
  }, []);

  const connectM = useMutation({ mutationFn: () => connect({ data: { origin: window.location.origin } }), onSuccess: (r) => { if (r.url) window.location.assign(r.url); else toast.error(`Missing secrets: ${r.missing.join(", ")}`); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const verifyM = useMutation({ mutationFn: () => startVerify(), onSuccess: () => { toast.success("Verification record generated"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const checkM = useMutation({ mutationFn: () => checkVerify(), onSuccess: (r) => { r.verified ? toast.success("Domain verified") : toast.message(r.reason ?? "Not verified yet"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const dispatchM = useMutation({ mutationFn: () => dispatch(), onSuccess: (r) => { r.skipped ? toast.message(r.skipped) : toast.success(`Sent ${r.sent}, failed ${r.failed}`); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const alertsM = useMutation({ mutationFn: runAlertEngineNow, onSuccess: (r) => toast.success(`${r.alerts} new alerts · ${r.reminders} reminders`), onError: (e: Error) => toast.error(e.message) });

  const d = q.data;
  return <EmpLayout>
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header><p className="text-xs font-semibold uppercase text-muted-foreground">Admin · System settings</p><h1 className="text-2xl font-semibold">Integrations</h1><p className="text-sm text-muted-foreground">Company-wide connections. One setting serves every experience.com employee.</p></header>
      {!isSuperAdmin ? <p className="rounded-lg border p-4 text-sm">Only super admins can manage integrations.</p> : q.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted"/> : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p> : d ? <>
        <section className="rounded-lg border p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Mail className="h-5 w-5"/>Google Workspace</h2><p className="text-sm text-muted-foreground">Gmail and Google Calendar for all employees, each sending as their own @{d.domain} address (domain-wide delegation).</p></div>
            <div className="flex gap-2"><Badge variant={d.status === "connected" ? "default" : "outline"}>{STATUS_LABEL[d.status] ?? d.status}</Badge><Badge variant={d.domainStatus === "verified" ? "default" : "outline"}>{d.domainStatus === "verified" ? "Domain verified" : d.domainStatus === "pending_verification" ? "Domain pending" : "Domain unverified"}</Badge></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={connectM.isPending} onClick={() => connectM.mutate()}>{d.status === "connected" ? "Re-authorize Google Workspace" : "Connect Google Workspace"}</Button>
            <Button variant="outline" disabled={verifyM.isPending} onClick={() => verifyM.mutate()}><ShieldCheck/>Verify domain ({d.domain})</Button>
            {d.verificationToken && d.domainStatus !== "verified" ? <Button variant="outline" disabled={checkM.isPending} onClick={() => checkM.mutate()}><RefreshCw/>Check DNS record</Button> : null}
          </div>
          {d.verificationToken && d.domainStatus !== "verified" ? <div className="mt-3 rounded-md bg-muted p-3 text-xs"><p className="mb-1 font-medium">Add this TXT record at the root of {d.domain}, then click "Check DNS record":</p><code className="break-all">{d.verificationToken}</code><Button size="icon" variant="ghost" aria-label="Copy record" onClick={() => { void navigator.clipboard.writeText(d.verificationToken ?? ""); toast.success("Copied"); }}><Copy/></Button></div> : null}
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Connected admin</dt><dd>{d.connectedByEmail ?? "—"}{d.connectedAt ? ` · ${new Date(d.connectedAt).toLocaleString()}` : ""}</dd></div>
            <div><dt className="text-muted-foreground">Domain verified</dt><dd>{d.verifiedAt ? new Date(d.verifiedAt).toLocaleString() : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Granted scopes</dt><dd>{d.scopes.length ? d.scopes.filter((s: string) => SCOPE_LABEL[s]).map((s: string) => SCOPE_LABEL[s]).join(", ") : "None granted yet"}</dd></div>
            <div><dt className="text-muted-foreground">Requested scopes</dt><dd>{d.requestedScopes.map((s: string) => SCOPE_LABEL[s] ?? s).join(", ")}</dd></div>
            <div><dt className="text-muted-foreground">Delivery</dt><dd>{d.canDeliver ? "Live — emails and invites send through Google" : "Not live — emails and invites queue as pending"}</dd></div>
            <div><dt className="text-muted-foreground">Queued</dt><dd>{d.pendingEmails} emails · {d.pendingCalendar} calendar invites {d.canDeliver && d.pendingEmails ? <Button size="sm" variant="link" onClick={() => dispatchM.mutate()}>Send queued</Button> : null}</dd></div>
          </dl>
          {d.lastError ? <p className="mt-3 text-sm text-destructive">Last error: {d.lastError}</p> : null}
          <p className="mt-3 text-xs text-muted-foreground">Applies org-wide to all employee users. Secrets are held in the secure vault and referenced by name only.</p>
        </section>

        <section className="rounded-lg border p-5">
          <h2 className="font-semibold">What the Google Cloud / Workspace admin must provide</h2>
          <ol className="mt-2">
            <Step done={d.secrets.clientId && d.secrets.clientSecret}>OAuth web client ID and secret, saved as secrets <code>{d.refs.clientId}</code> and <code>{d.refs.clientSecret}</code>. Authorized redirect URI: <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/public/google-oauth-callback</code></Step>
            <Step done={d.secrets.serviceAccount}>Service-account JSON key with domain-wide delegation, saved as secret <code>{d.refs.serviceAccount}</code></Step>
            <Step done={d.scopes.length > 0}>In Google Admin → Security → API controls → Domain-wide delegation, authorize the service account client ID for: {d.requestedScopes.map((s: string) => SCOPE_LABEL[s] ?? s).join(", ")}; then click Connect Google Workspace and approve as a {d.domain} admin</Step>
            <Step done={d.domainStatus === "verified"}>Publish the TXT record above on {d.domain} and click Check DNS record</Step>
          </ol>
        </section>

        {nora.error ? <p className="text-sm text-destructive">{(nora.error as Error).message}</p> : nora.data?.integrations.map((s) => <NoraIntegrationCard key={`${s.key}:${s.status}:${JSON.stringify(s.refs)}:${JSON.stringify(s.settings)}`} s={s}/>)}

        <section className="rounded-lg border p-5">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Sales alert engine</h2><Button size="sm" variant="outline" disabled={alertsM.isPending} onClick={() => alertsM.mutate()}><RefreshCw/>Run now</Button></div>
          <p className="text-sm text-muted-foreground">Runs once a day (13:00 UTC). Reminders show in-app and, once Google is live, by email.</p>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{ALERT_RULES.map((r) => <li key={r.rule} className="flex items-center gap-2">{r.live ? <CheckCircle2 className="h-4 w-4 text-primary"/> : <Circle className="h-4 w-4 text-muted-foreground"/>}{r.label} <span className="text-xs text-muted-foreground">· {ALERT_TIER_LABEL[r.tier]}</span>{r.live ? "" : " — source pending"}</li>)}</ul>
        </section>
      </> : null}
    </div>
  </EmpLayout>;
}
