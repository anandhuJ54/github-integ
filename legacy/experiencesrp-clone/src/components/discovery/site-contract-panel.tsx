import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SiteContractProposals } from "@/components/discovery/site-contract-proposals";
import { ContractPreview } from "@/components/discovery/contract-preview";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const PERSON_IDENTITY = new Set([
  "name", "job_title", "phone", "email", "street", "city", "state", "postal_code", "profile_url",
]);

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function when(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800"
      >
        <ChevronRight className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-90")} />
        {title}
      </button>
      {open ? <div className="border-t border-slate-200 px-3 py-3 text-xs text-slate-700">{children}</div> : null}
    </div>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mono({ value }: { value: unknown }) {
  if (value == null || value === "") return <span>—</span>;
  const s = String(value);
  return (
    <span className="inline-flex max-w-full items-start gap-1">
      <code className="break-all rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">{s}</code>
      <button
        type="button"
        title="Copy"
        className="text-slate-400 hover:text-slate-700"
        onClick={() => navigator.clipboard.writeText(s).then(() => toast.success("Copied"))}
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="text-slate-400">None.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
            {head.map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 align-top last:border-0">
              {r.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Collapsed({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-slate-600">
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        {label}
      </button>
      {open ? <div className="mt-2 pl-4">{children}</div> : null}
    </div>
  );
}

function tierOf(f: Any): string {
  return f?.locator?.tier ?? f?.tier ?? "—";
}
function hits(f: Any, n: number): string {
  const h = f?.hits ?? f?.sample_hits ?? f?.found;
  return h == null ? "—" : `${h} / ${n || "—"}`;
}
function subjectOf(id: string): { subject: string; key: string } {
  const [p, ...rest] = id.split(".");
  const key = rest.join(".") || id;
  if (p === "person") return { subject: "person", key };
  if (p === "location") return { subject: "branch", key };
  if (p === "firm") return { subject: "firm", key };
  return { subject: p, key };
}
function subjectLabel(s: Any): string {
  const v = s == null ? "" : String(s);
  return v === "location" ? "branch" : v;
}
function rowsOf(v: Any): [string, Any][] {
  if (Array.isArray(v)) return v.map((x: Any) => [String(x?.id ?? x?.slug ?? x?.key ?? ""), x] as [string, Any]);
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => [k, x] as [string, Any]);
  return [];
}

function Chips({ items }: { items: unknown }) {
  const arr = Array.isArray(items) ? items : items ? [items] : [];
  if (!arr.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {arr.map((x, i) => (
        <Badge key={i} variant="secondary" className="max-w-[240px] truncate font-normal">{fmt(x)}</Badge>
      ))}
    </div>
  );
}

export function SiteContractPanel({
  open,
  onOpenChange,
  domain,
  gcid,
  sourceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  domain: string;
  gcid: string;
  sourceId: string;
}) {
  const { data, isLoading } = useQuery({
    enabled: open,
    queryKey: ["site_contract_panel", domain, gcid, sourceId],
    queryFn: async () => {
      const sb = supabase as Any;
      const [c, s, l] = await Promise.all([
        sb.from("disco_site_contract")
          .select("roster_pattern, detail_pattern, profile_sitemaps, detail_entity_type, field_floor, learned_at, site_contract:extraction->site_contract")
          .eq("domain", domain).eq("category_slug", gcid)
          .order("learned_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("exp_etl_sources")
          .select("status, crawl_method, fetch_tier, page_kinds, daily_quota, min_delay_seconds, test_results")
          .eq("source_id", sourceId).maybeSingle(),
        sb.from("disco_llm_requests")
          .select("summary:response->site_contract_summary")
          .eq("tool", "map_site").eq("prompt_input->>domain", domain)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return { contract: c.data as Any, source: s.data as Any, summary: (l.error ? null : l.data?.summary) as Any };
    },
  });

  const c = data?.contract;
  const sc: Any = c?.site_contract ?? {};
  const src = data?.source ?? {};
  const sum = data?.summary ?? null;
  const samples: string[] = Array.isArray(sc.samples) ? sc.samples.map((x: Any) => (typeof x === "string" ? x : x?.url)).filter(Boolean) : [];
  const n = samples.length;
  const floor = c?.field_floor ?? sum?.field_floor_measured ?? null;
  const gate: Any = src.test_results && Object.keys(src.test_results).length ? src.test_results : null;
  const mh: Any = sc.must_haves ?? sc.must_have ?? {};
  const fields: [string, Any][] = rowsOf(sc.fields);
  const tax: [string, Any][] = rowsOf(sc.taxonomy_fields);
  const unmapped: Any[] = Array.isArray(sc.taxonomy_unmapped) ? sc.taxonomy_unmapped : [];
  const dups: Any[] = Array.isArray(sc.taxonomy_duplicates) ? sc.taxonomy_duplicates : [];
  const extras: [string, Any][] = rowsOf(sc.extra_fields);
  const dropped: Any[] = Array.isArray(sc.extra_dropped) ? sc.extra_dropped : [];
  const firm: Any = sc.firm_profile ?? {};

  const byReason = new Map<string, Any[]>();
  for (const u of unmapped) {
    const r = u?.reason ?? "unknown";
    byReason.set(r, [...(byReason.get(r) ?? []), u]);
  }
  const gatePass = gate ? gate.gate === "PASS" : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(1000px,96vw)]">
        <SheetHeader className="border-b border-slate-200 px-6 py-4">
          <SheetTitle className="text-base">Site contract — {domain}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {!isLoading ? <SiteContractProposals domain={domain} gcid={gcid} saved={c ?? null} /> : null}
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !c ? (
            <p className="text-sm text-slate-500">No site contract.</p>
          ) : (
            <>
              <Section title="Summary">
                <KV rows={[
                  ["Learned at", when(c.learned_at)],
                  ["Contract version", fmt(sc.version)],
                  ["Primary subject", fmt(sc.primary_subject)],
                  ["Detail entity type", fmt(c.detail_entity_type)],
                  ["Address owner", fmt(sc.address_owner)],
                  ["Source status", fmt(src.status)],
                  ["Crawl method / fetch tier", `${fmt(src.crawl_method)} / ${fmt(src.fetch_tier)}`],
                  ["Daily quota / min delay", `${fmt(src.daily_quota)} / ${src.min_delay_seconds == null ? "—" : `${src.min_delay_seconds}s`}`],
                ]} />
              </Section>

              <Section title="Re-check saved contract">
                <p className="mb-2 text-xs text-slate-500">
                  Builds records live with the saved contract, on its sample pages or on profile URLs you give, to confirm it still
                  works on the site. Nothing is saved; the source and its queue are not touched.
                </p>
                <ContractPreview
                  key={`${domain}|${c.learned_at}`}
                  target={{ domain, gcid }}
                  sc={sc}
                  domain={domain}
                  label="saved-contract"
                  heading="Re-check: records as staging would store them with the saved contract"
                />
              </Section>

              <Section title="How pages are found">
                <KV rows={[
                  ["Detail pattern", <Mono key="d" value={c.detail_pattern} />],
                  ["Roster pattern", <Mono key="r" value={c.roster_pattern} />],
                  ["Profile sitemaps", Array.isArray(c.profile_sitemaps) && c.profile_sitemaps.length ? (
                    <ul key="s" className="space-y-0.5">
                      {c.profile_sitemaps.map((u: string) => (
                        <li key={u}><a href={u} target="_blank" rel="noreferrer" className="break-all text-blue-700 hover:underline">{u}</a></li>
                      ))}
                    </ul>
                  ) : "—"],
                  ["Page kinds", <Chips key="k" items={src.page_kinds} />],
                ]} />
              </Section>

              <Section title="Field floor and gate">
                <KV rows={[
                  ["Measured floor", fmt(sum?.field_floor_measured ?? c.field_floor)],
                  ["AI guess", fmt(sum?.field_floor_ai)],
                  ["Per-sample counts", fmt(sum?.field_floor_per_sample)],
                  ["Floor needed", floor == null ? "—" : String(Math.ceil(0.7 * Number(floor)))],
                ]} />
                <div className="mt-3 border-t border-slate-100 pt-3">
                  {!gate ? (
                    <p className="text-slate-400">No gate run yet</p>
                  ) : (
                    <KV rows={[
                      ["Gate result", (
                        <Badge key="g" variant="secondary" className={cn("font-normal", gatePass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                          {fmt(gate.gate)}
                        </Badge>
                      )],
                      ["Sample", fmt(gate.sample)],
                      ["Meeting floor", fmt(gate.meeting_floor)],
                      ["Floor", fmt(gate.floor)],
                      ["Floor needed", fmt(gate.floor_needed)],
                      ["Reason", fmt(gate.reason)],
                      ["Checked at", when(gate.checked_at)],
                      ["Contract learned at", when(gate.contract_learned_at)],
                    ]} />
                  )}
                </div>
              </Section>

              <Section title="Must-haves">
                <KV rows={[
                  ["Required", <Chips key="r" items={mh.required} />],
                  ["Missing", <Chips key="m" items={mh.missing} />],
                  ["OK", mh.ok == null ? "—" : (
                    <Badge key="o" variant="secondary" className={cn("font-normal", mh.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                      {mh.ok ? "ok" : "not ok"}
                    </Badge>
                  )],
                ]} />
              </Section>

              <Section title={`Static fields (${fields.length})`}>
                <Table
                  head={["Id", "Tier", "Hits"]}
                  rows={fields.map(([key, f]) => {
                    const { subject } = subjectOf(key);
                    const helper = key.startsWith("person.") && !PERSON_IDENTITY.has(key.split(".").pop() ?? "");
                    return [
                      <span key="i" className="flex flex-wrap items-center gap-1">
                        <Badge variant="secondary" className="font-normal">{subject}</Badge>
                        <span className="font-mono">{key}</span>
                        {helper ? <Badge variant="secondary" className="bg-amber-50 font-normal text-amber-800">helper — not stored</Badge> : null}
                      </span>,
                      tierOf(f),
                      hits(f, n),
                    ];
                  })}
                />
              </Section>

              <Section title={`Taxonomy fields (${tax.length})`}>
                <Table
                  head={["Slug", "Subject", "Tier", "Hits"]}
                  rows={tax.map(([slug, f]) => [
                    <span key="s" className="font-mono">{slug}</span>,
                    subjectLabel(f?.subject),
                    tierOf(f),
                    hits(f, n),
                  ])}
                />
                <Collapsed label={`Not mapped (${unmapped.length})`}>
                  {[...byReason.entries()].map(([r, list]) => (
                    <Collapsed key={r} label={`${r} (${list.length})`}>
                      <Chips items={list.map((u) => u?.slug ?? u)} />
                    </Collapsed>
                  ))}
                </Collapsed>
                {dups.length ? (
                  <Collapsed label={`Duplicates (${dups.length})`}>
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(dups, null, 2)}</pre>
                  </Collapsed>
                ) : null}
              </Section>

              <Section title={`Extras (${extras.length})`}>
                <Table
                  head={["Key", "Label", "Key source", "Examples", "Match reason", "Hits"]}
                  rows={extras.map(([key, e]) => [
                    <span key="k" className="font-mono">{key}</span>,
                    fmt(e?.label),
                    fmt(e?.key_source),
                    <Chips key="x" items={e?.examples} />,
                    fmt(e?.match_reason),
                    hits(e, n),
                  ])}
                />
                <Collapsed label={`Dropped (${dropped.length})`}>
                  <Table
                    head={["Label", "Key", "Reason", "Found / samples", "Match"]}
                    rows={dropped.map((d) => [
                      fmt(d?.label),
                      <span key="k" className="font-mono">{fmt(d?.key)}</span>,
                      <Badge key="r" variant="secondary" className="font-normal">{fmt(d?.reason)}</Badge>,
                      `${Array.isArray(d?.found) ? d.found.length : fmt(d?.found)} / ${fmt(d?.samples)}`,
                      fmt(d?.match ?? d?.match_reason),
                    ])}
                  />
                </Collapsed>
              </Section>

              <Section title="Firm profile">
                {firm?.values && Object.keys(firm.values).length ? (
                  <KV rows={[
                    ...Object.entries(firm.values).map(([k, v]) => [k, fmt(v)] as [string, ReactNode]),
                    ["Learned at", when(firm.learned_at)],
                  ]} />
                ) : <p className="text-slate-400">None.</p>}
              </Section>

              <Section title={`Samples (${n})`}>
                {n ? (
                  <ul className="space-y-0.5">
                    {samples.map((u) => (
                      <li key={u}><a href={u} target="_blank" rel="noreferrer" className="break-all text-blue-700 hover:underline">{u}</a></li>
                    ))}
                  </ul>
                ) : <p className="text-slate-400">None.</p>}
              </Section>

              <Section title="Raw JSON" defaultOpen={false}>
                <pre className="max-h-[600px] overflow-auto whitespace-pre font-mono text-[11px]">{JSON.stringify(sc, null, 2)}</pre>
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
