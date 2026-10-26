import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@v3/state/api/server-fn";
import { toast } from "sonner";
import { Badge } from "@v3/shared/components/ui/badge";
import { Button } from "@v3/shared/components/ui/button";
import { Textarea } from "@v3/shared/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@v3/shared/components/ui/dialog";
import { AddressValue, PayloadFields, isAddressObject } from "@v3/etl/components/discovery/pipeline-tab";
import { previewSiteProposal, type ProposalPreviewRecord } from "@v3/etl/utils/site-proposal.functions";
import { csvExport } from "@v3/etl/utils/csv-export";

/* Contract preview (2026-10-15): "Preview records" for a pending proposal or for the saved contract (re-check).
   Builds records live with the contract (previewSiteProposal, read-only), on the contract's sample pages or on up
   to 10 URLs the reviewer gives (checked against the site and the profile page pattern before fetching). Each row
   has View (every mapped field, found or not) and the whole result downloads as CSV (one row per page, one column
   per mapped field). Shared by the proposal review and the saved-contract panel. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const PREVIEW_KEYS = ["person.name", "person.phone", "person.email", "location.street", "location.city", "location.state", "location.phone"];
const MAX_URLS = 10;

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* Full record view for one preview row (2026-10-15): every field the proposed contract maps, with the value this page
   gave or "not found on this page". Static fields are grouped by subject (person / location / firm = brand); taxonomy
   and extra fields come from the record payload, as staging would store it. */
type ViewItem = { id: string; label: string; value: unknown; tag: string | null };
const emptyVal = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

function recordSections(sc: Any, r: ProposalPreviewRecord) {
  const uni: Record<string, unknown> = r.universal ?? {};
  const payload: Record<string, unknown> = r.payload ?? {};
  const subjects: Record<string, string> = (payload._subjects as Record<string, string>) ?? {};
  const staticSources: Record<string, string> = (payload._static_sources as Record<string, string>) ?? {};
  const extra: Record<string, unknown> = (payload._extra as Record<string, unknown>) ?? {};
  const routes: Record<string, unknown> = sc?.static_routes ?? {};
  const firmVals: Record<string, unknown> = sc?.firm_profile?.values ?? {};
  const fields: Record<string, Any> = sc?.fields ?? {};
  const staticIds = new Set<string>([
    ...Object.keys(fields), ...Object.keys(routes),
    ...Object.keys(firmVals).map((k) => (k.includes(".") ? k : `firm.${k}`)),
    ...Object.keys(uni),
  ]);
  const groups: Record<"person" | "location" | "firm" | "other", ViewItem[]> = { person: [], location: [], firm: [], other: [] };
  for (const id of [...staticIds].sort()) {
    const i = id.indexOf(".");
    const prefix = i >= 0 ? id.slice(0, i) : "";
    const tag = staticSources[id]
      ? `from ${staticSources[id]}`
      : fields[id]?.tier ?? fields[id]?.locator?.tier ?? (id in routes ? "static route" : prefix === "firm" && id.slice(i + 1) in firmVals ? "site-wide" : null);
    const item = { id, label: i >= 0 ? id.slice(i + 1) : id, value: uni[id], tag };
    (groups[prefix as keyof typeof groups] ?? groups.other).push(item);
  }
  const taxIds = new Set<string>([...Object.keys(sc?.taxonomy_fields ?? {}), ...Object.keys(payload).filter((k) => !k.startsWith("_"))]);
  const taxonomy: ViewItem[] = [...taxIds].sort().map((slug) => ({
    id: slug, label: slug, value: payload[slug],
    tag: subjects[slug] ?? (sc?.taxonomy_fields?.[slug]?.subject === "location" ? "branch" : sc?.taxonomy_fields?.[slug]?.subject ?? null),
  }));
  const extraIds = new Set<string>([...Object.keys(sc?.extra_fields ?? {}), ...Object.keys(extra)]);
  const extras: ViewItem[] = [...extraIds].sort().map((k) => ({ id: k, label: sc?.extra_fields?.[k]?.label ?? k, value: extra[k], tag: null }));
  return [
    { title: "Person", items: groups.person },
    { title: "Location (branch / office)", items: groups.location },
    { title: "Brand (firm)", items: groups.firm },
    ...(groups.other.length ? [{ title: "Other static", items: groups.other }] : []),
    { title: "Taxonomy", items: taxonomy },
    { title: "Extra", items: extras },
  ];
}

