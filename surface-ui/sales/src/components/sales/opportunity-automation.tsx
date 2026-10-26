import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@v3/state/api/server-fn";
import { Bell, Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@v3/state/auth/adapters/supabase/client";
import { Button } from "@v3/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@v3/shared/components/ui/dialog";
import { Input } from "@v3/shared/components/ui/input";
import { Label } from "@v3/shared/components/ui/label";
import { Textarea } from "@v3/shared/components/ui/textarea";
import { EmptyState, Panel } from "@v3/shared/components/ui/console-primitives";
import { acceptAlert, dismissAlert, loadAlerts, type SalesAlert } from "@v3/sales/utils/sales-alerts";
import { getGoogleDeliveryStatus, sendOpportunityEmail } from "@v3/sales/utils/google-workspace.functions";
import { loadOpportunityAuditTrail, type OpportunityFile } from "@v3/sales/utils/opportunity-file";

const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");
const emails = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

export function useGoogleDelivery() {
  const fn = useServerFn(getGoogleDeliveryStatus);
  return useQuery({ queryKey: ["google-delivery-status"], queryFn: () => fn(), staleTime: 60_000 });
}

/** Alerts + NORA suggestions. Accepting a suggestion is the only way it becomes a task. */
export function AlertsFeed({ opportunityId, opportunityIds, ownerId, onChanged, title = "Alerts & NORA suggestions" }: { opportunityId?: string; opportunityIds?: string[]; ownerId?: string | null; onChanged?: () => void; title?: string }) {
  const qc = useQueryClient();
  const key = ["sales-alerts", opportunityId ?? null, ownerId ?? null, opportunityIds?.join(",") ?? null];
  const q = useQuery({ queryKey: key, queryFn: () => loadAlerts({ opportunityId, ownerId, opportunityIds }) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["sales-alerts"] }); onChanged?.(); };
  // Live delivery: alerts written by database triggers appear the moment they land.
  useEffect(() => {
    const channel = supabase
      .channel(`sales-alerts-${key.join("|")}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "exp_sales_alerts" }, () => {
        void qc.invalidateQueries({ queryKey: ["sales-alerts"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key.join("|")]);
  const accept = useMutation({ mutationFn: (a: SalesAlert) => acceptAlert(a.id), onSuccess: () => { toast.success("Suggestion accepted — task created"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const dismiss = useMutation({ mutationFn: (a: SalesAlert) => dismissAlert(a), onSuccess: () => { toast.success("Alert dismissed"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const rows = q.data ?? [];
  return <Panel title={title} description="Generated daily from live claim, contact, stage and activity data. Owned by the opportunity owner.">
    {q.isLoading ? <div className="h-16 animate-pulse rounded-[8px] bg-[color:var(--color-surface-2)]"/> : rows.length ? <ul className="grid gap-2">{rows.map((a) => <li key={a.id} className="flex items-start justify-between gap-2 border-b pb-2 text-xs">
      <div className="grid gap-0.5"><b className="flex items-center gap-1 text-[12px]">{a.is_nora_suggested ? <Sparkles className="h-3 w-3"/> : <Bell className="h-3 w-3"/>}{(a.rule ?? a.alert_type ?? "alert").replaceAll("_", " ")}</b><span>{a.body}</span>{a.is_nora_suggested && a.suggested_task?.title ? <span className="text-muted-foreground">Suggested task: {a.suggested_task.title}</span> : null}<span className="text-muted-foreground">{a.logo ?? "—"} · {dt(a.created_at)}{a.owner_id ? "" : " · no owner assigned"}</span></div>
      <div className="flex gap-1">{a.is_nora_suggested ? <Button size="sm" variant="outline" disabled={accept.isPending} onClick={() => accept.mutate(a)}><Check/>Accept</Button> : null}<Button size="icon" variant="ghost" aria-label="Dismiss alert" disabled={dismiss.isPending} onClick={() => dismiss.mutate(a)}><X/></Button></div>
    </li>)}</ul> : <EmptyState title="No open alerts" compact/>}
  </Panel>;
}

/** Read-only attribution and history. No edits here. */
export function AuditPanel({ data }: { data: OpportunityFile }) {
  const q = useQuery({
    queryKey: ["opp-audit", data.opp.id, data.quoteId],
    queryFn: () => loadOpportunityAuditTrail(data.opp.id, data.quoteId),
  });
  const opp = data.opp as typeof data.opp & { created_by?: string | null };
  const rows: [string, string][] = [["Created", dt(opp.created_at)], ["Created by", opp.created_by ?? "—"], ["Source", opp.source_channel ?? "—"], ["Source owner", opp.source_owner ?? "—"], ["Promo", q.data?.promos.length ? q.data.promos.map((p) => p.code).join(", ") : "—"]];
  return <Panel title="Audit & attribution" description="Read-only history from the governed lifecycle.">
    <dl className="info-rows">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <h3 className="mt-3 text-[10px] font-bold uppercase text-muted-foreground">Stage changes</h3>
    {data.history.length ? <ul className="text-xs">{data.history.map((h) => <li key={h.id} className="flex justify-between border-b py-1.5"><span>{h.from_stage ?? "—"} → {h.to_stage ?? "—"}</span><span className="text-muted-foreground">{dt(h.moved_at)}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">No stage changes recorded.</p>}
    <h3 className="mt-3 text-[10px] font-bold uppercase text-muted-foreground">Owner changes</h3>
    {q.data?.owners.length ? <ul className="text-xs">{q.data.owners.map((o) => <li key={o.id} className="flex justify-between border-b py-1.5"><span>{o.from_owner ?? "—"} → {o.to_owner ?? "—"}</span><span className="text-muted-foreground">{dt(o.changed_at)}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">No owner changes recorded.</p>}
  </Panel>;
}

/** Email through the company Google Workspace; queued as pending until Google is live. */
export function EmailDialog({ open, data, onClose, onSaved }: { open: boolean; data: OpportunityFile; onClose: () => void; onSaved: () => void }) {
  const send = useServerFn(sendOpportunityEmail);
  const delivery = useGoogleDelivery();
  const [to, setTo] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const m = useMutation({
    mutationFn: () => send({ data: { opportunityId: data.opp.id, to: emails(to), subject, body } }),
    onSuccess: (r) => { if (r.status === "sent") toast.success("Email sent from your experience.com address"); else if (r.status === "failed") toast.error(`Send failed: ${r.error ?? "unknown error"} (kept in outbox)`); else toast.message("Queued — connect Google to send"); onClose(); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = emails(to).length > 0 && emails(to).every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) && subject.trim() && body.trim();
  return <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Send email</DialogTitle></DialogHeader>
    <p className="text-xs text-muted-foreground">{delivery.data?.canDeliver ? "Sends through Google Workspace as your experience.com address." : "Google Workspace is not connected yet — this email will be queued (pending) and logged, not sent."}</p>
    <div className="grid gap-3"><div><Label>To</Label><Input placeholder="Emails separated by commas" value={to} onChange={(e) => setTo(e.target.value)}/></div><div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)}/></div><div><Label>Message</Label><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)}/></div></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || m.isPending} onClick={() => m.mutate()}>{delivery.data?.canDeliver ? "Send" : "Queue email"}</Button></DialogFooter></DialogContent></Dialog>;
}
