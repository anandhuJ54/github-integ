import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmpLayout } from "@/components/emp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TerritoryChip } from "@/components/sales/territory-chip";
import { cn } from "@/lib/utils";

function DepthBadges({
  products,
  socials,
  credentials,
  hasBio,
}: {
  products: number;
  socials: number;
  credentials: number;
  hasBio: boolean;
}) {
  const pill = (label: string, n: number, tone: string) => (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        n > 0 ? tone : "bg-slate-50 text-slate-400 border-slate-200",
      )}
      title={`${n} ${label}`}
    >
      {label} {n}
    </span>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {pill("prod", products, "bg-emerald-50 text-emerald-700 border-emerald-200")}
      {pill("soc", socials, "bg-cyan-50 text-cyan-700 border-cyan-200")}
      {pill("cred", credentials, "bg-violet-50 text-violet-700 border-violet-200")}
      <span
        className={cn(
          "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
          hasBio
            ? "bg-blue-50 text-blue-700 border-blue-200"
            : "bg-slate-50 text-slate-400 border-slate-200",
        )}
      >
        {hasBio ? "bio" : "no bio"}
      </span>
    </span>
  );
}


export const Route = createFileRoute("/_authenticated/professionals")({
  component: ProfessionalsPage,
});

const PAGE_SIZE = 50;

type Pro = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  slug: string | null;
  photo_url: string | null;

  gcid: string | null;
  job_title: string | null;
  address_city: string | null;
  address_state: string | null;
  primary_org_id: string | null;
  primary_license_number: string | null;
  primary_license_verified: boolean | null;
  claimed: boolean | null;
  bio: string | null;
  territory_id: string | null;
};


function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-1">{value}</div>
    </div>
  );
}