function RecordView({ sc, record }: { sc: Any; record: ProposalPreviewRecord }) {
  const sections = recordSections(sc, record);
  return (
    <div className="space-y-4">
      {sections.map((sec) => {
        const found = sec.items.filter((it) => !emptyVal(it.value)).length;
        return (
          <div key={sec.title}>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {sec.title} <span className="font-normal tabular-nums text-slate-400">({found} of {sec.items.length} found)</span>
            </div>
            {sec.items.length ? (
              <dl className="mt-2 grid gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
                {sec.items.map((it) => (
                  <div key={it.id} className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {it.label.replace(/_/g, " ")}
                      {it.tag ? <Badge variant="secondary" className="bg-slate-100 px-1.5 py-0 text-[10px] font-normal normal-case text-slate-500">{it.tag}</Badge> : null}
                    </dt>
                    <dd className="mt-0.5 break-words text-sm text-slate-700">
                      {emptyVal(it.value)
                        ? <span className="text-slate-400">— not found on this page</span>
                        : isAddressObject(it.value) ? <AddressValue value={it.value} /> : <PayloadFields value={it.value} depth={1} />}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : <p className="mt-1 text-xs text-slate-400">No fields mapped.</p>}
          </div>
        );
      })}
    </div>
  );
}


/* CSV: one row per page; result columns, then one column per mapped field named by group
   (person. / location. / firm. / taxonomy. / extra.). Lists are joined with "; ", addresses use their text. */
const SECTION_PREFIX: Record<string, string> = {
  "Person": "", "Location (branch / office)": "", "Brand (firm)": "", "Other static": "",
  "Taxonomy": "taxonomy.", "Extra": "extra.",
};
function csvCell(v: unknown): string {
  if (emptyVal(v)) return "";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? (isAddressObject(x) ? x.text : JSON.stringify(x)) : String(x))).join("; ");
  if (isAddressObject(v)) return v.text;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function resultText(r: ProposalPreviewRecord): string {
  if (!r.ok) return r.reason ?? "failed";
  return r.shallow ? "shallow" : r.must_have && !r.must_have.ok ? "missing required" : "ok";
}
function downloadCsv(sc: Any, records: ProposalPreviewRecord[], filename: string) {
  const cols: string[] = [];
  const seen = new Set<string>();
  const perRecord = records.map((r) => {
    const vals: Record<string, string> = {};
    for (const sec of recordSections(sc, r)) {
      for (const it of sec.items) {
        const col = SECTION_PREFIX[sec.title] === "" ? it.id : `${SECTION_PREFIX[sec.title]}${it.id}`;
        if (!seen.has(col)) { seen.add(col); cols.push(col); }
        if (r.ok) vals[col] = csvCell(it.value);
      }
    }
    return vals;
  });
  const rows = records.map((r, i) => {
    const row: Record<string, unknown> = {
      page: r.url,
      result: resultText(r),
      source: r.detail_source ?? "",
      fields_filled: r.ok ? r.filled ?? "" : "",
      minimum: r.ok ? r.floor_needed ?? "" : "",
      shallow: r.ok ? (r.shallow ? "yes" : "no") : "",
      missing_required: r.ok && r.must_have && !r.must_have.ok ? r.must_have.missing.join("; ") : "",
    };
    for (const c of cols) row[c] = perRecord[i]![c] ?? "";
    return row;
  });
  csvExport(filename, rows);
}

export function ContractPreview({
  target, sc, domain, label, heading,
}: {
  /** A pending proposal, or the saved contract of domain + category. */
  target: { proposalId: number } | { domain: string; gcid: string };
  /** The site contract being previewed (proposal's or saved), for the field list. */
  sc: Any;
  domain: string;
  /** File name part, e.g. "proposal-144" or "saved-contract". */
  label: string;
  heading: string;
}) {
  const runPreview = useServerFn(previewSiteProposal);
  const [records, setRecords] = useState<ProposalPreviewRecord[] | null>(null);
  const [viewing, setViewing] = useState<ProposalPreviewRecord | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const [urlText, setUrlText] = useState("");
  const given = [...new Set(urlText.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean))];
  const tooMany = given.length > MAX_URLS;

  const mut = useMutation({
    mutationFn: async () => runPreview({ data: { ...target, urls: ownOpen ? given : [] } as Any }),
    onSuccess: (r: Any) => setRecords(r?.records ?? []),
    onError: (e: Any) => toast.error(e?.message ?? String(e)),
  });

  const ok = (records ?? []).filter((r) => r.ok);
  const meeting = ok.filter((r) => !r.shallow && (!r.must_have || r.must_have.ok)).length;
  const notFetched = (records ?? []).filter((r) => !r.ok && (r.reason ?? "").startsWith("not fetched")).length;
  const failed = (records ?? []).length - ok.length - notFetched;
  const day = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-2 text-xs text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={mut.isPending || (ownOpen && (tooMany || given.length === 0))} onClick={() => mut.mutate()}>
          {mut.isPending ? "Building preview…" : ownOpen ? `Preview ${given.length || ""} URL${given.length === 1 ? "" : "s"}` : "Preview records"}
        </Button>
        <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setOwnOpen((o) => !o)}>
          {ownOpen ? "Use the contract's sample pages" : "Test my own URLs"}
        </button>
        {records?.length ? (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => downloadCsv(sc, records, `${domain}_${label}_${day}.csv`)}>
            Download CSV
          </Button>
        ) : null}
      </div>
      {ownOpen ? (
        <div>
          <Textarea
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={`Up to ${MAX_URLS} profile page URLs on ${domain}, one per line`}
            className="min-h-[90px] font-mono text-xs"
          />
          <p className={tooMany ? "mt-1 text-red-700" : "mt-1 text-slate-500"}>
            {given.length} of {MAX_URLS} URLs{tooMany ? ` — remove ${given.length - MAX_URLS}` : ""}. Each must be on {domain} and match the
            contract's profile page pattern; others are listed and not fetched. Each URL is one live fetch.
          </p>
        </div>
      ) : null}
      {records ? (
        <div className="overflow-x-auto">
          <p className="mb-1 font-semibold text-slate-700">{heading} (nothing written)</p>
          {records.length ? (
            <>
              <p className="mb-1 text-slate-600">
                {records.length} page{records.length === 1 ? "" : "s"} · {ok.length} loaded · {meeting} met the minimum with the required fields
                · {ok.length - meeting} shallow or missing required{failed ? ` · ${failed} failed` : ""}{notFetched ? ` · ${notFetched} not fetched` : ""}
              </p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="px-2 py-1.5 font-semibold">Page</th>
                    <th className="px-2 py-1.5 font-semibold">Result</th>
                    {PREVIEW_KEYS.map((k) => <th key={k} className="px-2 py-1.5 font-semibold">{k}</th>)}
                    <th className="px-2 py-1.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.url} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-2 py-1"><a href={r.url} target="_blank" rel="noreferrer" className="break-all text-blue-700 hover:underline">{r.url}</a></td>
                      <td className="px-2 py-1">
                        {r.ok
                          ? `${r.filled}/${r.floor_needed} fields${r.shallow ? " · shallow" : ""}${r.must_have && !r.must_have.ok ? ` · missing ${r.must_have.missing.join(", ")}` : ""}${r.detail_source && r.detail_source !== "page" ? ` · ${r.detail_source}` : ""}`
                          : <span className="text-red-700">{r.reason}</span>}
                      </td>
                      {PREVIEW_KEYS.map((k) => <td key={k} className="px-2 py-1">{fmt(r.universal?.[k])}</td>)}
                      <td className="px-2 py-1">
                        {r.ok ? <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setViewing(r)}>View</Button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="text-slate-400">The contract has no sample pages.</p>}
        </div>
      ) : null}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="break-all text-base">{viewing?.url}</DialogTitle>
            <DialogDescription>
              {viewing
                ? `Record as staging would store it with the ${label.replace(/-/g, " ")} (nothing written) · ${viewing.filled}/${viewing.floor_needed} fields${viewing.shallow ? " · shallow" : ""}${viewing.must_have && !viewing.must_have.ok ? ` · missing ${viewing.must_have.missing.join(", ")}` : " · required fields present"}${viewing.detail_source ? ` · source: ${viewing.detail_source}` : ""}`
                : null}
            </DialogDescription>
          </DialogHeader>
          {viewing ? <RecordView sc={sc} record={viewing} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
