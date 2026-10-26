import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Copy, Download, Lock, Plus, Send, Upload, X } from "lucide-react";
import { EmptyState, PageBody, Panel } from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { Input } from "@v3/ui/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@v3/ui/components/ui/dialog";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { BillingTab, OrderFormDocument } from "@v3/sales/components/contracts/contract-billing";
import { ContractDocument, productsFromTerms } from "@v3/sales/components/contracts/contract-document";
import { hasCertificate } from "@v3/sales/lib/contract-print";
import {
  createAddendum,
  generateRenewalNotice,
  addLine,
  addRecipient,
  loadSkus,
  removeLine,
  removeRecipient,
  type Sku,
  addVersion,
  day,
  decideApproval,
  finalizeContract,
  getContract,
  money,
  requestApproval,
  sendForSignature,
  startRenewal,
  updateSpecialTerms,
  type ContractDetail,
} from "@v3/sales/lib/contracts";

export const Route = createFileRoute("/_authenticated/sales/contracts/$contractId")({
  head: () => ({
    meta: [
      { title: "Contract — Experience.com Growth Hub" },
      { name: "description", content: "Contract record: workspace, document room, activity and version history." },
      { property: "og:title", content: "Contract — Experience.com Growth Hub" },
      { property: "og:description", content: "Approve, negotiate, finalize and send contracts for signature." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContractRecord,
});

type Tab = "workspace" | "document" | "send-sign" | "billing" | "activity" | "versions";
const actor = async () => (await supabase.auth.getUser()).data.user?.email ?? null;

function Pill({ s }: { s: string | null | undefined }) {
  const v = (s ?? "—").toLowerCase();
  const c = ["active", "executed", "signed", "approved"].includes(v) ? "green"
    : v === "renewing" ? "teal"
      : v.includes("signature") || v === "final" || v === "sent" ? "purple"
      : ["negotiating", "review", "pending", "requested"].includes(v) ? "amber"
        : ["rejected", "expired", "declined"].includes(v) ? "red" : "grey";
  return <span className={`pill ${c}`}>{v.replace(/_/g, " ")}</span>;
}

function ContractRecord() {
  const { contractId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["m4-contract", contractId], queryFn: () => getContract(contractId) });
  const [tab, setTab] = useState<Tab>("workspace");
  const [redlineOpen, setRedlineOpen] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["m4-contract", contractId] });
    void qc.invalidateQueries({ queryKey: ["m4-contracts"] });
  };
  const run = useMutation({
    mutationFn: async (fn: (a: string | null) => Promise<unknown>) => fn(await actor()),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <PageBody><p className="text-sm text-[color:var(--color-ink-3)]">Loading contract…</p></PageBody>;
  if (q.error || !q.data) return <PageBody><EmptyState title="Contract unavailable" description={(q.error as Error)?.message ?? "Not found"} /></PageBody>;
  const D = q.data;
  const c = D.contract;
  const stage = (c.stage ?? c.status ?? "draft").toLowerCase();
  const isReview = stage === "review" || stage === "ready" || stage === "final";
  const isSig = stage === "signature" || stage === "out_for_signature";
  const isActive = (c.status ?? "").toLowerCase() === "active";

  const sendForApproval = () =>
    run.mutate(async (a) => {
      if (c.special_terms?.trim()) {
        await requestApproval(c.id, "legal", null, null, a);
        await requestApproval(c.id, "finance", null, null, a);
        toast.success("Legal + finance approval requested");
      } else {
        await finalizeContract(c.id, a);
        toast.success("Advanced to review");
      }
    });

  const actions = (
    <div className="hdr-actions">
      {hasCertificate(D) && <Button variant="outline" asChild><Link to="/sales/contracts/$contractId/print" params={{ contractId: c.id }} search={{ doc: "certificate" }} target="_blank" rel="noopener noreferrer"><Download className="mr-1 h-4 w-4" />Download certificate</Link></Button>}
      {stage === "draft" && <Button className="grad" onClick={sendForApproval} disabled={run.isPending}><Send className="mr-1 h-4 w-4" />Send for approval</Button>}
      {stage === "negotiating" && <Button variant="outline" onClick={() => setRedlineOpen(true)}><Upload className="mr-1 h-4 w-4" />Upload redline</Button>}
      {(stage === "negotiating" || isReview) && <Button className="grad" onClick={() => run.mutate(async (a) => { const r = await finalizeContract(c.id, a); toast[r?.ok ? "success" : "warning"](r?.ok ? "Finalized — signing copy locked" : "Checklist incomplete"); })} disabled={run.isPending}>Finalize</Button>}
      {isSig && <Button className="grad" onClick={() => run.mutate(async (a) => { const n = await sendForSignature(c.id, a); toast.success(`Sent to ${n} signer(s)`); })} disabled={run.isPending}><Send className="mr-1 h-4 w-4" />Send for signature</Button>}
      {isActive && (["addendum", "amendment", "voce_addendum"] as const).map((k) => <Button key={k} variant="outline" disabled={run.isPending} onClick={() => run.mutate(async () => { const id = await createAddendum(c.id, k, null); toast.success("Draft created"); void navigate({ to: "/sales/contracts/$contractId", params: { contractId: id } }); })}>{k === "addendum" ? "New addendum" : k === "amendment" ? "New amendment" : "Add VOCE addendum"}</Button>)}
      {(isActive || D.renewal?.status === "upcoming") && <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(async () => { await generateRenewalNotice(c.id); void qc.invalidateQueries({ queryKey: ["m4-invoices", c.id] }); void qc.invalidateQueries({ queryKey: ["m4-notifications"] }); toast.success("Renewal notice drafted — see Billing"); })}>Draft renewal notice</Button>}
      {(c.status ?? "").toLowerCase() === "active" && <Button className="grad" onClick={() => run.mutate(async (a) => { const id = await startRenewal(c.id, a); void navigate({ to: "/sales/contracts/$contractId", params: { contractId: id } }); })} disabled={run.isPending}>Start renewal</Button>}
    </div>
  );

  const term = c.renewal_term_months ? `${c.renewal_term_months} mo` : "—";

  return (
    <PageBody className="m4-detail">
      <style>{CSS}</style>
      <Link to="/sales/contracts" className="back"><ArrowLeft className="h-4 w-4" />Contracts</Link>
      <div className="hdr">
        <div>
          <div className="title"><h1>{c.name}</h1><Pill s={c.stage ?? c.status} />{c.is_locked ? <span className="lock"><Lock className="h-3 w-3" />Locked</span> : null}</div>
          <p className="meta">{c.contract_number ?? "—"} · ACV <b>{money(c.acv ?? c.terms?.quote_summary?.estimatedArr)}</b> · term {term} · renews {day(c.end_date ?? D.renewal?.renewal_date)} · v{c.current_version ?? 1}</p>
        </div>
        {actions}
      </div>

      <div className="tabs">
        {(["workspace", "document", "send-sign", "billing", "activity", "versions"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "send-sign" ? "Send & Sign" : t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === "workspace" && <Workspace D={D} onChange={refresh} onDecide={(id, s) => run.mutate((a) => decideApproval(id, s, null, a))} />}
      {tab === "document" && <Room D={D} onRedline={() => setRedlineOpen(true)} onChange={refresh} />}
      {tab === "billing" && <BillingTab D={D} />}
      {tab === "send-sign" && (isReview || isSig ? <SendSign D={D} onSent={refresh} /> : <Panel className="state-panel" title="Send & sign"><EmptyState title="Signing is not ready" description="Advance the contract through approval and review before locking its signing copy." compact /></Panel>)}
      {tab === "activity" && <Panel className="activity-panel" title="Activity">{D.activity.length ? <Feed items={D.activity} /> : <EmptyState title="No activity yet" compact />}</Panel>}
      {tab === "versions" && <Panel className="versions-panel" title="Version history"><Versions D={D} /></Panel>}

      <RedlineDialog open={redlineOpen} onOpenChange={setRedlineOpen} onSubmit={(label, summary) => run.mutate(async (a) => { await addVersion(c.id, "customer_redline", label, a, { summary }, "upload"); toast.success("Redline version added"); setRedlineOpen(false); })} />
    </PageBody>
  );
}

function Blockers({ D }: { D: ContractDetail }) {
  const c = D.contract;
  const items: string[] = [];
  const pend = D.approvals.filter((a) => a.status === "pending" || a.status === "requested");
  if (pend.length) items.push(`${pend.length} approval(s) pending: ${pend.map((a) => a.approver_role).join(", ")}`);
  if (c.special_terms?.trim() && !D.approvals.some((a) => a.approver_role === "legal")) items.push("Special terms need legal approval");
  const latest = D.versions[0];
  if (latest?.kind === "customer_redline" && !latest.is_signing_copy) items.push(`Open customer redline (v${latest.version_no})`);
  const pt = (c.payment_terms ?? "").toLowerCase();
  const n = Number(pt.match(/net\s*(\d+)/)?.[1] ?? 0);
  if (n > 30) items.push(`Payment terms ${c.payment_terms} deviate from Net 30`);
  return (
    <div className={`nora-bar ${items.length ? "" : "ok"}`}>
      <span className="dia">◆ NORA</span>
      {items.length ? items.map((t) => <span key={t} className="chip">{t}</span>) : <span>Nothing blocking this contract.</span>}
    </div>
  );
}

function Workspace({ D, onChange, onDecide }: { D: ContractDetail; onChange: () => void; onDecide: (id: string, s: string) => void }) {
  const c = D.contract;
  const qs = c.terms?.quote_state ?? {};
  const sum = c.terms?.quote_summary ?? {};
  const [special, setSpecial] = useState(c.special_terms ?? "");
  useEffect(() => setSpecial(c.special_terms ?? ""), [c.special_terms]);
  const save = useMutation({ mutationFn: () => updateSpecialTerms(c.id, special), onSuccess: () => { toast.success("Special terms saved"); onChange(); }, onError: (e: Error) => toast.error(e.message) });
  const products = productsFromTerms(c.terms);
  const internal = D.recipients.filter((r) => r.party === "internal" || r.party === "experience");
  const customer = D.recipients.filter((r) => !(r.party === "internal" || r.party === "experience"));
  const [pickOpen, setPickOpen] = useState(false);
  const edit = useMutation({
    mutationFn: async (x: { fn: () => Promise<unknown>; msg: string; done?: () => void }) => { await x.fn(); return x; },
    onSuccess: (x) => { toast.success(x.msg); x.done?.(); onChange(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rmBtn = (id: string) => !c.is_locked ? <button className="rm" title="Remove recipient" disabled={edit.isPending} onClick={() => edit.mutate({ fn: () => removeRecipient(id), msg: "Recipient removed" })}><X className="h-3.5 w-3.5" /></button> : null;
  return (
    <div className="ws">
      <Blockers D={D} />
      <div className="grid2">
        <Panel title="Customer">
          <dl>
            <dt>Account</dt><dd>{D.org?.name ?? qs.accountName ?? "—"}</dd>
            <dt>Locations</dt><dd>{qs.locations ?? qs.locationCount ?? "—"}</dd>
            <dt>Professionals</dt><dd>{qs.professionals ?? qs.professionalCount ?? "—"}</dd>
            <dt>Package</dt><dd>{qs.basePackage ?? qs.package ?? "—"}</dd>
          </dl>
        </Panel>
        <Panel title="Commercial terms">
          <dl>
            <dt>ACV</dt><dd className="num">{money(c.acv ?? sum.estimatedArr)}</dd>
            <dt>Dates</dt><dd>{day(c.start_date ?? qs.startDate)} → {day(c.end_date ?? qs.endDate)}</dd>
            <dt>Payment</dt><dd>{c.payment_terms ?? "—"} · {c.billing_frequency ?? "—"}</dd>
            <dt>Renewal</dt><dd>{c.auto_renew ? `Auto · ${c.renewal_term_months ?? "—"} mo · ${c.notice_period_days ?? "—"}d notice` : "Manual"}</dd>
          </dl>
        </Panel>
      </div>
      <Panel title="Order form" bodyClassName="p-0" actions={!c.is_locked ? <Button size="sm" className="grad" onClick={() => setPickOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" />Add product</Button> : undefined}>
        {D.lineItems.length || !products.length ? (
          <>
            {(["recurring", "one_time"] as const).map((lt) => {
              const ls = D.lineItems.filter((l) => (l.line_type ?? "recurring") === lt);
              return (
                <div key={lt} className="of-sec">
                  <h4 className="of-h">{lt === "recurring" ? "§1.1 Recurring" : "§1.2 One-time"}</h4>
                  {ls.length ? (
                    <table><thead><tr><th>Product</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Disc.</th><th>Billing</th><th className="r">Subtotal</th>{!c.is_locked ? <th /> : null}</tr></thead>
                      <tbody>{ls.map((l) => <tr key={l.id}><td>{l.name_snapshot ?? l.product_key}<small className="code">{l.product_code ?? l.product_key}</small></td><td className="r num">{l.qty ?? "—"}</td><td className="r num">{money(l.unit_price)}</td><td className="r num">{l.discount_pct == null ? "—" : `${l.discount_pct}%`}</td><td className="cap">{l.billing_mode ?? "—"}</td><td className="r num">{money(l.subtotal ?? l.net)}</td>
                        {!c.is_locked ? <td className="r"><button className="rm" title="Remove line" disabled={edit.isPending} onClick={() => edit.mutate({ fn: () => removeLine(l.id), msg: "Line removed" })}><X className="h-3.5 w-3.5" /></button></td> : null}</tr>)}</tbody></table>
                  ) : <p className="muted px-5 pb-3">No {lt === "recurring" ? "recurring" : "one-time"} lines.</p>}
                </div>
              );
            })}
            <div className="of-tot">
              <div><span>Total recurring (ACV)</span><b className="num">{money(c.acv)}</b></div>
              <div><span>MRR</span><b className="num">{money(c.mrr)}</b></div>
              <div><span>Total one-time</span><b className="num">{money(c.total_one_time)}</b></div>
            </div>
          </>
        ) : (
          <table><thead><tr><th>Entitlement (from quote)</th><th className="r">Qty</th><th className="r">Net</th></tr></thead>
            <tbody>{products.map((p, i) => <tr key={i}><td>{p.name}</td><td className="r num">{p.qty ?? "—"}</td><td className="r num">{money(p.net)}</td></tr>)}</tbody></table>
        )}
      </Panel>
      {!c.is_locked ? <SkuPicker open={pickOpen} onOpenChange={setPickOpen} pending={edit.isPending} onAdd={(code, qty, unit, disc, mode) => edit.mutate({ fn: () => addLine(c.id, code, qty, unit, disc, c.renewal_term_months ?? null, mode), msg: "Product added", done: () => setPickOpen(false) })} /> : null}
      <Panel title="Contract documents">
        {D.documents.length ? (
          <ul className="docs">{D.documents.map((d) => <li key={d.id}><span>{d.title}</span>{d.auto_generated ? <em className="tag blue">AUTO</em> : null}{d.conditional_on ? <em className="tag amber" title={d.conditional_on}>CONDITIONAL</em> : null}<small>{d.doc_type}</small></li>)}</ul>
        ) : <EmptyState title="No documents attached" compact />}
      </Panel>
      <Panel title="Special terms" actions={<Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending || special === (c.special_terms ?? "") || !!c.is_locked}>Save</Button>}>
        {special.trim() ? <p className="flag"><AlertTriangle className="h-4 w-4" />Legal approval required</p> : null}
        <Textarea value={special} onChange={(e) => setSpecial(e.target.value)} rows={4} disabled={!!c.is_locked} placeholder="Non-standard terms negotiated with the customer…" />
      </Panel>
      <Panel title="Recipients & approval">
        <div className="grid2">
          <div><h4>Internal</h4>
            {internal.length ? internal.map((r) => <div key={r.id} className="prow"><Person name={r.person_name} sub={`${r.role ?? ""} · ${r.email ?? ""}`} order={r.signing_order} />{rmBtn(r.id)}</div>) : <p className="muted">No internal recipients.</p>}
            <h4 className="mt-4">Approvals</h4>
            {D.approvals.length ? D.approvals.map((a) => (
              <div key={a.id} className="appr"><span className="cap">{a.approver_role}</span><span>{a.approver_name ?? a.email ?? "—"}</span><Pill s={a.status} />
                {a.status === "pending" || a.status === "requested" ? <span className="ab"><Button size="sm" variant="outline" onClick={() => onDecide(a.id, "approved")}>Approve</Button><Button size="sm" variant="ghost" onClick={() => onDecide(a.id, "rejected")}>Reject</Button></span> : null}
              </div>)) : <p className="muted">No approvals requested.</p>}
          </div>
          <div><h4>Customer</h4>
            {customer.length ? customer.map((r) => <div key={r.id} className="prow"><Person name={r.person_name} sub={`${r.role ?? ""} · ${r.email ?? ""}`} order={r.signing_order} />{rmBtn(r.id)}</div>) : <p className="muted">No customer recipients.</p>}
          </div>
        </div>
        {!c.is_locked ? <AddRecipient pending={edit.isPending} onAdd={(party, name, email, role, order, reset) => edit.mutate({ fn: () => addRecipient(c.id, party, name, email, role, order), msg: "Recipient added", done: reset })} /> : null}
      </Panel>
    </div>
  );
}

const ROLES = ["seller", "legal_approver", "finance_approver", "reviewer", "signer", "cc"];
function AddRecipient({ pending, onAdd }: { pending: boolean; onAdd: (party: string, name: string, email: string, role: string, order: number | null, reset: () => void) => void }) {
  const [party, setParty] = useState("customer");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("signer");
  const [order, setOrder] = useState("");
  const reset = () => { setName(""); setEmail(""); setOrder(""); };
  const valid = name.trim() && /\S+@\S+\.\S+/.test(email.trim());
  return (
    <div className="addrec">
      <h4>Add recipient</h4>
      <div className="addrec-row">
        <select value={party} onChange={(e) => setParty(e.target.value)} aria-label="Party"><option value="internal">Internal</option><option value="customer">Customer</option></select>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="h-9" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="h-9" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select>
        <Input value={order} onChange={(e) => setOrder(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Order" className="h-9 w-20" aria-label="Signing order" />
        <Button size="sm" className="grad" disabled={!valid || pending} onClick={() => onAdd(party, name.trim(), email.trim(), role, order ? Number(order) : null, reset)}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
      </div>
    </div>
  );
}

function SkuPicker({ open, onOpenChange, pending, onAdd }: { open: boolean; onOpenChange: (b: boolean) => void; pending: boolean; onAdd: (code: string, qty: number, unit: number | null, disc: number, mode: string) => void }) {
  const skus = useQuery({ queryKey: ["m4-skus"], queryFn: loadSkus, enabled: open, staleTime: 300_000 });
  const [term, setTerm] = useState("");
  const [sel, setSel] = useState<Sku | null>(null);
  const [qty, setQty] = useState("1");
  const [disc, setDisc] = useState("0");
  const [mode, setMode] = useState("annual");
  const [unit, setUnit] = useState("");
  useEffect(() => { if (!open) { setSel(null); setTerm(""); } }, [open]);
  const pick = (s: Sku) => { setSel(s); setMode(s.default_billing_mode === "monthly" ? "monthly" : "annual"); setQty("1"); setDisc("0"); setUnit(""); };
  const t = term.trim().toLowerCase();
  const list = (skus.data ?? []).filter((s) => !t || s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t));
  const groups = new Map<string, Sku[]>();
  for (const s of list) { const f = s.family ?? "Other"; groups.set(f, [...(groups.get(f) ?? []), s]); }
  const listPrice = sel ? (mode === "monthly" ? sel.monthly_unit_price : sel.annual_unit_price) : null;
  const q = Number(qty), d = Number(disc);
  const ok = sel && q > 0 && d >= 0 && d <= 100 && (unit === "" || Number(unit) >= 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Add product</DialogTitle></DialogHeader>
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name or code…" autoFocus />
        <div className="sku-list" style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e7ebf1", borderRadius: 10 }}>
          {skus.isLoading ? <p style={{ padding: 12, color: "#66728a", fontSize: 13 }}>Loading catalog…</p> : skus.error ? <p style={{ padding: 12, color: "#e0533d", fontSize: 13 }}>{(skus.error as Error).message}</p> : !list.length ? <p style={{ padding: 12, color: "#66728a", fontSize: 13 }}>No matching products.</p> :
            [...groups.entries()].map(([f, ss]) => (
              <div key={f}>
                <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#66728a", background: "#fafbfd", borderBottom: "1px solid #e7ebf1" }}>{f}</div>
                {ss.map((s) => (
                  <button key={s.code} type="button" onClick={() => pick(s)} style={{ display: "flex", width: "100%", gap: 8, alignItems: "center", padding: "8px 12px", fontSize: 13, textAlign: "left", borderBottom: "1px solid #f0f2f6", background: sel?.code === s.code ? "#eef3ff" : undefined }}>
                    <span style={{ flex: 1 }}>{s.name}{s.edition ? ` · ${s.edition}` : ""}<small style={{ display: "block", color: "#8a94a8", fontSize: 11 }}>{s.code} · {s.line_type === "one_time" ? "One-time" : "Recurring"}{s.unit ? ` · per ${s.unit}` : ""}</small></span>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: "#243b57" }}>{money(s.annual_unit_price)}/yr</span>
                  </button>))}
              </div>))}
        </div>
        {sel ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, fontSize: 12 }}>
            <label>Quantity<Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={1} className="h-9" /></label>
            <label>Discount %<Input value={disc} onChange={(e) => setDisc(e.target.value)} type="number" min={0} max={100} className="h-9" /></label>
            <label>Billing<select value={mode} onChange={(e) => setMode(e.target.value)} style={{ display: "block", width: "100%", height: 36, border: "1px solid #e7ebf1", borderRadius: 8, padding: "0 8px" }}><option value="annual">Annual</option><option value="monthly">Monthly</option></select></label>
            <label>Unit price override<Input value={unit} onChange={(e) => setUnit(e.target.value)} type="number" min={0} placeholder={listPrice == null ? "—" : String(listPrice)} className="h-9" /></label>
          </div>
        ) : null}
        <DialogFooter><Button className="grad" disabled={!ok || pending} onClick={() => sel && onAdd(sel.code, q, unit === "" ? null : Number(unit), d, mode)}>Add to order form</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Person({ name, sub, order, status }: { name: string | null; sub?: string; order?: number | null; status?: string }) {
  return <div className="person"><span className="av">{(name ?? "?").slice(0, 1).toUpperCase()}</span><div><b>{name ?? "—"}</b><small>{sub}</small></div>{order != null ? <span className="ord">#{order}</span> : null}{status ? <Pill s={status} /> : null}</div>;
}

function Feed({ items }: { items: ContractDetail["activity"] }) {
  return <ol className="feed">{items.map((a) => <li key={a.id}><b>{a.event_type.replace(/_/g, " ")}</b><span>{a.actor ?? "system"} · {new Date(a.occurred_at).toLocaleString()}</span>{a.detail && typeof a.detail === "object" && Object.keys(a.detail).length ? <code>{JSON.stringify(a.detail)}</code> : null}</li>)}</ol>;
}

function Versions({ D }: { D: ContractDetail }) {
  if (!D.versions.length) return <EmptyState title="No versions yet" compact />;
  return <ul className="vers">{D.versions.map((v) => <li key={v.id}><b>v{v.version_no}</b><span>{v.label ?? v.kind ?? "—"}</span>{v.is_signing_copy ? <em className="tag green">SIGNING COPY</em> : null}<Pill s={v.approval_state} /><small>{v.uploaded_by ?? v.source ?? "—"} · {day(v.created_at)}</small></li>)}</ul>;
}

function summarize(cs: unknown): string {
  if (!cs) return "No change summary recorded.";
  if (typeof cs === "string") return cs;
  const o = cs as Record<string, unknown>;
  if (typeof o.summary === "string") return o.summary;
  return Object.entries(o).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
}

function Room({ D, onRedline, onChange }: { D: ContractDetail; onRedline: () => void; onChange: () => void }) {
  const latest = D.versions[0];
  return (
    <div className="room">
      <div className="doc"><div className="mb-3 flex justify-end"><Button variant="outline" size="sm" asChild><Link to="/sales/contracts/$contractId/print" params={{ contractId: D.contract.id }} search={{ doc: "order_form" }} target="_blank" rel="noopener noreferrer"><Download className="mr-1 h-4 w-4" />Download PDF</Link></Button></div>{D.documents.some((d) => d.doc_type === "order_form" && d.content) ? null : <ContractDocument c={D.contract} customer={D.org?.name} />}<OrderFormDocument D={D} onChange={onChange} /></div>
      <aside>
        <Panel title="People">
          {D.recipients.length ? D.recipients.map((r) => {
            const sig = D.signatures.find((s) => s.signer_email === r.email);
            return <Person key={r.id} name={r.person_name} sub={r.role ?? r.party} status={sig?.status} />;
          }) : <p className="muted">No recipients.</p>}
          {D.approvals.map((a) => <Person key={a.id} name={a.approver_name ?? a.approver_role} sub={`${a.approver_role} approval`} status={a.status} />)}
        </Panel>
        <Panel className="nora-panel" title="◆ NORA insights"><p className="text-sm">{latest ? `v${latest.version_no} (${latest.kind ?? "version"}): ${summarize(latest.change_summary)}` : "No versions to analyze yet."}</p></Panel>
        <Panel title="Versions" actions={<Button size="sm" variant="outline" onClick={onRedline}><Upload className="mr-1 h-3 w-3" />Upload redline</Button>}><Versions D={D} /></Panel>
        <Panel title="Status">{D.activity.length ? <Feed items={D.activity.slice(0, 8)} /> : <p className="muted">No activity.</p>}</Panel>
      </aside>
    </div>
  );
}

function SendSign({ D, onSent }: { D: ContractDetail; onSent: () => void }) {
  const c = D.contract;
  const fin = useQuery({ queryKey: ["m4-finalize", c.id, c.current_version], queryFn: async () => finalizeContract(c.id, await actor()) });
  const send = useMutation({ mutationFn: async () => sendForSignature(c.id, await actor()), onSuccess: (n) => { toast.success(`Sent to ${n} signer(s)`); onSent(); }, onError: (e: Error) => toast.error(e.message) });
  const raw = fin.data?.checklist;
  const list: { label: string; ok: boolean }[] = Array.isArray(raw)
    ? raw.map((x: any) => ({ label: String(x?.label ?? x?.item ?? x?.key ?? "item"), ok: !!(x?.ok ?? x?.done ?? x?.pass) }))
    : raw && typeof raw === "object" ? Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({ label: k.replace(/_/g, " "), ok: !!v })) : [];
  const signers = D.recipients.filter((r) => r.signing_order != null).sort((a, b) => (a.signing_order ?? 0) - (b.signing_order ?? 0));
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Panel title="Send & sign" className="send-panel">
      {fin.isLoading ? <p className="muted">Checking readiness…</p> : fin.error ? <p className="text-sm text-[#c23a25]">{(fin.error as Error).message}</p> : (
        <div className="ss">
          <ul className="check">{list.length ? list.map((i) => <li key={i.label} className={i.ok ? "ok" : ""}>{i.ok ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}{i.label}</li>) : <li className="muted">No checklist returned.</li>}</ul>
          {fin.data?.ok ? (
            <div>
              <div className="locked"><Lock className="h-4 w-4" />Signing version v{c.signing_version ?? c.current_version ?? "—"} locked · hash <code>{c.document_hash ? c.document_hash.slice(0, 16) + "…" : "—"}</code></div>
              <h4>Signing order</h4>
              {signers.length ? signers.map((r) => <Person key={r.id} name={r.person_name} sub={r.email ?? ""} order={r.signing_order} />) : <p className="muted">No signers set.</p>}
              {!D.signatures.length ? <Button className="grad mt-3" onClick={() => send.mutate()} disabled={send.isPending}><Send className="mr-1 h-4 w-4" />Send for signature</Button> : null}
            </div>
          ) : <p className="muted">Complete the checklist to lock the signing version.</p>}
        </div>
      )}
      {D.signatures.length ? (
        <div className="sigs"><h4>Signers</h4>{D.signatures.map((s) => {
          const link = `${origin}/sign/${s.token}`;
          return <div key={s.id} className="sig"><Person name={s.signer_name} sub={s.signer_email ?? ""} order={s.signing_order} status={s.status} />
            <Input readOnly value={link} className="h-8 text-xs" /><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copied"); }}><Copy className="h-3 w-3" /></Button></div>;
        })}</div>
      ) : null}
    </Panel>
  );
}

function RedlineDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (b: boolean) => void; onSubmit: (label: string, summary: string) => void }) {
  const [label, setLabel] = useState("Customer redline");
  const [summary, setSummary] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Upload customer redline</DialogTitle></DialogHeader>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Version label" />
        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="What changed? (e.g. Net 60 requested, liability cap raised)" />
        <DialogFooter><Button onClick={() => onSubmit(label, summary)} disabled={!label.trim()}>Add version</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CSS = `
.m4-detail .of-sec{border-bottom:1px solid var(--hair)}.m4-detail .of-h{font-size:12px;font-weight:600;letter-spacing:.04em;color:#243b57;padding:12px 20px 6px}
.m4-detail .code{display:block;font-size:11px;color:#8a94a8}
.m4-detail .rm{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;color:#8a94a8}.m4-detail .rm:hover{background:#fdecea;color:#e0533d}
.m4-detail .of-tot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px 20px;background:linear-gradient(180deg,#f4f7ff,#fff)}
.m4-detail .of-tot div{display:flex;flex-direction:column;gap:2px}.m4-detail .of-tot span{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#66728a}.m4-detail .of-tot b{font-size:18px;color:var(--ink)}
.m4-detail .prow{display:flex;align-items:center;gap:6px}.m4-detail .prow>.person{flex:1}
.m4-detail .addrec{margin-top:16px;padding-top:14px;border-top:1px solid var(--hair)}
.m4-detail .addrec-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.m4-detail .addrec-row select{height:36px;border:1px solid var(--hair);border-radius:8px;padding:0 8px;font-size:13px;background:#fff}
.m4-detail .addrec-row input{flex:1;min-width:140px}
@media (max-width:700px){.m4-detail .of-tot{grid-template-columns:1fr}}
.m4-detail{--ink:#101a2e;--blue:#2f6bff;--purple:#8a5cf6;--amber:#c07a12;--hair:#e7ebf1;background:#f6f8fb;color:var(--ink);font-variant-numeric:tabular-nums}
.m4-detail section{border:1px solid var(--hair);border-radius:16px;box-shadow:0 1px 2px rgba(16,26,46,.05),0 8px 24px -16px rgba(16,26,46,.18);background:#fff}
.m4-detail .back{display:inline-flex;gap:6px;align-items:center;font-size:13px;color:#66728a;margin-bottom:12px}.m4-detail .back:hover{color:var(--blue)}
.m4-detail .hdr{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.m4-detail .title{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.m4-detail h1{font-size:24px;font-weight:600}
.m4-detail .meta{font-size:13px;color:#66728a;margin-top:4px}
.m4-detail .lock{display:inline-flex;gap:4px;align-items:center;font-size:11px;color:#66728a;background:#eef2f8;padding:2px 6px;border-radius:6px}
.m4-detail .hdr-actions{display:flex;gap:8px;flex-wrap:wrap}
.m4-detail .grad{background:linear-gradient(180deg,#3f78ff,#2f6bff);color:#fff;border-radius:8px;box-shadow:0 6px 14px rgba(47,107,255,.28)}
.m4-detail .tabs{display:flex;gap:6px;margin-bottom:16px;overflow-x:auto;padding:3px;border:1px solid var(--hair);border-radius:10px;background:#eef2f8;width:max-content;max-width:100%}
.m4-detail .tabs button{padding:7px 14px;border-radius:8px;font-size:13px;font-weight:500;color:#4a5670;background:#fff;border:1px solid var(--hair)}
.m4-detail .tabs button.on{background:linear-gradient(180deg,#3f78ff,#2f6bff);color:#fff;border-color:transparent;box-shadow:0 6px 14px rgba(47,107,255,.28)}
.m4-detail .pill{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;text-transform:capitalize}
.m4-detail .pill.green{background:#e3f8ee;color:#0b8a50}.m4-detail .pill.purple{background:#f5eafb;color:#8a3e9d}.m4-detail .pill.teal{background:#e2f7f8;color:#087985}.m4-detail .pill.amber{background:#fdf2e0;color:#c07a12}.m4-detail .pill.red{background:#fde8e4;color:#c23a25}.m4-detail .pill.grey{background:#eef2f8;color:#4a5670}
.m4-detail .ws{display:flex;flex-direction:column;gap:16px}
.m4-detail .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.m4-detail dl{display:grid;grid-template-columns:120px 1fr;gap:8px 12px;font-size:13px}.m4-detail dt{color:#66728a}.m4-detail dd{font-weight:500}
.m4-detail .nora-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:14px 16px;border-radius:16px;background:linear-gradient(145deg,#f3eeff,#fff 70%);border:1px solid #e1d8fd;font-size:13px;box-shadow:0 1px 2px rgba(16,26,46,.04),0 10px 24px -20px rgba(138,92,246,.65)}
.m4-detail .nora-bar.ok{background:#effaf4;border-color:#cdeedd}
.m4-detail .nora-bar .dia{font-weight:700;color:var(--purple)}.m4-detail .nora-bar .chip{background:#fff;border:1px solid #e1d8fd;padding:3px 8px;border-radius:6px}
.m4-detail table{width:100%;font-size:13px;border-collapse:collapse}.m4-detail th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#66728a;background:#fafbfd;padding:10px 16px;border-bottom:1px solid var(--hair)}
.m4-detail td{padding:10px 16px;border-bottom:1px solid var(--hair)}.m4-detail .r{text-align:right}.m4-detail tbody tr:hover{background:#f3f7ff}
.m4-detail .docs li,.m4-detail .vers li{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px}
.m4-detail .docs small,.m4-detail .vers small{margin-left:auto;color:#8792a8;font-size:11px}
.m4-detail .tag{font-style:normal;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px}.m4-detail .tag.blue{background:#e8efff;color:var(--blue)}.m4-detail .tag.amber{background:#fdf2e0;color:var(--amber)}.m4-detail .tag.green{background:#e3f8ee;color:#0b8a50}
.m4-detail .flag{display:flex;gap:6px;align-items:center;color:var(--amber);background:#fdf2e0;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:600;margin-bottom:8px}
.m4-detail h4{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#66728a;font-weight:700;margin-bottom:8px}
.m4-detail .muted{color:#8792a8;font-size:13px}
.m4-detail .person{display:flex;gap:10px;align-items:center;padding:6px 0}.m4-detail .person b{display:block;font-size:13px}.m4-detail .person small{color:#8792a8;font-size:11px}
.m4-detail .av{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#e8efff;color:var(--blue);font-weight:700;font-size:12px}
.m4-detail .ord{margin-left:auto;font-size:11px;color:#66728a}
.m4-detail .appr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;padding:6px 0}.m4-detail .cap{text-transform:capitalize;font-weight:600}.m4-detail .ab{display:flex;gap:4px;margin-left:auto}
.m4-detail .room{display:grid;grid-template-columns:minmax(0,7fr) minmax(280px,3fr);gap:16px}@media(max-width:1000px){.m4-detail .room{grid-template-columns:1fr}}
.m4-detail .room aside{display:flex;flex-direction:column;gap:12px}
.m4-detail .room aside section{transition:transform .14s ease,box-shadow .14s ease}.m4-detail .room aside section:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(16,26,46,.05),0 14px 28px -18px rgba(16,26,46,.24)}
.m4-detail .nora-panel{border-color:#e1d8fd!important;background:linear-gradient(145deg,#f3eeff,#fff 72%)!important}.m4-detail .nora-panel h3{color:var(--purple)}
.m4-detail .feed li{padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px}.m4-detail .feed b{display:block;text-transform:capitalize}.m4-detail .feed span{color:#8792a8;font-size:11px}.m4-detail .feed code{display:block;font-size:11px;color:#4a5670;word-break:break-all}
.m4-detail .activity-panel,.m4-detail .versions-panel,.m4-detail .state-panel{position:relative;overflow:hidden}.m4-detail .activity-panel:before,.m4-detail .versions-panel:before,.m4-detail .state-panel:before,.m4-detail .send-panel:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,var(--blue),#8a5cf6)}
.m4-detail .ss{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.m4-detail .send-panel{position:relative;overflow:hidden;background:linear-gradient(150deg,#f5fbf8,#fff 45%)}
.m4-detail .check li{display:flex;gap:8px;align-items:center;font-size:13px;color:#8792a8;padding:6px 0;text-transform:capitalize}.m4-detail .check li.ok{color:#0b8a50}.m4-detail .check li.ok svg{padding:2px;border-radius:50%;background:#12b76a;color:#fff;box-sizing:content-box}
.m4-detail .locked{display:flex;gap:8px;align-items:center;background:linear-gradient(135deg,#eef3ff,#f5f0ff);border:1px solid #d6e2ff;color:#1f4fd1;padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:12px;box-shadow:0 6px 16px -14px rgba(47,107,255,.65)}
.m4-detail .sigs{margin-top:16px;border-top:1px solid var(--hair);padding-top:12px}.m4-detail .sig{display:grid;grid-template-columns:minmax(220px,1fr) minmax(200px,2fr) auto;gap:8px;align-items:center}
@media(max-width:700px){.m4-detail .sig{grid-template-columns:1fr}.m4-detail .tabs{width:100%}}
`;
