import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Eye,
  ExternalLink,
  Search,
} from "lucide-react";
import { XmpShell } from "@v3/xmp/components/enterprise/xmp-chrome";
import { Panel, EmptyState } from "@v3/ui/components/console/primitives";
import { Input } from "@v3/ui/components/ui/input";
import { Button } from "@v3/ui/components/ui/button";
import { Badge } from "@v3/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import {
  loadBrand,
  loadOfficePage,
  loadOfficePros,
  loadStateOptions,
  proName,
} from "@v3/xmp/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/hierarchy")({
  ssr: false,
  component: HierarchyExplorer,
});

const PAGE_SIZE = 25;

function HierarchyExplorer() {
  const { orgSlug } = Route.useParams();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [state, setState] = useState("all");
  const [page, setPage] = useState(0);
  const [openOffice, setOpenOffice] = useState<string | null>(null);

  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const brandId = brandQ.data?.id;

  const statesQ = useQuery({
    queryKey: ["xmp-state-options", brandId],
    queryFn: () => loadStateOptions(brandId!),
    enabled: !!brandId,
  });

  const pageQ = useQuery({
    queryKey: ["xmp-offices", brandId, q, state, page],
    queryFn: () =>
      loadOfficePage({
        brandId: brandId!,
        q,
        state: state === "all" ? "" : state,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: !!brandId,
    placeholderData: (prev) => prev,
  });

  const prosQ = useQuery({
    queryKey: ["xmp-office-pros", openOffice],
    queryFn: () => loadOfficePros(openOffice!, 50),
    enabled: !!openOffice,
  });

  const total = pageQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = pageQ.data?.rows ?? [];

  const applySearch = () => {
    setQ(qInput.trim());
    setPage(0);
    setOpenOffice(null);
  };

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <Panel
        title="Hierarchy explorer"
        description="Brand → location → professional. Locations are paginated server-side; a location's roster loads only when opened."
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-ink-3)]" />
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              placeholder="Search location name, city or state…"
              className="pl-9"
            />
          </div>
          <Select
            value={state}
            onValueChange={(v) => {
              setState(v);
              setPage(0);
              setOpenOffice(null);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {(statesQ.data ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="secondary" onClick={applySearch}>
            Search
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--color-ink-2)]">
          <span className="tabular-nums">
            {total.toLocaleString()} locations match · page {page + 1} of {pages.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(0)}>
              First
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage(pages - 1)}
            >
              Last
            </Button>
          </div>
        </div>

        <div className="mt-3 divide-y divide-[color:var(--color-hairline)] rounded-xl border border-[color:var(--color-hairline)]">
          {pageQ.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse bg-[color:var(--color-surface-2)]" />
            ))
          ) : rows.length === 0 ? (
            <EmptyState title="No locations match" description="Adjust the search or state filter." compact />
          ) : (
            rows.map((r) => {
              const open = openOffice === r.id;
              return (
                <div key={r.id}>
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setOpenOffice(open ? null : r.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 text-[color:var(--color-ink-3)]" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-[color:var(--color-ink-3)]" />
                      )}
                      <Building2 className="h-4 w-4 shrink-0 text-[color:var(--color-ink-3)]" />
                      <span className="truncate text-sm font-medium text-ink">{r.name}</span>
                      <span className="truncate text-xs text-[color:var(--color-ink-2)]">
                        {[r.address_city, r.address_state].filter(Boolean).join(", ")}
                      </span>
                    </button>
                    <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                      {r.pro_count.toLocaleString()} pro{r.pro_count === 1 ? "" : "s"}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="border-0 bg-[color:var(--color-surface-3)] text-[10px]"
                    >
                      {r.search_rank_score ? `score ${r.search_rank_score}` : "unscored"}
                    </Badge>
                    <Link
                      to="/enterprise/$orgSlug/view/$kind/$id"
                      params={{ orgSlug, kind: "location", id: r.id }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[color:var(--color-g-blue)] hover:bg-[color:var(--color-surface-2)]"
                    >
                      <Eye className="h-3.5 w-3.5" /> View as
                    </Link>
                  </div>

                  {open ? (
                    <div className="bg-[color:var(--color-surface-2)] px-3 py-2">
                      {prosQ.isLoading ? (
                        <div className="h-10 animate-pulse rounded bg-white" />
                      ) : (prosQ.data ?? []).length === 0 ? (
                        <p className="py-2 text-xs text-[color:var(--color-ink-2)]">
                          No professionals attached to this location.
                        </p>
                      ) : (
                        <ul className="divide-y divide-[color:var(--color-hairline)]">
                          {(prosQ.data ?? []).map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 pl-6">
                              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                                {proName(p)}
                              </span>
                              <span className="text-xs text-[color:var(--color-ink-3)]">
                                {p.bio ? "hydrated" : "core only"}
                              </span>
                              <Link
                                to="/enterprise/$orgSlug/view/$kind/$id"
                                params={{ orgSlug, kind: "professional", id: p.id }}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[color:var(--color-g-blue)] hover:bg-white"
                              >
                                <Eye className="h-3.5 w-3.5" /> View as
                              </Link>
                              {p.slug ? (
                                <a
                                  href={`/p/${p.slug}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[color:var(--color-ink-2)] hover:bg-white"
                                >
                                  Public profile <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </XmpShell>
  );
}
