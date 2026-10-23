import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { BrandWordmark } from "@v3/ui/components/brand/logo";
import { ContractDocument, type DocContract } from "@v3/sales/components/contracts/contract-document";

export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [
      { title: "Review & sign your agreement — Experience.com" },
      { name: "description", content: "Securely review and electronically sign your Experience.com agreement." },
      { property: "og:title", content: "Review & sign your agreement — Experience.com" },
      { property: "og:description", content: "Secure electronic signature for your Experience.com agreement." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  ssr: false,
  component: SignPage,
});

type Fetched = { signer: Record<string, any>; contract: DocContract & Record<string, any> };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dt = (s: unknown) => (s ? new Date(String(s)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

function SignPage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<"loading" | "invalid" | "review" | "sign" | "done">("loading");
  const [data, setData] = useState<Fetched | null>(null);
  const [consent, setConsent] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: d, error } = await (supabase as any).rpc("m4_signer_fetch", { p_token: token });
      if (error || !d || !d.contract) return setState("invalid");
      setData(d as Fetched);
      if ((d.signer?.status ?? "") === "signed") {
        setResult({ document_hash: d.contract?.document_hash, signed_at: d.signer?.signed_at });
        setState("done");
      } else setState("review");
    })();
  }, [token]);

  const sign = async () => {
    setBusy(true);
    setErr(null);
    const { data: r, error } = await (supabase as any).rpc("m4_record_signature", {
      p_token: token, p_type: "typed", p_data: typed.trim(), p_identity: "email_link", p_ip: null, p_ua: navigator.userAgent,
    });
    setBusy(false);
    if (error || (r && r.ok === false)) return setErr(error?.message ?? r?.error ?? "Signature could not be recorded.");
    setResult(r ?? {});
    setState("done");
  };

  const c = data?.contract;
  const s = data?.signer;
  return (
    <div className="m4-sign">
      <style>{CSS}</style>
      <header><BrandWordmark size={26} /><span>Secure e-signature</span></header>
      <main>
        {state === "loading" && <p className="muted">Loading your agreement…</p>}
        {state === "invalid" && (
          <div className="card center"><h2>This signing link isn't valid</h2><p className="muted">It may have expired, been replaced by a newer version, or already been used. Please contact your Experience.com representative for a fresh link.</p></div>
        )}
        {c && state !== "invalid" && state !== "loading" && (
          <>
            <div className="card summary">
              <div><p className="eyebrow">Agreement</p><h1>{c.name}</h1><p className="muted">{c.contract_number ?? "—"}</p></div>
              <div className="stats">
                <div><span>ACV</span><b>{c.acv != null ? usd.format(Number(c.acv)) : "—"}</b></div>
                <div><span>Term</span><b>{c.renewal_term_months ? `${c.renewal_term_months} mo` : "—"}</b></div>
                <div><span>Start</span><b>{dt(c.start_date)}</b></div>
                <div><span>End</span><b>{dt(c.end_date)}</b></div>
              </div>
            </div>
            <ContractDocument c={c} customer={c.customer_name ?? c.org_name ?? null} />
            {state === "review" && <div className="bar"><button className="primary" onClick={() => setState("sign")}>Review &amp; Sign</button></div>}
            {state === "sign" && (
              <div className="card signbox">
                <p className="eyebrow">Signing as</p>
                <h3>{s?.signer_name ?? "—"} <small>{s?.role ?? ""}{s?.signer_email ? ` · ${s.signer_email}` : ""}</small></h3>
                <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree to sign electronically under the E-SIGN Act / UETA, and that my typed name is my legal signature.</label>
                <input className="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" />
                <div className="script">{typed || " "}</div>
                {err && <p className="err">{err}</p>}
                <button className="primary" disabled={!consent || !typed.trim() || busy} onClick={() => void sign()}>{busy ? "Signing…" : "Sign & complete"}</button>
              </div>
            )}
            {state === "done" && (
              <div className="card center done">
                <div className="tick">✓</div>
                <h2>Agreement complete</h2>
                <p className="muted">Signed {dt(result?.signed_at ?? new Date().toISOString())} {result?.signed_at ? new Date(result.signed_at).toLocaleTimeString() : new Date().toLocaleTimeString()}</p>
                <p className="hash">Document hash: <code>{result?.document_hash ?? result?.version_hash ?? c.document_hash ?? "—"}</code></p>
                <p className="muted">A copy of the executed agreement will be emailed to you.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const CSS = `
.m4-sign{min-height:100vh;background:linear-gradient(145deg,#f3f7ff 0%,#f6f8fb 42%,#f5fbf8 100%);color:#101a2e;font-variant-numeric:tabular-nums}
.m4-sign header{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;background:rgba(255,255,255,.92);border-bottom:1px solid #e7ebf1;box-shadow:0 1px 2px rgba(16,26,46,.04)}
.m4-sign header span{font-size:12px;color:#66728a}
.m4-sign main{max-width:880px;margin:0 auto;padding:32px 20px 80px;display:flex;flex-direction:column;gap:20px}
.m4-sign .card{background:#fff;border:1px solid #e7ebf1;border-radius:16px;padding:24px;box-shadow:0 1px 2px rgba(16,26,46,.05),0 8px 24px -16px rgba(16,26,46,.18)}
.m4-sign .center{text-align:center}.m4-sign .muted{color:#66728a;font-size:14px}
.m4-sign .eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#2f6bff;font-weight:700}
.m4-sign h1{font-size:22px;font-weight:600}.m4-sign h2{font-size:20px;font-weight:600;margin-bottom:8px}
.m4-sign .summary{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;position:relative;overflow:hidden;background:linear-gradient(150deg,#eef4ff,#fff 62%);border-color:#d9e4ff}
.m4-sign .summary:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,#2f6bff,#8a5cf6)}
.m4-sign .stats{display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:12px}.m4-sign .stats div{--tone:#2f6bff;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--tone) 20%,#e7ebf1);background:linear-gradient(160deg,color-mix(in srgb,var(--tone) 10%,#fff),#fff 70%)}.m4-sign .stats div:nth-child(2){--tone:#243b57}.m4-sign .stats div:nth-child(3){--tone:#12b76a}.m4-sign .stats div:nth-child(4){--tone:#8a5cf6}.m4-sign .stats span{display:block;font-size:10px;text-transform:uppercase;font-weight:700;color:#66728a}.m4-sign .stats b{font-size:15px}
.m4-sign .bar{display:flex;justify-content:flex-end}
.m4-sign .primary{background:linear-gradient(180deg,#3f78ff,#2f6bff);color:#fff;padding:10px 20px;border-radius:8px;font-weight:600;box-shadow:0 6px 14px rgba(47,107,255,.28)}
.m4-sign .primary:disabled{opacity:.5;cursor:not-allowed}
.m4-sign .signbox{display:flex;flex-direction:column;gap:12px;position:relative;overflow:hidden;background:linear-gradient(150deg,#f5fbf8,#fff 55%);border-color:#cfecde}.m4-sign .signbox:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,#12b76a,#2f6bff)}.m4-sign .signbox h3{font-size:17px;font-weight:600}.m4-sign .signbox small{font-weight:400;color:#66728a;font-size:13px}
.m4-sign .consent{display:flex;gap:10px;align-items:flex-start;font-size:14px}
.m4-sign .typed{border:1px solid #e7ebf1;border-radius:8px;padding:10px 12px;font-size:15px}
.m4-sign .script{font-family:'Segoe Script','Bradley Hand',cursive;font-size:38px;color:#101a2e;border-bottom:2px solid #101a2e;min-height:58px;padding:0 4px}
.m4-sign .err{color:#c23a25;font-size:13px}
.m4-sign .done{background:linear-gradient(150deg,#eaf9f1,#fff 60%);border-color:#cdeedd}.m4-sign .done .tick{width:56px;height:56px;border-radius:50%;background:#12b76a;color:#fff;display:grid;place-items:center;font-size:28px;margin:0 auto 12px;box-shadow:0 8px 20px -10px rgba(18,183,106,.65)}
.m4-sign .hash{font-size:12px;margin:8px 0;word-break:break-all}
@media(max-width:700px){.m4-sign header{padding:14px 18px}.m4-sign main{padding:22px 14px 60px}.m4-sign .stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
