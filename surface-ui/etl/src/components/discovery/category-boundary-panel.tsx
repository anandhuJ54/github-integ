import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@v3/state/api/server-fn";
import { ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@v3/shared/components/ui/badge";
import { Button } from "@v3/shared/components/ui/button";
import { cn } from "@v3/shared/components/utils/utils";
import { getCategoryBoundary, regenerateCategoryBoundary } from "@v3/etl/utils/category-boundary.functions";

/* Category boundary panel (2026-10-16): shows the boundary discovery uses for this category (definition, includes,
   sub-types, what belongs elsewhere), labelled authored or generated, with Regenerate for a generated one (or to
   generate one now when the category has none). An authored boundary is never replaced. */

export function CategoryBoundaryPanel({ gcid, canEdit }: { gcid: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const getB = useServerFn(getCategoryBoundary);
  const regen = useServerFn(regenerateCategoryBoundary);
  const [open, setOpen] = useState(false);
  const { data: b, isLoading } = useQuery({
    queryKey: ["category_boundary", gcid],
    queryFn: () => getB({ data: { gcid } }),
  });
  const mut = useMutation({
    mutationFn: () => regen({ data: { gcid } }),
    onSuccess: async (r) => {
      if (r.saved) toast.success(r.reason === "regenerated" ? "Boundary regenerated" : "Boundary generated");
      else toast.info(r.reason === "authored boundary kept" ? "This category has an authored boundary; it is not replaced." : r.reason);
      await qc.invalidateQueries({ queryKey: ["category_boundary", gcid] });
      setOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const generated = !!b?.source && b.source.startsWith("generated");
  const label = !b ? "none yet" : generated ? "generated" : "authored";

  return (
    <div className="mt-3 rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <ChevronRight className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-90")} />
          Category boundary
        </button>
        <Badge variant="secondary" className={cn("font-normal", !b ? "bg-amber-50 text-amber-700" : generated ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700")}>{isLoading ? "…" : label}</Badge>
        {b?.updated_at ? <span className="text-xs text-slate-400">{new Date(b.updated_at).toLocaleDateString()}</span> : null}
        {generated && b?.source ? <span className="text-xs text-slate-400">{b.source.replace(/^generated:/, "")}</span> : null}
        {canEdit && (!b || generated) ? (
          <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 px-2 text-xs" disabled={mut.isPending} onClick={() => mut.mutate()}>
            <RefreshCw className={cn("h-3.5 w-3.5", mut.isPending && "animate-spin")} /> {mut.isPending ? "Generating…" : b ? "Regenerate" : "Generate now"}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2 border-t border-slate-200 px-3 py-2 text-sm text-slate-700">
          {!b ? (
            <p className="text-slate-500">No boundary yet. The next discovery round generates one first, or use Generate now.</p>
          ) : (
            <>
              <p>{b.definition}</p>
              {b.includes?.length ? (
                <div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Includes</div>
                  <ul className="list-disc pl-5">{b.includes.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              ) : null}
              {b.subtypes?.length ? (
                <div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sub-types</div>
                  <ul className="list-disc pl-5">{b.subtypes.map((s, i) => <li key={i}><span className="font-mono text-xs">{s.name}</span>{s.criteria ? ` — ${s.criteria}` : ""}</li>)}</ul></div>
              ) : null}
              {b.excludes?.length ? (
                <div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Belongs elsewhere</div>
                  <ul className="list-disc pl-5">{b.excludes.map((e, i) => <li key={i}>{e.type} → <span className="font-mono text-xs">{e.goes_to ?? "another category"}</span></li>)}</ul></div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
