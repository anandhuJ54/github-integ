/* Rendered contract preview built only from stored contract terms. Shared by the internal Contract Room and public /sign. */
const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const m = (n: unknown) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : fmt.format(Number(n)));
const d = (s: unknown) => (s ? new Date(String(s)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—");

export type DocContract = {
  name?: string | null;
  contract_number?: string | null;
  acv?: number | null;
  payment_terms?: string | null;
  billing_frequency?: string | null;
  renewal_term_months?: number | null;
  auto_renew?: boolean | null;
  notice_period_days?: number | null;
  special_terms?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  terms?: Record<string, any> | null;
};

export function productsFromTerms(terms: Record<string, any> | null | undefined): { name: string; qty?: number | null; net?: number | null }[] {
  const qs = terms?.quote_state ?? {};
  const arr = (qs.lines ?? qs.products ?? qs.entitlements ?? terms?.lines ?? []) as any[];
  return Array.isArray(arr)
    ? arr.map((p) => ({ name: String(p?.name ?? p?.label ?? p?.product_key ?? p?.key ?? "Item"), qty: p?.qty ?? p?.quantity ?? null, net: p?.net ?? p?.total ?? null }))
    : [];
}

export function ContractDocument({ c, customer }: { c: DocContract; customer?: string | null }) {
  const qs = c.terms?.quote_state ?? {};
  const sum = c.terms?.quote_summary ?? {};
  const acv = c.acv ?? sum.estimatedArr ?? null;
  const items = productsFromTerms(c.terms);
  const who = customer ?? qs.accountName ?? "Customer";
  return (
    <article className="cdoc">
      <style>{CSS}</style>
      <header>
        <p className="eyebrow">Master Subscription Agreement</p>
        <h1>{c.name ?? "Agreement"}</h1>
        <p className="meta">{c.contract_number ?? "—"} · between <b>Experience.com</b> and <b>{who}</b></p>
      </header>
      <h2>1. Services</h2>
      <p>Experience.com will provide the subscription services listed below to <b>{who}</b> for the Term.</p>
      {items.length ? (
        <ul>{items.map((i, k) => <li key={k}><b>{i.name}</b>{i.qty != null ? ` × ${i.qty}` : ""}{i.net != null ? ` — ${m(i.net)}` : ""}</li>)}</ul>
      ) : (
        <p className="muted">Services schedule is attached as the Entitlements Addendum.</p>
      )}
      <h2>2. Term</h2>
      <p>
        The Term begins <b>{d(c.start_date ?? qs.startDate)}</b> and ends <b>{d(c.end_date ?? qs.endDate)}</b>.
        {c.auto_renew ? <> It renews automatically for <b>{c.renewal_term_months ?? 12} months</b> unless either party gives <b>{c.notice_period_days ?? 30} days</b> notice.</> : null}
      </p>
      <h2>3. Fees</h2>
      <p>
        Annual contract value is <b>{m(acv)}</b>, billed <b>{c.billing_frequency ?? "annually"}</b> with payment terms of <b>{c.payment_terms ?? "Net 30"}</b>.
      </p>
      {c.special_terms ? (
        <>
          <h2>4. Special terms</h2>
          <p className="special">{c.special_terms}</p>
        </>
      ) : null}
    </article>
  );
}

const CSS = `.cdoc{background:linear-gradient(165deg,#fff 0%,#fff 76%,#f8faff 100%);border:1px solid #e7ebf1;border-radius:16px;padding:40px 48px;color:#101a2e;font-size:14px;line-height:1.7;box-shadow:0 1px 2px rgba(16,26,46,.05),0 16px 36px -22px rgba(16,26,46,.28);font-variant-numeric:tabular-nums;position:relative;overflow:hidden}
.cdoc:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,#2f6bff,#8a5cf6)}
.cdoc .eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#2f6bff;font-weight:700}
.cdoc h1{font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;margin:4px 0}
.cdoc .meta{color:#66728a;font-size:13px;margin-bottom:24px}
.cdoc h2{font-size:15px;font-weight:700;margin:22px 0 6px;border-bottom:1px solid #e7ebf1;padding-bottom:6px;color:#243b57}
.cdoc ul{list-style:disc;padding:10px 12px 10px 34px;border:1px solid #e7ebf1;border-radius:8px;background:#fafbfd}.cdoc .muted{color:#8792a8}
.cdoc .special{background:#fdf2e0;border-left:3px solid #c07a12;padding:8px 12px;border-radius:6px;white-space:pre-wrap}`;
