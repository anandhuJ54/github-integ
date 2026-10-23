import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@/components/console/primitives";
import { InstrumentNote, Pill } from "@/components/website/bits";
import { loadPages } from "@/lib/website";

export const Route = createFileRoute("/_authenticated/website/developers")({
  head: () => ({
    meta: [
      { title: "Developers Portal — Website" },
      {
        name: "description",
        content:
          "The developer portal section of the primary site: content is managed here as dev-type pages, while the portal itself is owned operationally by the Ops team.",
      },
      { property: "og:title", content: "Developers Portal — Website" },
      { property: "og:description", content: "Dev-type site pages that make up the developer portal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevelopersPage,
});

function DevelopersPage() {
  const { data: pages, isLoading } = useQuery({ queryKey: ["web-pages"], queryFn: loadPages });
  const devPages = (pages ?? []).filter((p) => p.page_type === "dev");
  const published = devPages.filter((p) => p.status === "published").length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Developers"
        title="Developers portal"
        description="Content for the developer portal lives here as dev-type CMS pages. Editorial control sits with the Website team; the portal's operation, API surface and access are owned by the Ops team."
        actions={
          <Button asChild variant="outline">
            <Link to="/website/cms">Open CMS</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Dev pages" value={devPages.length} icon={<Code2 className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Published" value={published} tone="green" loading={isLoading} />
      </div>

      <Panel className="mt-6" title="Dev-type pages" bodyClassName="px-3 py-2">
        <DataTable
          columns={[
            {
              key: "title",
              header: "Page",
              cell: (p) => (
                <div>
                  <div className="font-medium text-ink">{p.title ?? "Untitled"}</div>
                  <div className="text-xs text-[color:var(--color-ink-3)]">/{p.slug ?? ""}</div>
                </div>
              ),
            },
            { key: "status", header: "Status", cell: (p) => <Pill value={p.status} /> },
            {
              key: "updated",
              header: "Updated",
              cell: (p) => (
                <span className="text-xs text-[color:var(--color-ink-2)]">
                  {p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}
                </span>
              ),
            },
          ]}
          rows={devPages}
          getRowKey={(p) => p.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Code2 className="h-4 w-4" />}
              title="No developer pages yet"
              description="Create a page in the CMS with page type “dev” and it appears here."
            />
          }
        />
      </Panel>

      <div className="mt-4">
        <InstrumentNote>
          API keys, sandbox credentials and usage analytics for the portal are owned by Ops and are not surfaced in this
          console yet.
        </InstrumentNote>
      </div>
    </PageBody>
  );
}
