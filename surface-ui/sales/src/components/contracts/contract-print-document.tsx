import type { ContractDetail } from "@v3/sales/lib/contracts";
import { money } from "@v3/sales/lib/contracts";
import { hasCertificate, record, records, text, utc, verification, type PrintDoc } from "@v3/sales/lib/contract-print";

const amount = (x: unknown) => x == null || x === "" || !Number.isFinite(Number(x)) ? "—" : money(Number(x));
const percent = (x: unknown) => x == null ? "—" : `${text(x)}%`;
const date = (x: unknown) => typeof x === "string" ? x.slice(0, 10) : "—";

export function ContractPrintDocument({ D, doc }: { D: ContractDetail; doc: PrintDoc }) {
  const c = D.contract;
  if (doc === "certificate") {
    if (!hasCertificate(D)) return <article className="print-paper"><h1>Certificate unavailable</h1><p>This contract has no recorded completion certificate or execution date.</p></article>;
    const certificate = record(D.documents.find(d => d.doc_type === "certificate")?.content);
    const hash = c.document_hash ?? certificate.hash;
    const executed = c.executed_at ?? certificate.executed_at;
    return <article className="print-paper certificate">
      <header><p className="print-brand">Experience.com</p><h1>Certificate of Completion</h1><p className="reference">Reference: {text(c.contract_number)} · {text(hash)}</p></header>
      <p className="completion">{executed ? `Document completed by all parties on ${utc(executed)}` : "Completion date not recorded"}</p>
      {D.signatures.length ? D.signatures.map(s => <section className="signer-record" key={s.id}>
        <h2>{s.signer_name ?? "Signer"}</h2><p>{text(s.signer_email)} · {text(s.party)} · {text(s.status)}</p>
        <dl className="audit-grid">
          <div><dt>SENT</dt><dd>{utc(s.sent_at)}</dd></div><div><dt>VIEWED</dt><dd>{utc(s.viewed_at)}</dd></div>
          <div><dt>SIGNED</dt><dd>{utc(s.signed_at)}</dd></div><div><dt>IP ADDRESS</dt><dd>{s.signed_ip ?? "Not recorded"}</dd></div>
          <div><dt>IDENTITY METHOD</dt><dd>{s.identity_method ?? "Not recorded"}</dd></div><div><dt>EMAIL VERIFIED</dt><dd>{verification(s.email_verified)}</dd></div>
          <div><dt>SIGNING VERSION</dt><dd>{text(s.version_no)}</dd></div><div><dt>DOCUMENT HASH</dt><dd className="hash">{text(s.version_hash)}</dd></div>
        </dl>
      </section>) : <p>No signer audit records available.</p>}
      <footer>Signing version {text(c.signing_version ?? certificate.signing_version)}<br />Document hash: <span className="hash">{text(hash)}</span></footer>
    </article>;
  }
  const order = D.documents.find(d => d.doc_type === "order_form" && d.content);
  if (!order) return <article className="print-paper"><h1>No order form yet</h1><p>Generate the assembled order form in the contract’s Document tab before exporting.</p></article>;
  const ct = record(order.content), master = record(ct.master), totals = record(ct.totals), term = record(ct.term);
  const subscriber = typeof ct.subscriber === "string" ? ct.subscriber : text(record(ct.subscriber).name ?? record(ct.customer).name ?? D.org?.name);
  const lines = records(ct.lines);
  const recurring = Array.isArray(ct.recurring) ? records(ct.recurring) : lines.filter(l => l.line_type !== "one_time");
  const oneTime = Array.isArray(ct.one_time) ? records(ct.one_time) : lines.filter(l => l.line_type === "one_time");
  const sig = record(ct.signature);
  const customer = D.recipients.find(r => !["internal", "experience"].includes(r.party.toLowerCase()) && r.role === "signer");
  const customerSig = D.signatures.find(s => s.signer_email === customer?.email && s.signed_at);
  const providerSig = D.signatures.find(s => ["internal", "experience"].includes((s.party ?? "").toLowerCase()) && s.signed_at);
  const table = (rows: Record<string, unknown>[]) => rows.length ? <table><thead><tr><th>Name / code</th><th>Qty / unit</th><th>Unit price</th><th>Discount</th><th>Billing</th><th>Subtotal</th></tr></thead><tbody>{rows.map((l, i) => <tr key={i}><td><b>{text(l.name ?? l.name_snapshot)}</b><small>{text(l.code ?? l.product_code)}</small>{l.overage_rate != null || l.overage_unit ? <small>Overage: {amount(l.overage_rate)} / {text(l.overage_unit)} · {text(l.overage_method)}</small> : null}</td><td>{text(l.qty)}<small>{text(l.unit)}</small></td><td>{amount(l.unit_price)}</td><td>{percent(l.discount_pct)}</td><td>{text(l.billing ?? l.billing_mode)}</td><td>{amount(l.subtotal ?? l.net)}</td></tr>)}</tbody></table> : <p>No lines.</p>;
  return <>
    <article className="print-paper order-form">
      <header><p className="print-brand">Experience.com</p><h1>Order Form</h1><p>{text(ct.contract_number ?? c.contract_number)}{c.executed_at ? ` · Executed ${utc(c.executed_at)}` : ""}</p></header>
      <div className="parties"><div><small>Provider</small><b>{text(ct.entity ?? "BuyersRoad, Inc. d/b/a Experience.com")}</b></div><div><small>Subscriber</small><b>{subscriber}</b></div></div>
      <p>Master Subscription Agreement · version {text(master.version ?? c.master_agreement_version)}<br /><span className="hash">{text(master.url ?? c.master_agreement_url)}</span></p>
      <h2>§1.1 Recurring</h2>{table(recurring)}<h2>§1.2 One-time</h2>{table(oneTime)}
      <div className="print-totals"><div><small>Total recurring (annualized ACV)</small><b>{amount(ct.total_recurring ?? totals.total_recurring ?? ct.acv ?? c.acv)}</b></div><div><small>Total one-time</small><b>{amount(ct.total_one_time ?? totals.total_one_time ?? c.total_one_time)}</b></div></div>
      <h2>§2 Term</h2><p>{date(ct.start_date ?? term.start ?? c.start_date)} — {date(ct.end_date ?? term.end ?? c.end_date)} · {text(ct.term_months ?? term.months)} months</p>
      <h2>§3 Payment</h2><p>{text(ct.payment_terms ?? c.payment_terms)} · billed {text(ct.billing_mode ?? c.billing_mode ?? c.billing_frequency)}</p>
      <h2>§4 Offer expiration &amp; renewal</h2><p>Offer expires {date(ct.expiration_at ?? c.expiration_at)} · renewal uplift {percent(ct.renewal_uplift_pct ?? c.renewal_uplift_pct)}</p>
      <div className="signature-block"><div><small>Experience.com</small><b>{text(sig.experience_signer ?? "Scott Harris")}</b><p>{text(sig.experience_title ?? "CEO")}</p><p>{providerSig ? `Signed by ${text(providerSig.signer_name)} · ${utc(providerSig.signed_at)}` : "Signature not recorded"}</p></div><div><small>{subscriber}</small><b>{customer?.person_name ?? customerSig?.signer_name ?? "Signer not recorded"}</b><p>{text(customer?.email ?? customerSig?.signer_email)}</p><p>{customerSig ? `Signed ${utc(customerSig.signed_at)}` : "Signature not recorded"}</p></div></div>
      <footer>Signing version {text(c.signing_version)} · Document hash <span className="hash">{text(c.document_hash)}</span></footer>
    </article>
    {D.documents.filter(d => d.doc_type === "exhibit").map(e => { const x = record(e.content); return <article className="print-paper exhibit" key={e.id}><p className="print-brand">Experience.com · Exhibit</p><h1>{e.title}</h1>{x.overview ? <p>{text(x.overview)}</p> : null}{Array.isArray(x.features) ? <ul>{x.features.map((f: unknown, i: number) => { const obj = record(f); return <li key={i}>{typeof f === "string" ? f : text(obj.name ?? obj.title)}{obj.description ? ` — ${text(obj.description)}` : ""}</li>; })}</ul> : null}</article>; })}
  </>;
}

