import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, Search, Pencil, ChevronRight, ChevronDown } from "lucide-react";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { cn } from "@v3/ui/lib/utils";
import { getCategoryRelationships } from "@v3/graph/lib/category-relationships";
import { PARENT, CHILDREN } from "@v3/graph/lib/category-relationships.data";
import { Card, CardContent } from "@v3/ui/components/ui/card";
import { Input } from "@v3/ui/components/ui/input";
import { Button } from "@v3/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@v3/graph/components/ui/table";
import { Badge } from "@v3/ui/components/ui/badge";

export const Route = createFileRoute("/_authenticated/categories/")({
  head: () => ({
    meta: [{ title: "Categories — Experience.com EMP" }],
  }),
  component: CategoriesPage,
});

type Row = {
  gcid: string;
  display_name: string;
  entity_type: string | null;
  status: string | null;
  supports_single_pro_office: boolean | null;
  is_launched: boolean | null;
  estimated_profiles: number | null;
  estimated_locations: number | null;
};

type SortKey = "display_name" | "gcid" | "entity_type" | "status" | "estimated_profiles" | "estimated_locations";

type CategoryStats = { total: number; active: number; launched: number; excluded: number };

// Exact counts via head queries — PostgREST caps row payloads (~1,000) so we must
// not derive totals from a fetched list, or the stat cards under-report.
async function fetchStats(): Promise<CategoryStats> {
  const base = () =>
    supabase.from("gbp_categories").select("*", { count: "exact", head: true });
  const [t, a, e, l] = await Promise.all([
    base(),
    base().eq("status", "active"),
    base().eq("status", "excluded"),
    base().eq("is_launched", true),
  ]);
  return {
    total: t.count ?? 0,
    active: a.count ?? 0,
    excluded: e.count ?? 0,
    launched: l.count ?? 0,
  };
}

