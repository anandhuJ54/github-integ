import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/ui/lib/server-fn";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/compliance")({
  component: CompliancePage,
});

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
      value
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-slate-50 text-slate-500 border-slate-200",
    )}>
      {value ? "Yes" : "No"}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 85 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  const text = score >= 85 ? "text-emerald-700" : score >= 50 ? "text-amber-700" : "text-red-700";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn("h-full", color)} style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      <span className={cn("text-xs font-mono w-9 text-right", text)}>{score}%</span>
    </div>
  );
}

function CompliancePage() {
  const [search, setSearch] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);

  // SECTION 1
  const { data: section1, isLoading: l1 } = useQuery({
    queryKey: ["compliance-coverage"],
    queryFn: async () => {
      const { cats, comp, rules } = await api.get<{
        cats: { gcid: string; display_name: string }[];
        comp: ({ gcid: string } & Record<string, unknown>)[];
        rules: { gcid: string | null }[];
      }>("/admin/compliance/coverage");
      const compMap = new Map<string, Record<string, unknown>>();
      comp.forEach((c) => compMap.set(c.gcid, c as Record<string, unknown>));
      const ruleCounts = new Map<string, number>();
      rules.forEach((r) => { if (r.gcid) ruleCounts.set(r.gcid, (ruleCounts.get(r.gcid) ?? 0) + 1); });
      return cats.map((cat) => {
        const c = compMap.get(cat.gcid);
        const disclaimers = (c?.required_disclaimers as unknown[] | undefined) ?? [];
        return {
          gcid: cat.gcid,
          name: cat.display_name,
          configured: !!c,
          license_display: !!(c?.license_required_display),
          disclaimers_count: Array.isArray(disclaimers) ? disclaimers.length : 0,
          rules_count: cat.gcid ? (ruleCounts.get(cat.gcid) ?? 0) : 0,
          age_gate: !!c?.age_gate_required,
          hipaa: !!c?.hipaa_applicable,
        };
      });
    },
  });

  const filtered1 = useMemo(() => {
    let rows = section1 ?? [];
    if (onlyGaps) rows = rows.filter((r) => !r.configured);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.gcid.toLowerCase().includes(q));
    }
    return rows.slice(0, 200);
  }, [section1, onlyGaps, search]);

  // SECTION 2
  const { data: section2, isLoading: l2 } = useQuery({
    queryKey: ["entity-compliance"],
    queryFn: async () => {
      const { rows, pros, orgs, cats } = await api.get<{
        rows: {
          entity_type: string;
          entity_id: string;
          compliance_score: number | null;
          missing_items: unknown;
          last_reviewed: string | null;
        }[];
        pros: { id: string; display_name: string | null; first_name: string | null; last_name: string | null; gcid: string | null }[];
        orgs: { id: string; name: string; gcid: string | null }[];
        cats: { gcid: string; display_name: string }[];
      }>("/admin/compliance/entities");
      const entMap = new Map<string, { name: string; gcid: string | null }>();
      pros.forEach((p) => entMap.set(p.id, {
        name: p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unnamed",
        gcid: p.gcid,
      }));
      orgs.forEach((o) => entMap.set(o.id, { name: o.name, gcid: o.gcid }));
      const catMap = new Map<string, string>();
      cats.forEach((c) => catMap.set(c.gcid, c.display_name));
      return rows.map((r) => {
        const ent = entMap.get(r.entity_id);
        return {
          id: `${r.entity_type}:${r.entity_id}`,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          name: ent?.name ?? "Unknown",
          category: ent?.gcid ? catMap.get(ent.gcid) ?? ent.gcid : "—",
          score: r.compliance_score ?? 0,
          missing: (r.missing_items as string[] | null) ?? [],
          last_reviewed: r.last_reviewed,
        };
      });
    },
  });

  return (
    <EmpLayout>
      <div className="p-8 max-w-[1400px] mx-auto space-y-10">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Compliance</h1>
          <p className="text-sm text-slate-500 mt-1">Category configuration coverage and entity compliance status</p>
        </div>

        {/* SECTION 1 */}
        <section>
          <div className="flex items-end justify-between mb-4 gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Category Compliance Coverage</h2>
              <p className="text-xs text-slate-500 mt-0.5">Configuration status for every GBP category</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox checked={onlyGaps} onCheckedChange={(v) => setOnlyGaps(!!v)} />
                Only show gaps
              </label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories…"
                className="w-64"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Category</th>
                    <th className="text-left px-4 py-3 font-medium">License</th>
                    <th className="text-left px-4 py-3 font-medium">Disclaimers</th>
                    <th className="text-left px-4 py-3 font-medium">Content rules</th>
                    <th className="text-left px-4 py-3 font-medium">Age gate</th>
                    <th className="text-left px-4 py-3 font-medium">HIPAA</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {l1 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Loading…</td></tr>
                  ) : filtered1.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">No categories match</td></tr>
                  ) : filtered1.map((r) => (
                    <tr key={r.gcid} className={cn("border-t border-slate-100 hover:bg-slate-50", !r.configured && "bg-amber-50/30")}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{r.gcid}</div>
                      </td>
                      <td className="px-4 py-3"><YesNo value={r.license_display} /></td>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">{r.disclaimers_count}</td>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">{r.rules_count}</td>
                      <td className="px-4 py-3"><YesNo value={r.age_gate} /></td>
                      <td className="px-4 py-3"><YesNo value={r.hipaa} /></td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                          <Link to="/categories/$gcid" params={{ gcid: r.gcid }} search={{ tab: "compliance" } as never}>
                            Edit
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 2 */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Entity Compliance Status</h2>
            <p className="text-xs text-slate-500 mt-0.5">Professionals and organizations with compliance issues</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Entity</th>
                    <th className="text-left px-4 py-3 font-medium">Category</th>
                    <th className="text-left px-4 py-3 font-medium">Score</th>
                    <th className="text-left px-4 py-3 font-medium">Missing items</th>
                    <th className="text-left px-4 py-3 font-medium">Last reviewed</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {l2 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Loading…</td></tr>
                  ) : (section2 ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No entity compliance records yet</td></tr>
                  ) : section2!.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500 capitalize">{r.entity_type}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.category}</td>
                      <td className="px-4 py-3"><ScoreBar score={r.score} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-md">
                          {r.missing.length === 0 ? (
                            <span className="text-xs text-slate-400">None</span>
                          ) : r.missing.map((m, i) => (
                            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                              {m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {r.last_reviewed ? new Date(r.last_reviewed).toLocaleDateString() : "Never"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" className="h-7 text-xs">Review</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </EmpLayout>
  );
}
