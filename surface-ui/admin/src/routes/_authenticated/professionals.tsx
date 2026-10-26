import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, User } from "lucide-react";
import { api } from "@v3/ui/lib/server-fn";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@v3/ui/components/ui/avatar";
import { TerritoryChip } from "@v3/admin/components/territory-chip";
import { cn } from "@v3/ui/lib/utils";

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
    // Distinct categories, in order (the API does the walk the page used to do per request).
    queryFn: () => api.get<string[]>("/admin/professionals/categories"),
  });

  const { data: stats } = useQuery({
    queryKey: ["pro-stats"],
    queryFn: () =>
      api.get<{ total: number; active: number; claimed: number; verified: number }>(
        "/admin/professionals/stats",
      ),
  });

  const { data: prosResult, isLoading } = useQuery({
    queryKey: [
      "professionals",
      { search, gcidFilter, locationFilter, claimedFilter, scoreRange, page },
    ],
    // Scores live in search_rank_scores (the scoring engine's output), never on
    // professionals.search_rank_score, which is a stale denormalized column.
    queryFn: () =>
      api.get<{ rows: Pro[]; count: number }>("/admin/professionals", {
        params: {
          search,
          gcid: gcidFilter,
          location: locationFilter,
          claimed: claimedFilter,
          score: scoreRange,
          page,
        },
      }),
  });

  const proIds = useMemo(() => (prosResult?.rows ?? []).map((p) => p.id), [prosResult]);

  const { data: scores } = useQuery({
    queryKey: ["pro-scores", proIds],
    enabled: proIds.length > 0,
    queryFn: () =>
      api.post<Record<string, { total: number; max: number; rank: number | null; rankOf: number | null }>>(
        "/admin/professionals/scores",
        { ids: proIds },
      ),
  });
  // Hydration depth straight from graph_nodes — real captured nodes only.
  const { data: depth } = useQuery({
    queryKey: ["pro-depth", proIds],
    enabled: proIds.length > 0,
    queryFn: () =>
      api.post<Record<string, { products: number; socials: number; credentials: number; total: number }>>(
        "/admin/professionals/depth",
        { ids: proIds },
      ),
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
    queryFn: () =>
      api.post<{ orgs: Record<string, string>; cats: Record<string, string> }>(
        "/admin/professionals/extras",
        { orgIds, gcids },
      ),
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
