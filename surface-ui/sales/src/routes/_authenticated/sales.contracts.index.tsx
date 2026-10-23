import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";
import { EmptyState, PageBody, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@v3/ui/components/ui/dialog";
import { supabase } from "@v3/ui/integrations/supabase/client";
import {
  bucketsFor,
  createContractFromQuote,
  day,
  listContracts,
  loadRenewals,
  money,
  nextAction,
  startRenewal,
  type Bucket,
  type ContractRow,
} from "@v3/sales/lib/contracts";

export const Route = createFileRoute("/_authenticated/sales/contracts/")({
  head: () => ({
    meta: [
      { title: "Contracts — Experience.com Growth Hub" },
      { name: "description", content: "Contract portfolio: approvals, negotiation, signature, renewals and lineage." },
      { property: "og:title", content: "Contracts — Experience.com Growth Hub" },
      { property: "og:description", content: "The contract operating system: draft, negotiate, sign, renew." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContractsPage,
});

const TABS: { key: "all" | Bucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_me", label: "Needs me" },
  { key: "negotiating", label: "Negotiating" },
  { key: "awaiting_signature", label: "Awaiting signature" },
  { key: "active", label: "Active" },
  { key: "renewing", label: "Renewing soon" },
  { key: "expired", label: "Expired" },
];

const MONO = ["#2f6bff", "#12b76a", "#8a5cf6", "#c07a12", "#e0533d", "#0e9fb3"];
function Monogram({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  const parts = name.split(/\s+/).filter(Boolean);
  const ini = (parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : name.slice(0, 2)).toUpperCase();
  return <span className="mono" style={{ background: MONO[h % MONO.length] }}>{ini}</span>;
}

export function StatusPill({ status }: { status: string | null }) {
  const s = (status ?? "—").toLowerCase();
  const cls =
    s === "active" || s === "executed" || s === "signed" ? "green"
      : s.includes("signature") || s === "final" || s === "sent" ? "purple"
        : s === "negotiating" || s === "review" || s === "pending" ? "amber"
          : s === "expired" || s === "rejected" || s === "cancelled" ? "red"
            : "grey";
  return <span className={`pill ${cls}`}>{s.replace(/_/g, " ")}</span>;
}

function ContractsPage() {
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ["m4-contracts"], queryFn: listContracts });
  const renewals = useQuery({ queryKey: ["m4-renewals"], queryFn: loadRenewals });
  const [tab, setTab] = useState<"all" | Bucket>("all");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [product, setProduct] = useState("");
  const [renewalF, setRenewalF] = useState("");
  const [open, setOpen] = useState(false);
  const [quoteId, setQuoteId] = useState("");

  const actor = async () => (await supabase.auth.getUser()).data.user?.email ?? null;

  const create = useMutation({
    mutationFn: async () => createContractFromQuote(quoteId.trim(), await actor()),
    onSuccess: (id) => {
      toast.success("Contract created");
      setOpen(false);
      void navigate({ to: "/sales/contracts/$contractId", params: { contractId: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const renew = useMutation({
    mutationFn: async (contractId: string) => startRenewal(contractId, await actor()),
    onSuccess: (id) => void navigate({ to: "/sales/contracts/$contractId", params: { contractId: id } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data ?? [];
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: rows.length };
    for (const r of rows) for (const b of bucketsFor(r)) m[b] = (m[b] ?? 0) + 1;
    return m;
  }, [rows]);
  const opts = (f: (r: ContractRow) => string | null | undefined) => [...new Set(rows.map(f).filter(Boolean) as string[])].sort();
  const productsOf = (r: ContractRow) => ((r.terms?.quote_state?.products ?? r.terms?.quote_state?.lines ?? []) as any[]).map((p) => String(p?.key ?? p?.product_key ?? p?.name ?? "")).filter(Boolean);
  const productOpts = [...new Set(rows.flatMap(productsOf))].sort();

  const shown = rows.filter((r) => {
    if (tab !== "all" && !bucketsFor(r).includes(tab)) return false;
    if (owner && (r.sold_by ?? r.created_by) !== owner) return false;
    if (status && r.status !== status) return false;
    if (type && r.contract_type !== type) return false;
    if (product && !productsOf(r).includes(product)) return false;
    if (renewalF === "upcoming" && r.renewal?.status !== "upcoming") return false;
    if (renewalF === "none" && r.renewal) return false;
    return true;
  });

  const nearest = renewals.data?.[0];

  const lineage = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const chained = rows.find((r) => r.parent_contract_id && byId.has(r.parent_contract_id));
    if (!chained) return null;
    const chain: ContractRow[] = [];
    let cur: ContractRow | undefined = chained;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_contract_id ? byId.get(cur.parent_contract_id) : undefined;
    }
    let child = rows.find((r) => r.parent_contract_id === chain[chain.length - 1]!.id);
    while (child) {
      chain.push(child);
      const id: string = child.id;
      child = rows.find((r) => r.parent_contract_id === id);
    }
    return chain;
  }, [rows]);

  return (
    <PageBody className="m4-portfolio">
      <style>{CSS}</style>
      <PageHeader
        eyebrow="Growth Hub · Contracts"
        title="Contracts"
        description="Draft, approve, negotiate, sign and renew — every contract and its lineage in one place."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="grad"><Plus className="mr-1 h-4 w-4" />Create contract</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create contract from quote</DialogTitle></DialogHeader>
              <p className="text-sm text-[color:var(--color-ink-2)]">
                Contracts are generated from a quote. Paste the quote ID, or open a quote and choose Continue.{" "}
                <Link to="/sales/quotes" className="text-[#2f6bff] underline">Browse quotes</Link>
              </p>
              <Input value={quoteId} onChange={(e) => setQuoteId(e.target.value)} placeholder="Quote ID (uuid)" />
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={!quoteId.trim() || create.isPending}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {nearest ? (
        <div className="renew-banner">
          <div>
            <p className="eyebrow">Next renewal · {day(nearest.renewal_date)}</p>
            <h3>{nearest.contract?.name ?? "Contract"}</h3>
            <div className="renew-stats">
              <div><span>ARR</span><b>{money(nearest.current_acv ?? nearest.contract?.acv)}</b></div>
              <div><span>Utilization</span><b>{nearest.utilization_pct == null ? "—" : `${Math.round(nearest.utilization_pct)}%`}</b></div>
              <div><span>Expansion</span><b>{money(nearest.expansion_est)}</b></div>
              <div><span>Notice by</span><b>{day(nearest.notice_deadline)}</b></div>
            </div>
          </div>
          <Button className="renew-btn" onClick={() => renew.mutate(nearest.contract_id)} disabled={renew.isPending}>
            <RefreshCw className="mr-1 h-4 w-4" />Start renewal
          </Button>
        </div>
      ) : null}

      <div className="summary-grid">
        <article><span>All contracts</span><b>{counts.all ?? 0}</b></article>
        <article><span>Active</span><b>{counts.active ?? 0}</b></article>
        <article><span>Awaiting signature</span><b>{counts.awaiting_signature ?? 0}</b></article>
        <article><span>Renewing soon</span><b>{counts.renewing ?? 0}</b></article>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}<span>{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="filters">
        <Sel label="Owner" value={owner} onChange={setOwner} options={opts((r) => r.sold_by ?? r.created_by)} />
        <Sel label="Status" value={status} onChange={setStatus} options={opts((r) => r.status)} />
        <Sel label="Product" value={product} onChange={setProduct} options={productOpts} />
        <Sel label="Renewal" value={renewalF} onChange={setRenewalF} options={["upcoming", "none"]} />
        <Sel label="Type" value={type} onChange={setType} options={opts((r) => r.contract_type)} />
      </div>

      <Panel bodyClassName="p-0" className="tbl-panel">
        {list.isLoading ? (
          <p className="p-6 text-sm text-[color:var(--color-ink-3)]">Loading contracts…</p>
        ) : list.error ? (
          <EmptyState title="Couldn't load contracts" description={(list.error as Error).message} compact />
        ) : shown.length === 0 ? (
          <EmptyState title="No contracts here" description="Nothing matches this view yet." compact />
        ) : (
          <table>
            <thead>
              <tr><th>Logo</th><th>Contract</th><th className="r">ARR</th><th>Status</th><th>Next action</th><th>Renewal</th><th>Owner</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const na = nextAction(r);
                return (
                  <tr key={r.id} onClick={() => void navigate({ to: "/sales/contracts/$contractId", params: { contractId: r.id } })}>
                    <td><div className="logo">{r.logoUrl ? <img src={r.logoUrl} alt="" /> : <Monogram name={r.orgName ?? r.name} />}<span>{r.orgName ?? "—"}</span></div></td>
                    <td><b>{r.name}</b><small>{r.contract_number ?? "—"}</small></td>
                    <td className="r num">{money(r.acv)}</td>
                    <td><StatusPill status={r.stage ?? r.status} /></td>
                    <td className={na.nora ? "nora" : ""}>{na.nora ? "◆ " : ""}{na.text}</td>
                    <td className="num">{day(r.end_date ?? r.notice_deadline ?? r.renewal?.renewal_date)}</td>
                    <td>{r.sold_by ?? r.created_by ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Contract lineage" description="Parent → renewal chain. Each version stands on its own; nothing is overwritten." className="mt-6">
        {lineage ? (
          <div className="lineage">
            <p className="lin-logo">{lineage[0]!.orgName ?? lineage[0]!.name}</p>
            <ol>
              {lineage.map((c) => (
                <li key={c.id}>
                  <span className="yr">{new Date(c.created_at).getFullYear()}</span>
                  <Link to="/sales/contracts/$contractId" params={{ contractId: c.id }}>{c.contract_type ?? "contract"} · {c.name}</Link>
                  <StatusPill status={c.status} />
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <EmptyState title="No lineage yet" description="Lineage appears once a contract has a renewal or amendment linked to a parent." compact />
        )}
      </Panel>
    </PageBody>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="sel">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

const CSS = `
.m4-portfolio{--ink:#101a2e;--blue:#2f6bff;--green:#12b76a;--purple:#8a5cf6;--amber:#c07a12;--red:#e0533d;--hair:#e7ebf1;background:#f6f8fb;font-variant-numeric:tabular-nums;color:var(--ink)}
.m4-portfolio .grad{background:linear-gradient(180deg,#3f78ff,#2f6bff);color:#fff;border-radius:8px;box-shadow:0 6px 14px rgba(47,107,255,.28)}
.m4-portfolio section{border:1px solid var(--hair);border-radius:16px;box-shadow:0 1px 2px rgba(16,26,46,.05),0 8px 24px -16px rgba(16,26,46,.18)}
.m4-portfolio .renew-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;border-radius:16px;padding:22px 24px;margin-bottom:16px;color:#fff;background:linear-gradient(110deg,#0e9fb3,#0b7a8f 58%,#084f62);box-shadow:0 1px 2px rgba(16,26,46,.08),0 16px 30px -16px rgba(14,159,179,.65);position:relative;overflow:hidden}
.m4-portfolio .renew-banner:after{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 55%,rgba(255,255,255,.1));pointer-events:none}
.m4-portfolio .renew-banner .eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.8;font-weight:700}
.m4-portfolio .renew-banner h3{font-size:20px;font-weight:600;margin:4px 0 12px}
.m4-portfolio .renew-stats{display:flex;gap:28px;flex-wrap:wrap}.m4-portfolio .renew-stats span{display:block;font-size:11px;opacity:.75}.m4-portfolio .renew-stats b{font-size:17px}
.m4-portfolio .renew-btn{background:#fff;color:#0b7a8f;border-radius:8px}.m4-portfolio .renew-btn:hover{background:#eefbfd}
.m4-portfolio .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
.m4-portfolio .summary-grid article{--tone:var(--blue);position:relative;overflow:hidden;padding:15px;border-radius:16px;border:1px solid color-mix(in srgb,var(--tone) 22%,var(--hair));background:linear-gradient(160deg,color-mix(in srgb,var(--tone) 12%,#fff),#fff 64%);box-shadow:0 1px 2px rgba(16,26,46,.05),0 10px 22px -18px color-mix(in srgb,var(--tone) 60%,transparent);transition:transform .14s ease,box-shadow .14s ease}
.m4-portfolio .summary-grid article:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(16,26,46,.05),0 16px 28px -16px color-mix(in srgb,var(--tone) 55%,transparent)}
.m4-portfolio .summary-grid article:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,var(--tone),color-mix(in srgb,var(--tone) 35%,#fff))}
.m4-portfolio .summary-grid article:nth-child(2){--tone:var(--green)}.m4-portfolio .summary-grid article:nth-child(3){--tone:var(--purple)}.m4-portfolio .summary-grid article:nth-child(4){--tone:#0e9fb3}
.m4-portfolio .summary-grid span{display:block;color:color-mix(in srgb,var(--tone) 55%,#66728a);font-size:10.5px;font-weight:800;text-transform:uppercase}.m4-portfolio .summary-grid b{display:block;margin-top:5px;font-size:25px;color:var(--ink)}
.m4-portfolio .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.m4-portfolio .tabs button{display:inline-flex;gap:8px;align-items:center;padding:7px 12px;border-radius:8px;font-size:13px;font-weight:500;color:#4a5670;background:#fff;border:1px solid var(--hair)}
.m4-portfolio .tabs button span{font-size:11px;padding:1px 6px;border-radius:6px;background:#eef2f8}
.m4-portfolio .tabs button.on{background:linear-gradient(180deg,#3f78ff,#2f6bff);color:#fff;border-color:transparent;box-shadow:0 6px 14px rgba(47,107,255,.28)}
.m4-portfolio .tabs button.on span{background:rgba(255,255,255,.25)}
.m4-portfolio .filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.m4-portfolio .sel{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--hair);border-radius:8px;padding:4px 8px;font-size:12px;color:#66728a}
.m4-portfolio .sel select{background:transparent;font-size:13px;color:var(--ink);outline:none}
.m4-portfolio .tbl-panel{border-radius:16px;overflow-x:auto;box-shadow:0 1px 2px rgba(16,26,46,.05),0 8px 24px -16px rgba(16,26,46,.18)}
.m4-portfolio table{width:100%;font-size:13px;border-collapse:collapse}
.m4-portfolio th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#66728a;background:#fafbfd;padding:12px 16px;border-bottom:1px solid var(--hair);font-weight:700}
.m4-portfolio td{padding:12px 16px;border-bottom:1px solid var(--hair);vertical-align:middle}
.m4-portfolio .r{text-align:right}.m4-portfolio .num{font-variant-numeric:tabular-nums}
.m4-portfolio tbody tr{cursor:pointer;transition:background .12s}.m4-portfolio tbody tr:hover{background:#f7f9fe}
.m4-portfolio td b{display:block;font-weight:600}.m4-portfolio td small{color:#8792a8;font-size:11px}
.m4-portfolio td.nora{color:var(--purple);font-weight:500}
.m4-portfolio .logo{display:flex;align-items:center;gap:10px}.m4-portfolio .logo img{width:28px;height:28px;border-radius:8px;object-fit:contain;border:1px solid var(--hair);background:#fff}
.m4-portfolio .mono{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;color:#fff;font-size:11px;font-weight:700}
.m4-portfolio .pill,.m4-detail .pill,.m4-sign .pill{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;text-transform:capitalize}
.pill.green{background:#e3f8ee;color:#0b8a50}.pill.purple{background:#efe9fe;color:#6b3fe0}.pill.amber{background:#fdf2e0;color:#c07a12}.pill.red{background:#fde8e4;color:#c23a25}.pill.grey{background:#eef2f8;color:#4a5670}
.m4-portfolio .lin-logo{font-weight:600;margin-bottom:10px}
.m4-portfolio .lineage ol{display:flex;flex-direction:column;gap:8px;border-left:2px solid var(--hair);padding-left:16px}
.m4-portfolio .lineage li{display:flex;gap:12px;align-items:center;font-size:13px}.m4-portfolio .lineage .yr{font-weight:700;color:var(--blue);width:44px}
.m4-portfolio .lineage a{color:var(--ink);text-transform:capitalize}.m4-portfolio .lineage a:hover{color:var(--blue)}
@media(max-width:800px){.m4-portfolio .summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.m4-portfolio .renew-banner{align-items:flex-start;flex-direction:column}}
`;