export const CONTRACT_PRINT_CSS = `
.contract-print{background:var(--gh-canvas);color:var(--gh-ink);min-height:100vh;padding:24px;font:13px/1.5 Arial,sans-serif;font-variant-numeric:tabular-nums}
.contract-print .print-toolbar{max-width:900px;margin:0 auto 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}.contract-print .print-toolbar button{background:var(--gh-primary-gradient);color:var(--gh-surface);box-shadow:var(--gh-control-shadow)}
.contract-print .print-paper{max-width:900px;margin:0 auto 24px;padding:44px;background:var(--gh-surface);border:1px solid var(--gh-line);border-radius:16px;box-shadow:var(--gh-shadow)}
.contract-print h1,.contract-print h2{font-family:Georgia,'Times New Roman',serif;letter-spacing:0}.contract-print h1{font-size:30px;margin:10px 0}.contract-print h2{font-size:18px;margin:22px 0 8px}.contract-print header{border-bottom:3px solid var(--gh-blue);padding-bottom:18px;margin-bottom:20px}.contract-print .print-brand{color:var(--gh-blue);font-weight:700;font-size:14px}.contract-print p{margin:8px 0}.contract-print small{display:block;color:var(--gh-muted);font-size:10px}.contract-print .hash,.contract-print .reference{overflow-wrap:anywhere}.contract-print .parties,.contract-print .print-totals,.contract-print .signature-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0}.contract-print .print-totals{border-top:1px solid var(--gh-line);padding-top:14px}.contract-print .print-totals b{font-size:20px}.contract-print table{width:100%;border-collapse:collapse;font-size:11px}.contract-print th{text-align:left;background:var(--gh-header);text-transform:uppercase;font-size:9px;padding:8px}.contract-print td{padding:9px 8px;border-bottom:1px solid var(--gh-line);vertical-align:top;overflow-wrap:anywhere}.contract-print .signature-block>div{border-top:1px solid var(--gh-ink);padding-top:12px}.contract-print footer{font-size:10px;border-top:1px solid var(--gh-line);margin-top:24px;padding-top:12px;overflow-wrap:anywhere}.contract-print ul{list-style:disc;padding-left:20px}.contract-print li{margin:8px 0}.contract-print .signer-record{border-bottom:1px solid var(--gh-line);padding-bottom:20px;break-inside:avoid}.contract-print .audit-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}.contract-print dt{font-size:10px;font-weight:700;color:var(--gh-muted)}.contract-print dd{margin:3px 0;overflow-wrap:anywhere}
@media(max-width:640px){.contract-print{padding:12px}.contract-print .print-paper{padding:20px}.contract-print .parties,.contract-print .signature-block,.contract-print .audit-grid{grid-template-columns:1fr}.contract-print table{font-size:9px}.contract-print th,.contract-print td{padding:6px 3px}.contract-print .print-toolbar{flex-wrap:wrap}}
@page{size:letter;margin:16mm}
@media print{body:has(.contract-print){background:var(--gh-surface)!important}.contract-print{min-height:0;padding:0;background:var(--gh-surface);color:var(--gh-print-ink, var(--foreground));font-size:11px}.contract-print .print-toolbar{display:none!important}.contract-print .print-paper{max-width:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:var(--gh-surface)}.contract-print *{color:var(--gh-print-ink, var(--foreground))!important;box-shadow:none!important;background:transparent!important}.contract-print header{border-color:var(--gh-print-ink);padding-bottom:10px;margin-bottom:12px}.contract-print h1{font-size:25px}.contract-print h2{font-size:16px;margin:12px 0 5px}.contract-print p{margin:4px 0}.contract-print .parties,.contract-print .print-totals,.contract-print .signature-block{margin:10px 0;gap:16px}.contract-print footer{margin-top:8px;padding-top:6px;break-before:avoid}.contract-print .exhibit{break-before:page}.contract-print h1,.contract-print h2{break-after:avoid}.contract-print tr,.contract-print .signature-block,.contract-print .print-totals{break-inside:avoid}.contract-print thead{display:table-header-group}.contract-print .parties,.contract-print .signature-block,.contract-print .audit-grid{grid-template-columns:1fr 1fr}.contract-print table{font-size:10px}.contract-print th,.contract-print td{padding:5px}}
`;