function fullName(p: Pro) {
  return (
    p.display_name ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    "Unnamed"
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function ProfessionalsPage() {
  const [search, setSearch] = useState("");
  const [gcidFilter, setGcidFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [claimedFilter, setClaimedFilter] = useState("all");
  const [scoreRange, setScoreRange] = useState("all");
  const [page, setPage] = useState(0);

  const { data: gcidOptions } = useQuery({
    queryKey: ["pro-gcids"],
    queryFn: async () => {
      // Fix (category filter, 2026-10-12): reading every row's gcid was capped at 1,000 rows, so newer
      // categories never appeared. Walk the distinct values instead: one tiny indexed request per category.
      const out: string[] = [];
      let last: string | null = null;
      for (let i = 0; i < 200; i++) {
        let q = supabase.from("professionals").select("gcid").not("gcid", "is", null);
        if (last !== null) q = q.gt("gcid", last);
        const { data, error } = await q.order("gcid").limit(1);
        if (error) throw error;
        const g = data?.[0]?.gcid;
        if (!g) break;
        out.push(g);
        last = g;
      }
      return out;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["pro-stats"],
    queryFn: async () => {
      const total = await supabase
        .from("professionals")
        .select("*", { count: "exact", head: true });
      const active = await supabase
        .from("professionals")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      const claimed = await supabase
        .from("professionals")
        .select("*", { count: "exact", head: true })
        .eq("claimed", true);
      const verified = await supabase
        .from("professionals")
        .select("*", { count: "exact", head: true })
        .eq("primary_license_verified", true);
      return {
        total: total.count ?? 0,
        active: active.count ?? 0,
        claimed: claimed.count ?? 0,
        verified: verified.count ?? 0,
      };
    },
  });

  const { data: prosResult, isLoading } = useQuery({
    queryKey: [
      "professionals",
      { search, gcidFilter, locationFilter, claimedFilter, scoreRange, page },
    ],
    queryFn: async () => {
      // Scores live in search_rank_scores (the scoring engine's output), never on
      // professionals.search_rank_score, which is a stale denormalized column.
      let scopedIds: string[] | null = null;
      let excludeIds: string[] | null = null;
      if (scoreRange !== "all") {
        let sq = supabase
          .from("search_rank_scores")
          .select("entity_id, total_score")
          .eq("entity_type", "professional");
        if (scoreRange === "0-300") sq = sq.gte("total_score", 0).lte("total_score", 300);
        if (scoreRange === "300-600") sq = sq.gte("total_score", 300).lte("total_score", 600);
        if (scoreRange === "600-850") sq = sq.gte("total_score", 600).lte("total_score", 850);
        const { data: sd, error: se } = await sq;
        if (se) throw se;
        const ids = (sd ?? []).map((r) => r.entity_id);
        if (scoreRange === "unscored") excludeIds = ids;
        else scopedIds = ids;
      }

      let q = supabase
        .from("professionals")
        .select(
          "id, first_name, last_name, display_name, slug, photo_url, gcid, job_title, address_city, address_state, primary_org_id, primary_license_number, primary_license_verified, claimed, bio, territory_id",
          { count: "exact" },

        )
        .order("display_name", { ascending: true, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(
          `display_name.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`,
        );
      }
      if (gcidFilter !== "all") q = q.eq("gcid", gcidFilter);
      if (locationFilter.trim()) {
        const l = `%${locationFilter.trim()}%`;
        q = q.or(`address_city.ilike.${l},address_state.ilike.${l}`);
      }
      if (claimedFilter === "claimed") q = q.eq("claimed", true);
      if (claimedFilter === "unclaimed") q = q.eq("claimed", false);
      if (scopedIds) q = q.in("id", scopedIds.length ? scopedIds : ["00000000-0000-0000-0000-000000000000"]);
      if (excludeIds?.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as Pro[], count: count ?? 0 };
    },
  });

  const proIds = useMemo(() => (prosResult?.rows ?? []).map((p) => p.id), [prosResult]);

  const { data: scores } = useQuery({
    queryKey: ["pro-scores", proIds],
    enabled: proIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("search_rank_scores")
        .select("entity_id, total_score, max_possible, local_rank, local_rank_of, gaps")
        .eq("entity_type", "professional")
        .in("entity_id", proIds);
      if (error) throw error;
      const map: Record<
        string,
        { total: number; max: number; rank: number | null; rankOf: number | null }
      > = {};
      (data ?? []).forEach((r) => {
        map[r.entity_id] = {
          total: r.total_score,
          max: r.max_possible ?? 850,
          rank: r.local_rank ?? null,
          rankOf: r.local_rank_of ?? null,
        };
      });
      return map;
    },
  });
  // Hydration depth straight from graph_nodes — real captured nodes only.
  const { data: depth } = useQuery({
    queryKey: ["pro-depth", proIds],
    enabled: proIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("graph_nodes")
        .select("entity_id, node_type")
        .eq("entity_type", "professional")
        .eq("is_active", true)
        .in("entity_id", proIds);
      if (error) throw error;
      const map: Record<string, { products: number; socials: number; credentials: number; total: number }> = {};
      (data ?? []).forEach((r) => {
        const d = (map[r.entity_id] ??= { products: 0, socials: 0, credentials: 0, total: 0 });
        d.total += 1;
        const t = r.node_type ?? "";
        if (/product|service|offer/i.test(t)) d.products += 1;
        else if (/social|same_?as/i.test(t)) d.socials += 1;
        else if (/credential|license|certif/i.test(t)) d.credentials += 1;
      });
      return map;
    },
  });




  const orgIds = useMemo(
    () =>
      Array.from(
        new Set(
          (prosResult?.rows ?? [])
            .map((p) => p.primary_org_id)
            .filter((v): v is string => !!v),
        ),
      ),
    [prosResult],
  );
  const gcids = useMemo(
    () =>
      Array.from(
        new Set(
          (prosResult?.rows ?? [])
            .map((p) => p.gcid)
            .filter((v): v is string => !!v),
        ),
      ),
    [prosResult],
  );

  const { data: extras } = useQuery({
    queryKey: ["pro-extras", orgIds, gcids],
    enabled: (orgIds.length > 0) || (gcids.length > 0),
    queryFn: async () => {
      const [orgsRes, catsRes] = await Promise.all([
        orgIds.length
          ? supabase.from("organizations").select("id, name").in("id", orgIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        gcids.length
          ? supabase.from("gbp_categories").select("gcid, display_name").in("gcid", gcids)
          : Promise.resolve({ data: [] as { gcid: string; display_name: string }[] }),
      ]);
      const orgs: Record<string, string> = {};
      (orgsRes.data ?? []).forEach((o) => { orgs[o.id] = o.name; });
      const cats: Record<string, string> = {};
      (catsRes.data ?? []).forEach((c) => { cats[c.gcid] = c.display_name; });
      return { orgs, cats };
    },
  });

  const totalPages = Math.max(
    1,
    Math.ceil((prosResult?.count ?? 0) / PAGE_SIZE),
  );

  return (
    <EmpLayout>
      <div className="p-8 max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Profiles</h1>
            <p className="text-sm text-slate-500 mt-1">
              Professionals and organizations across all categories — with live hydration depth
            </p>
          </div>
          <Button className="gap-1.5">+ New Profile</Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total" value={stats?.total ?? "—"} />
          <StatCard label="Active" value={stats?.active ?? "—"} />
          <StatCard label="Claimed" value={stats?.claimed ?? "—"} />
          <StatCard label="License verified" value={stats?.verified ?? "—"} />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="relative md:col-span-4">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search by name…"
              className="pl-9"
            />
          </div>
          <Select
            value={gcidFilter}
            onValueChange={(v) => { setGcidFilter(v); setPage(0); }}
          >
            <SelectTrigger className="md:col-span-3">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(gcidOptions ?? []).map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="City or state…"
            className="md:col-span-2"
            value={locationFilter}
            onChange={(e) => { setLocationFilter(e.target.value); setPage(0); }}
          />
          <Select
            value={claimedFilter}
            onValueChange={(v) => { setClaimedFilter(v); setPage(0); }}
          >
            <SelectTrigger className="md:col-span-1">
              <SelectValue placeholder="Claimed" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              <SelectItem value="claimed">Claimed</SelectItem>
              <SelectItem value="unclaimed">Unclaimed</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={scoreRange}
            onValueChange={(v) => { setScoreRange(v); setPage(0); }}
          >
            <SelectTrigger className="md:col-span-2">
              <SelectValue placeholder="Score range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any score</SelectItem>
              <SelectItem value="0-300">0 – 300</SelectItem>
              <SelectItem value="300-600">300 – 600</SelectItem>
              <SelectItem value="600-850">600 – 850</SelectItem>
              <SelectItem value="unscored">Unscored</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Job title</th>
                  <th className="text-left px-4 py-3 font-medium">Location</th>
                  <th className="text-left px-4 py-3 font-medium">License</th>
                  <th className="text-left px-4 py-3 font-medium">Organization</th>
                  <th className="text-left px-4 py-3 font-medium">Hydration depth</th>
                  <th className="text-left px-4 py-3 font-medium">Territory</th>
                  <th className="text-left px-4 py-3 font-medium">Claimed</th>
                  <th className="text-right px-4 py-3 font-medium">Score</th>
                  <th className="text-right px-4 py-3 font-medium">Local rank</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>

                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : (prosResult?.rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-slate-400">
                      <User className="h-6 w-6 mx-auto mb-2 opacity-50" />
                      No profiles found
                    </td>
                  </tr>
                ) : (
                  prosResult!.rows.map((p) => {
                    const name = fullName(p);
                    return (
                      <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <a
                            href={p.slug ? `/p/${p.slug}` : `/professionals/${p.id}`}
                            className="flex items-center gap-3 group"

                          >
                            <Avatar className="h-8 w-8">
                              {p.photo_url ? <AvatarImage src={p.photo_url} alt={name} /> : null}
                              <AvatarFallback className="text-xs bg-slate-100 text-slate-600">
                                {initials(name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-slate-900 group-hover:text-blue-600">
                              {name}
                            </span>
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          {p.gcid ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-slate-100 text-slate-700 border border-slate-200">
                              {extras?.cats?.[p.gcid] ?? p.gcid}
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{p.job_title ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {[p.address_city, p.address_state].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {p.primary_license_number ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-mono text-xs text-slate-700">
                                {p.primary_license_number}
                              </span>
                              <span
                                className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded-full border font-medium",
                                  p.primary_license_verified
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200",
                                )}
                              >
                                {p.primary_license_verified ? "Verified" : "Unverified"}
                              </span>
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {p.primary_org_id ? (extras?.orgs?.[p.primary_org_id] ?? "—") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <DepthBadges
                            products={depth?.[p.id]?.products ?? 0}
                            socials={depth?.[p.id]?.socials ?? 0}
                            credentials={depth?.[p.id]?.credentials ?? 0}
                            hasBio={!!p.bio}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {p.territory_id ? (
                            <TerritoryChip territoryId={p.territory_id} />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
                              p.claimed
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-slate-50 text-slate-600 border-slate-200",
                            )}
                          >
                            {p.claimed ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900">
                          {scores?.[p.id] ? (
                            <>
                              {scores[p.id].total}
                              <span className="text-slate-400 text-xs">
                                {" "}/ {scores[p.id].max}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-400" title="Not scored yet">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {scores?.[p.id]?.rank
                            ? `#${scores[p.id].rank}${scores[p.id].rankOf ? ` of ${scores[p.id].rankOf}` : ""}`
                            : "—"}
                        </td>

                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <a
                            href={p.slug ? `/p/${p.slug}` : `/professionals/${p.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                          >View public profile</a>

                          {p.slug ? (
                            <a
                              href={`/p/${p.slug}/graph`}
                              className="text-cyan-700 hover:text-cyan-900 text-xs font-medium mr-3"
                            >View Graph</a>
                          ) : null}

                          <a
                            href={`/seat/professional/${p.id}`}
                            className="text-emerald-700 hover:text-emerald-900 text-xs font-medium mr-3"
                          >Log in as</a>

                          <a
                            href={`/professionals/${p.id}`}
                            className="text-slate-600 hover:text-slate-900 text-xs font-medium"
                          >Edit</a>

                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
            <div>
              {prosResult?.count ?? 0} total ·{" "}
              {prosResult?.count
                ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, prosResult.count)}`
                : "0"}{" "}
              shown
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(Math.max(0, page - 1))}
              >Previous</Button>
              <span className="text-xs text-slate-500">
                Page {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage(page + 1)}
              >Next</Button>
            </div>
          </div>
        </div>
      </div>
    </EmpLayout>
  );
}
