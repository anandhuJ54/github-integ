import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageBody, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { loadScopeDashboard } from "@v3/sales/lib/sales-spine";

export const Route = createFileRoute("/_authenticated/sales/categories/")({
  head: () => ({
    meta: [
      { title: "All categories — Growth Hub" },
      { name: "description", content: "Ranked list of every category with live claim activity, linking into each category drill-down." },
      { property: "og:title", content: "All categories — Growth Hub" },
      { property: "og:description", content: "Ranked category list linking into each category drill-down." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AllCategories,
});

const nf = new Intl.NumberFormat("en-US");
const label = (v: string) => v.replace(/^gcid:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function AllCategories() {
  const q = useQuery({ queryKey: ["sales-spine", "all", "all"], queryFn: () => loadScopeDashboard({ kind: "all" }) });
  const rows = q.data?.categories ?? [];
  return (
    <PageBody>
      <PageHeader eyebrow="Growth Hub · Overview" title="All categories" description="Every category with live claim activity, ranked by successful claims. Open one to drill in." />
      <Panel title="Ranked categories" bodyClassName="p-0">
        {q.isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <EmptyState title="No rows yet" compact /> : (
          <table className="w-full text-[12.5px] tabular-nums">
            <thead><tr className="border-b text-left text-[10.5px] uppercase text-muted-foreground"><th className="px-3 py-2">#</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Successful</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.key} className="border-b">
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2"><Link to="/sales/categories/$gcid" params={{ gcid: r.key }} className="font-semibold text-primary hover:underline">{label(r.key)}</Link></td>
                <td className="px-3 py-2 text-right">{nf.format(r.successful)}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Panel>
    </PageBody>
  );
}
