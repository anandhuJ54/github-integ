import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { EmptyState, Panel } from "@/components/console/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { assembleDocument, day, generateInvoice, loadInvoices, loadUsage, money, recordUsage, type ContractDetail } from "@/lib/contracts";

/* Order form + exhibits rendered from exp_contract_documents.content (m4_assemble_document output). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const v = (x: unknown) => (x == null || x === "" ? "—" : String(x));
const pct = (x: unknown) => (x == null || x === "" ? "—" : `${Number(x)}%`);

export function OrderFormDocument({ D, onChange }: { D: ContractDetail; onChange: () => void }) {
  const c = D.contract;
  const of = D.documents.find((d) => d.doc_type === "order_form");
  const exhibits = D.documents.filter((d) => d.doc_type === "exhibit");
  const gen = useMutation({
    mutationFn: () => assembleDocument(c.id),
    onSuccess: () => { toast.success("Order form regenerated"); onChange(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const btn = <Button size="sm" className="grad" disabled={gen.isPending || !!c.is_locked} onClick={() => gen.mutate()}><RefreshCw className="mr-1 h-3.5 w-3.5" />{of?.content ? "Refresh document" : "Generate document"}</Button>;
  const ct: Any = of?.content;
  if (!ct) return <Panel title="Order form" actions={btn}><EmptyState title="No order form yet" description="Generate the order form to assemble it from the contract's lines, terms and exhibits." compact /></Panel>;

  const lines: Any[] = Array.isArray(ct.lines) ? ct.lines : D.lineItems;
  const rec = lines.filter((l) => (l.line_type ?? "recurring") !== "one_time");
  const one = lines.filter((l) => l.line_type === "one_time");
  const hasOver = lines.some((l) => l.overage_rate != null || l.overage_unit);
  const master = ct.master ?? {};
  const tot = ct.totals ?? {};
  const subscriber = ct.subscriber?.name ?? ct.customer?.name ?? D.org?.name ?? "Subscriber";
  const signer = D.recipients.find((r) => r.party !== "internal" && r.party !== "experience" && (r.role === "signer" || r.signing_order != null));
  const table = (ls: Any[]) => (
    <table className="of-t"><thead><tr><th>Product</th><th>Code</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit price</th><th className="r">Disc.</th><th>Billing</th>{hasOver ? <th>Overage</th> : null}<th className="r">Subtotal</th></tr></thead>
      <tbody>{ls.map((l, i) => <tr key={l.id ?? i}><td>{v(l.name ?? l.name_snapshot)}</td><td className="mono">{v(l.product_code ?? l.code)}</td><td className="r num">{v(l.qty)}</td><td>{v(l.unit)}</td><td className="r num">{money(l.unit_price)}</td><td className="r num">{pct(l.discount_pct)}</td><td className="cap">{v(l.billing_mode)}</td>{hasOver ? <td>{l.overage_rate != null ? `${money(l.overage_rate)} / ${v(l.overage_unit)}${l.overage_method ? ` · ${l.overage_method}` : ""}` : "—"}</td> : null}<td className="r num">{money(l.subtotal ?? l.net)}</td></tr>)}</tbody></table>
  );
  return (
    <Panel title="Order form" actions={btn}>
      <style>{OF_CSS}</style>
      <article className="of">
        <header><h2>Order Form</h2><p>{v(ct.contract_number ?? c.contract_number)}</p></header>
        <div className="parties"><div><small>Provider</small><b>BuyersRoad, Inc. d/b/a Experience.com</b></div><span>↔</span><div><small>Subscriber</small><b>{subscriber}</b></div></div>
        <p className="ma">Governed by the Master Subscription Agreement{master.version ?? c.master_agreement_version ? ` (version ${master.version ?? c.master_agreement_version})` : ""}{master.url ?? c.master_agreement_url ? <> — <a href={master.url ?? c.master_agreement_url} target="_blank" rel="noreferrer">{master.url ?? c.master_agreement_url}</a></> : null}.</p>
        <h3>§1.1 Recurring</h3>{rec.length ? table(rec) : <p className="muted">No recurring lines.</p>}
        <h3>§1.2 One-time</h3>{one.length ? table(one) : <p className="muted">No one-time lines.</p>}
        <div className="tots"><div><small>Total recurring (ACV)</small><b>{money(tot.total_recurring ?? c.total_recurring ?? c.acv)}</b></div><div><small>Total one-time</small><b>{money(tot.total_one_time ?? c.total_one_time)}</b></div></div>
        <h3>§2 Term</h3><p>{day(ct.term?.start ?? c.start_date)} → {day(ct.term?.end ?? c.end_date)}{ct.term?.months ?? c.renewal_term_months ? ` · ${ct.term?.months ?? c.renewal_term_months} months` : ""}</p>
        <h3>§3 Payment</h3><p>{v(ct.payment_terms ?? c.payment_terms)} · billed {v(ct.billing_mode ?? c.billing_mode ?? c.billing_frequency)}{hasOver ? " · overages billed per the rates in §1.1" : ""}</p>
        <h3>§4 Offer expiration &amp; renewal</h3><p>Offer expires {day(ct.expiration_at ?? c.expiration_at)} · renewal uplift {pct(ct.renewal_uplift_pct ?? c.renewal_uplift_pct)}</p>
        <div className="sig"><div><small>Experience.com</small><b>Scott Harris</b><span>Chief Executive Officer</span><i /></div><div><small>{subscriber}</small><b>{signer?.person_name ?? "—"}</b><span>{signer?.email ?? "Signer not yet added"}</span><i /></div></div>
        {exhibits.map((e) => { const x: Any = e.content ?? {}; const feats: Any[] = Array.isArray(x.features) ? x.features : []; return (
          <section key={e.id} className="exh"><h3>{e.title}</h3>{x.overview ? <p>{String(x.overview)}</p> : null}
            {feats.length ? <ul>{feats.map((f, i) => <li key={i}>{typeof f === "string" ? f : f?.name ?? f?.title ?? JSON.stringify(f)}{typeof f === "object" && f?.description ? <small> — {f.description}</small> : null}</li>)}</ul> : null}</section>); })}
      </article>
    </Panel>
  );
}

const monthBounds = () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth(), 1); const e = new Date(n.getFullYear(), n.getMonth() + 1, 0); const f = (d: Date) => d.toISOString().slice(0, 10); return [f(s), f(e)] as const; };
const TYPE_TONE: Record<string, string> = { subscription: "blue", one_time: "purple", overage: "amber", renewal_notice: "teal" };

export function BillingTab({ D }: { D: ContractDetail }) {
  const c = D.contract;
  const qc = useQueryClient();
  const inv = useQuery({ queryKey: ["m4-invoices", c.id], queryFn: () => loadInvoices(c.id) });
  const use = useQuery({ queryKey: ["m4-usage", c.id], queryFn: () => loadUsage(c.id) });
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["m4-contract", c.id] }); void qc.invalidateQueries({ queryKey: ["m4-invoices", c.id] }); void qc.invalidateQueries({ queryKey: ["m4-usage", c.id] }); };
  const m = useMutation({ mutationFn: async (x: { fn: () => Promise<unknown>; msg: string; done?: () => void }) => { await x.fn(); return x; }, onSuccess: (x) => { toast.success(x.msg); x.done?.(); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const gen = (type: string) => { const [ps, pe] = type === "overage" ? monthBounds() : [null, null]; m.mutate({ fn: () => generateInvoice(c.id, type, ps, pe), msg: `${type.replace("_", "-")} invoice generated` }); };

  const codes = [...new Set(D.lineItems.map((l) => l.product_code ?? l.product_key).filter(Boolean))] as string[];
  const [mb0, mb1] = monthBounds();
  const [code, setCode] = useState(""); const [metric, setMetric] = useState(""); const [ps, setPs] = useState(mb0); const [pe, setPe] = useState(mb1); const [meas, setMeas] = useState(""); const [hw, setHw] = useState("");
  const okUsage = (code || codes[0]) && metric.trim() && meas !== "" && Number(meas) >= 0 && ps && pe;

  return (
    <div className="bill">
      <style>{BILL_CSS}</style>
      <Panel title="Invoices" bodyClassName="p-0" actions={
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" className="grad" disabled={m.isPending}>Generate invoice<ChevronDown className="ml-1 h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onClick={() => gen("subscription")}>Subscription</DropdownMenuItem><DropdownMenuItem onClick={() => gen("one_time")}>One-time</DropdownMenuItem><DropdownMenuItem onClick={() => gen("overage")}>Overage (this month)</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}>
        {inv.isLoading ? <p className="muted p-5">Loading invoices…</p> : inv.error ? <p className="err p-5">{(inv.error as Error).message}</p> : !inv.data?.length ? <div className="p-5"><EmptyState title="No invoices yet" description="Generate a subscription, one-time or overage invoice from this contract." compact /></div> : (
          <table><thead><tr><th /><th>Number</th><th>Type</th><th>Period</th><th>Due</th><th>Status</th><th className="r">Total</th></tr></thead>
            <tbody>{inv.data.map((i) => (<Fragment key={i.id}>
              <tr className="click" onClick={() => setOpen(open === i.id ? null : i.id)}><td>{open === i.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td><td className="mono">{i.number ?? "—"}</td><td><span className={`bp ${TYPE_TONE[i.invoice_type] ?? "grey"}`}>{i.invoice_type.replace(/_/g, " ")}</span></td><td>{i.period_start ? `${day(i.period_start)} → ${day(i.period_end)}` : "—"}</td><td>{day(i.due_at)}</td><td>{i.invoice_type === "renewal_notice" ? <span className="bp grey">Draft</span> : <span className={`bp ${(i.status ?? "") === "paid" ? "green" : "grey"}`}>{i.status ?? "—"}</span>}</td><td className="r num">{money(i.total)}</td></tr>
              {open === i.id ? <tr key={`${i.id}-l`} className="sub"><td /><td colSpan={6}>{i.lines.length ? <table className="inner"><thead><tr><th>Description</th><th>Code</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit price</th><th className="r">Amount</th></tr></thead><tbody>{i.lines.map((l, k) => <tr key={l.id ?? k}><td>{l.description ?? "—"}</td><td className="mono">{l.product_code ?? "—"}</td><td className="r num">{l.qty ?? "—"}</td><td>{l.unit ?? "—"}</td><td className="r num">{money(l.unit_price)}</td><td className="r num">{money(l.amount)}</td></tr>)}</tbody></table> : <p className="muted">No lines on this invoice.</p>}</td></tr> : null}
            </Fragment>))}</tbody></table>)}
      </Panel>

      <Panel title="Usage" actions={<Button size="sm" variant="outline" disabled={m.isPending || !use.data?.length} onClick={() => gen("overage")}>Preview overage invoice</Button>}>
        <div className="uform">
          <select value={code || codes[0] || ""} onChange={(e) => setCode(e.target.value)} aria-label="Product">{codes.length ? codes.map((x) => <option key={x} value={x}>{x}</option>) : <option value="">No contract products</option>}</select>
          <Input className="h-9" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Metric (e.g. credits)" />
          <Input className="h-9" type="date" value={ps} onChange={(e) => setPs(e.target.value)} aria-label="Period start" />
          <Input className="h-9" type="date" value={pe} onChange={(e) => setPe(e.target.value)} aria-label="Period end" />
          <Input className="h-9" type="number" min={0} value={meas} onChange={(e) => setMeas(e.target.value)} placeholder="Measured qty" />
          <Input className="h-9" type="number" min={0} value={hw} onChange={(e) => setHw(e.target.value)} placeholder="High-water (opt.)" />
          <Button size="sm" className="grad" disabled={!okUsage || m.isPending} onClick={() => m.mutate({ fn: () => recordUsage(c.id, code || codes[0]!, metric.trim(), ps, pe, Number(meas), hw === "" ? null : Number(hw)), msg: "Usage recorded", done: () => { setMeas(""); setHw(""); } })}>Record</Button>
        </div>
        {use.isLoading ? <p className="muted">Loading usage…</p> : !use.data?.length ? <p className="muted">No usage recorded.</p> : (
          <table><thead><tr><th>Product</th><th>Metric</th><th>Period</th><th className="r">Included</th><th className="r">Measured</th><th className="r">High-water</th><th className="r">Over</th></tr></thead>
            <tbody>{use.data.map((u, i) => { const over = u.measured_qty != null && u.included_qty != null ? Math.max(0, Number(u.measured_qty) - Number(u.included_qty)) : null; return <tr key={u.id ?? i}><td className="mono">{u.product_code}</td><td>{u.metric}</td><td>{day(u.period_start)} → {day(u.period_end)}</td><td className="r num">{u.included_qty ?? "—"}</td><td className="r num">{u.measured_qty ?? "—"}</td><td className="r num">{u.high_water_qty ?? "—"}</td><td className={`r num ${over ? "over" : ""}`}>{over ?? "—"}</td></tr>; })}</tbody></table>)}
      </Panel>
    </div>
  );
}

const OF_CSS = `
.of{font-size:13px;color:#243b57}.of header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #2f6bff;padding-bottom:8px;margin-bottom:12px}
.of h2{font-size:20px;font-weight:600;color:#101a2e}.of h3{font-size:13px;font-weight:600;color:#101a2e;margin:16px 0 6px}
.of .parties{display:flex;gap:16px;align-items:center;padding:12px;border:1px solid #e7ebf1;border-radius:10px;background:linear-gradient(180deg,#f4f7ff,#fff)}.of .parties>div{flex:1;display:flex;flex-direction:column}
.of small{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#66728a}.of .ma{margin-top:8px;color:#66728a}.of .ma a{color:#2f6bff}
.of .of-t{width:100%;border:1px solid #e7ebf1;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden}.of .of-t th{background:#fafbfd;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#66728a;text-align:left;padding:7px 9px;border-bottom:1px solid #e7ebf1}.of .of-t td{padding:7px 9px;border-bottom:1px solid #f0f2f6;font-variant-numeric:tabular-nums}.of .r{text-align:right}.of .mono{font-family:ui-monospace,monospace;font-size:11.5px}.of .cap{text-transform:capitalize}
.of .tots{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.of .tots>div{padding:12px;border-radius:10px;border:1px solid #e7ebf1;background:linear-gradient(180deg,#eef9f3,#fff);display:flex;flex-direction:column}.of .tots b{font-size:18px;color:#101a2e}
.of .sig{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}.of .sig>div{display:flex;flex-direction:column;gap:2px;padding:12px;border:1px solid #e7ebf1;border-radius:10px}.of .sig i{display:block;height:28px;border-bottom:1px solid #243b57;margin-top:10px}
.of .exh{margin-top:18px;padding-top:12px;border-top:1px dashed #e7ebf1}.of .exh ul{list-style:disc;padding-left:20px}.of .muted{color:#8a94a8}
@media (max-width:700px){.of .tots,.of .sig{grid-template-columns:1fr}.of .of-t{display:block;overflow-x:auto}}
`;
const BILL_CSS = `
.bill{display:flex;flex-direction:column;gap:16px}.bill table{width:100%;font-size:13px;font-variant-numeric:tabular-nums}.bill th{background:#fafbfd;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#66728a;text-align:left;padding:8px 12px;border-bottom:1px solid #e7ebf1}.bill td{padding:8px 12px;border-bottom:1px solid #f0f2f6}
.bill tr.click{cursor:pointer}.bill tr.click:hover{background:#f7f9fe}.bill tr.sub>td{background:#fbfcfe}.bill .inner th{background:#fff}.bill .r{text-align:right}.bill .mono{font-family:ui-monospace,monospace;font-size:11.5px}.bill .muted{color:#8a94a8;font-size:13px}.bill .err{color:#e0533d;font-size:13px}.bill .over{color:#c07a12;font-weight:600}
.bill .bp{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;text-transform:capitalize}.bp.blue{background:#eaf0ff;color:#2f6bff}.bp.purple{background:#f2ecff;color:#8a5cf6}.bp.amber{background:#fdf3e2;color:#c07a12}.bp.teal{background:#e3f7f5;color:#0e8f84}.bp.green{background:#e6f8ef;color:#12b76a}.bp.grey{background:#eef2f8;color:#66728a}
.bill .uform{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.bill .uform select{height:36px;border:1px solid #e7ebf1;border-radius:8px;padding:0 8px;font-size:13px;background:#fff}.bill .uform input{width:auto;flex:1;min-width:120px}
`;
