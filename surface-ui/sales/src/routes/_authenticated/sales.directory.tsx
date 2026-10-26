import { growthHubStyles } from "@v3/sales/components/sales/growth-hub-styles";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Input } from "@v3/shared/components/ui/input";
import { EmptyState, PageBody, PageHeader, Panel } from "@v3/shared/components/ui/console-primitives";
import { browse, type BrowseTab } from "@v3/sales/utils/sales-nav";

export const Route = createFileRoute("/_authenticated/sales/directory")({
  head: () => ({
    meta: [
      { title: "Directory search — Experience.com Growth Hub" },
      { name: "description", content: "One search across categories, teams, logos, locations and professionals, deep-linking into each canonical page." },
      { property: "og:title", content: "Directory search — Experience.com Growth Hub" },
      { property: "og:description", content: "Search once and jump into the canonical category, team, logo, location or professional page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalesDirectory,
});

const GROUPS: { tab: BrowseTab; label: string }[] = [
  { tab: "categories", label: "Categories" },
  { tab: "teams", label: "Teams" },
  { tab: "brands", label: "Logos" },
  { tab: "locations", label: "Locations" },
  { tab: "professionals", label: "Professionals" },
];
const nf = new Intl.NumberFormat("en-US");

function SalesDirectory() {
  const [q, setQ] = useState("");
  // Search once typing pauses: five searches per keystroke queue up behind the API's small
  // connection pool and time out ("database busy").
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQueries({
    queries: GROUPS.map((g) => ({
      queryKey: ["sales-directory-search", g.tab, term],
      queryFn: () => browse({ tab: g.tab, q: term, page: 1, pageSize: 6 }),
      enabled: term.length >= 2,
    })),
  });

  return (
    <PageBody className="growth-directory"><style>{growthHubStyles(".growth-directory") + DIRECTORY_CSS}</style>
      <PageHeader eyebrow="Growth Hub" title="Directory" description="Search once. Every result opens its canonical page." />
      <div className="directory-search relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search categories, teams, logos, locations, professionals…" className="h-11 pl-9" />
      </div>
      {term.length < 2 ? (
        <EmptyState title="Start typing to search" description="Enter at least two characters." compact />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {GROUPS.map((g, i) => {
            const r = results[i];
            const rows = r.data?.rows ?? [];
            return (
              <Panel key={g.tab} className="directory-group" title={g.label} actions={<span className="gh-status tabular-nums">{r.data ? `${nf.format(r.data.count)} matches` : "…"}</span>} bodyClassName="p-0">
                {r.isLoading ? <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p> : r.error ? <p className="px-4 py-3 text-sm text-destructive">{(r.error as Error).message}</p> : rows.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No rows yet</p> : (
                  <ul className="divide-y text-[12.5px]">
                    {rows.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2">
                        <Link to={row.to} params={row.params} className="font-semibold text-primary hover:underline">{row.primary}</Link>
                        <span className="truncate text-muted-foreground">{row.secondary ?? row.meta ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}

const DIRECTORY_CSS = `.growth-directory .directory-search input{height:52px;background:var(--gh-surface);border:1px solid var(--gh-line);box-shadow:var(--gh-shadow);font-size:14px}.growth-directory .directory-search svg{color:var(--gh-blue)}.growth-directory .directory-group{--group-tone:var(--gh-blue);position:relative;overflow:hidden}.growth-directory .directory-group:nth-child(2){--group-tone:var(--gh-slate)}.growth-directory .directory-group:nth-child(3){--group-tone:var(--gh-green)}.growth-directory .directory-group:nth-child(4){--group-tone:var(--gh-purple)}.growth-directory .directory-group:nth-child(5){--group-tone:var(--gh-amber)}.growth-directory .directory-group>header{background:linear-gradient(120deg,color-mix(in srgb,var(--group-tone) 8%,var(--gh-surface)),var(--gh-surface) 75%);border-top:4px solid var(--group-tone)}.growth-directory .directory-group h2{color:var(--group-tone)}.growth-directory .directory-group li{min-width:0;transition:background .14s;padding-block:12px}.growth-directory .directory-group li:hover{background:var(--gh-hover)}.growth-directory .directory-group li a{min-width:0;overflow-wrap:anywhere}.growth-directory .directory-group li>span{max-width:48%;flex-shrink:0}@media(max-width:640px){.growth-directory .directory-group li{align-items:flex-start;flex-direction:column;gap:3px}.growth-directory .directory-group li>span{max-width:100%}}`;