// Server-side search so matches beyond the row cap resolve (e.g. "real estate"
// sorts past row 1,000 of 4,041 and client-side filtering would never find it).
async function fetchCategories(
  search: string,
  sortKey: SortKey,
  sortAsc: boolean,
): Promise<Row[]> {
  let query = supabase
    .from("gbp_categories")
    .select("*")
    .order(sortKey, { ascending: sortAsc, nullsFirst: false })
    .limit(500);

  const q = search.trim().replace(/[,%()]/g, "");
  if (q) query = query.or(`display_name.ilike.%${q}%,gcid.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    gcid: r.gcid,
    display_name: r.display_name,
    entity_type: r.entity_type ?? null,
    status: r.status ?? null,
    supports_single_pro_office: r.supports_single_pro_office,
    is_launched: r.is_launched,
    estimated_profiles: r.estimated_profiles ?? null,
    estimated_locations: r.estimated_locations ?? null,
  }));
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
        <div className={`mt-2 text-3xl font-semibold ${tone ?? "text-slate-900"}`}>{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>;
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    excluded: "bg-slate-200 text-slate-700",
    pending: "bg-amber-100 text-amber-800",
  };
  return (
    <Badge variant="secondary" className={map[status] ?? "bg-slate-100 text-slate-700"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

const fullId = (g: string) => (g.startsWith("gcid:") ? g : `gcid:${g}`);

function RelBadge({ gcid, name }: { gcid: string; name: string }) {
  const rel = getCategoryRelationships(gcid, name);
  if (!rel) return null;
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap",
        rel.role === "specialization"
          ? "bg-amber-100 text-amber-700"
          : rel.role === "lane"
            ? "bg-violet-100 text-violet-700"
            : "bg-sky-100 text-sky-700",
      )}
    >
      {rel.badge}
    </span>
  );
}

function CategoryRow({ row, depth, tree }: { row: Row; depth: number; tree: boolean }) {
  const childGcids = CHILDREN[fullId(row.gcid)] ?? [];
  const hasKids = tree && childGcids.length > 0;
  const [open, setOpen] = useState(false);
  const kidsQ = useQuery({
    queryKey: ["cat-tree-kids", row.gcid],
    enabled: open && hasKids,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("gbp_categories")
        .select(
          "gcid,display_name,entity_type,status,estimated_profiles,estimated_locations,supports_single_pro_office",
        )
        .in("gcid", childGcids)
        .order("display_name", { ascending: true });
      return (data ?? []) as Row[];
    },
  });

  return (
    <>
      <TableRow>
        <TableCell className="font-medium text-slate-900">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 18 }}>
            {hasKids ? (
              <button
                onClick={() => setOpen((o) => !o)}
                className="text-slate-400 hover:text-slate-700 shrink-0"
                aria-label={open ? "Collapse" : "Expand"}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : tree ? (
              <span className="inline-block w-4 shrink-0" />
            ) : null}
            <span>{row.display_name}</span>
            <RelBadge gcid={row.gcid} name={row.display_name} />
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs text-slate-600">{row.gcid}</TableCell>
        <TableCell className="text-slate-700">
          {row.entity_type ?? <span className="text-slate-400">—</span>}
        </TableCell>
        <TableCell>
          <StatusBadge status={row.status} />
        </TableCell>
        <TableCell className="text-right tabular-nums text-slate-700">
          {row.estimated_profiles != null ? Number(row.estimated_profiles).toLocaleString() : <span className="text-slate-400">—</span>}
        </TableCell>
        <TableCell className="text-right tabular-nums text-slate-700">
          {row.estimated_locations != null ? Number(row.estimated_locations).toLocaleString() : <span className="text-slate-400">—</span>}
        </TableCell>
        <TableCell className="text-xs">
          {row.supports_single_pro_office ? (
            <span className="text-emerald-700">Yes</span>
          ) : (
            <span className="text-slate-400">No</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          <Button variant="outline" size="sm" asChild>
            <Link to="/categories/$gcid" params={{ gcid: row.gcid }}>
              <Pencil className="h-3 w-3" />
              Edit
            </Link>
          </Button>
        </TableCell>
      </TableRow>
      {open && hasKids &&
        (kidsQ.isLoading ? (
          <TableRow>
            <TableCell colSpan={8} className="py-2 text-xs text-slate-400" style={{ paddingLeft: (depth + 1) * 18 + 28 }}>
              Loading specializations…
            </TableCell>
          </TableRow>
        ) : (
          (kidsQ.data ?? []).map((c) => <CategoryRow key={c.gcid} row={c} depth={depth + 1} tree />)
        ))}
    </>
  );
}

function CategoriesPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [viewMode, setViewMode] = useState<"tree" | "flat">("tree");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: stats = { total: 0, active: 0, launched: 0, excluded: 0 } } = useQuery({
    queryKey: ["gbp_categories_stats"],
    queryFn: fetchStats,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["gbp_categories", debounced, sortKey, sortAsc],
    queryFn: () => fetchCategories(debounced, sortKey, sortAsc),
  });

  const rows = data;
  const treeMode = !debounced && viewMode === "tree";

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(true);
    }
  };

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <TableHead>
      <button
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900"
      >
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </TableHead>
  );

  return (
    <EmpLayout>
      <div className="p-8 max-w-[1400px] mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-slate-900">Categories</h2>
          <p className="text-sm text-slate-500 mt-1">
            {stats.total.toLocaleString()} GBP categories — the foundation of the platform
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Active" value={stats.active} tone="text-emerald-600" />
          <StatCard label="Launched" value={stats.launched} tone="text-amber-600" />
          <StatCard label="Excluded" value={stats.excluded} tone="text-slate-500" />
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search categories or GCID…"
                  className="pl-9"
                />
              </div>
              <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden bg-white text-[13px] shrink-0">
                {(["tree", "flat"] as const).map((m) => {
                  const active = (debounced ? "flat" : viewMode) === m;
                  const disabled = !!debounced && m === "tree";
                  return (
                    <button
                      key={m}
                      onClick={() => setViewMode(m)}
                      disabled={disabled}
                      title={disabled ? "Tree view is available when not searching" : undefined}
                      className={cn(
                        "px-3 py-1.5 capitalize",
                        active ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50",
                        disabled && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead k="display_name">Category Name</SortHead>
                  <SortHead k="gcid">GCID</SortHead>
                  <SortHead k="entity_type">Entity Type</SortHead>
                  <SortHead k="status">Status</SortHead>
                  <SortHead k="estimated_profiles">Est. Profiles</SortHead>
                  <SortHead k="estimated_locations">Est. Locations</SortHead>
                  <TableHead>Single Pro Office</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-slate-500">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-slate-500">
                      No categories found.
                    </TableCell>
                  </TableRow>
                ) : (
                  (treeMode ? rows.filter((r) => !PARENT[fullId(r.gcid)]) : rows).map((r) => (
                    <CategoryRow key={r.gcid} row={r} depth={0} tree={treeMode} />
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </EmpLayout>
  );
}
