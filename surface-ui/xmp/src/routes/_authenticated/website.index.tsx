import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, Inbox, Megaphone, MousePointerClick, Users } from "lucide-react";
import {
  Column,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { InstrumentNote, Pill } from "@v3/ui/components/website/bits";
import {
  attribution,
  leadTotals,
  loadAlerts,
  loadCampaigns,
  loadLeads,
  loadPages,
  type AttributionRow,
} from "@v3/xmp/lib/website";

export const Route = createFileRoute("/_authenticated/website/")({
  head: () => ({
    meta: [
      { title: "Website — demand engine overview" },
      {
        name: "description",
        content:
          "How the Website team runs the primary site: pages published, leads captured and worked, campaign reach and marketing attribution by channel, source and campaign.",
      },
      { property: "og:title", content: "Website — demand engine overview" },
      {
        property: "og:description",
        content: "Live CMS, lead and attribution signals for the Experience.com primary site.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WebsiteOverview,
});

function attrColumns(header: string): Column<AttributionRow>[] {
  return [
    { key: "label", header, cell: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: "leads", header: "Leads", align: "right", cell: (r) => r.leads },
    { key: "q", header: "Qualified", align: "right", cell: (r) => r.qualified },
    { key: "i", header: "Ignored", align: "right", cell: (r) => r.ignored },
    {
      key: "conv",
      header: "Conv.",
      align: "right",
      cell: (r) => `${r.leads ? ((r.qualified / r.leads) * 100).toFixed(0) : 0}%`,
    },
  ];
}

function WebsiteOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["website-overview"],
    queryFn: async () => {
      const [pages, leads, campaigns, alerts] = await Promise.all([
        loadPages(),
        loadLeads(),
        loadCampaigns(),
        loadAlerts(),
      ]);
      return { pages, leads, campaigns, alerts };
    },
  });

  const leads = data?.leads ?? [];
  const t = leadTotals(leads);
  const attr = attribution(leads);
  const pages = data?.pages ?? [];
  const published = pages.filter((p) => p.status === "published").length;
  const activeAlerts = (data?.alerts ?? []).filter((a) => a.active).length;
  const liveCampaigns = (data?.campaigns ?? []).filter((c) => c.status === "active").length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website"
        title="Primary site & demand engine"
        description="Everything the Website team owns: the CMS behind the primary site, the lead engine that captures and routes demand, campaigns, ads, the demo center, trust and consent. Numbers here are read live — nothing is estimated."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Pages published"
          value={`${published} / ${pages.length}`}
          hint="published / total in CMS"
          icon={<FileText className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatTile
          label="Leads captured"
          value={t.total}
          hint={`${t.news} new · ${t.unassigned} unassigned`}
          icon={<Inbox className="h-4 w-4" />}
          tone="purple"
          loading={isLoading}
        />
        <StatTile
          label="Aging past SLA"
          value={t.aging}
          hint={`${t.ignored} ignored (${t.ignoredPct.toFixed(0)}%)`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={t.aging > 0 ? "red" : "green"}
          loading={isLoading}
        />
        <StatTile
          label="Lead conversion"
          value={`${t.conversionPct.toFixed(1)}%`}
          hint="qualified / total leads"
          icon={<MousePointerClick className="h-4 w-4" />}
          tone="green"
          loading={isLoading}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel
          title="Marketing attribution"
          description="Leads grouped by channel and source from each lead's UTM / first-touch and last-touch record."
          actions={
            <Link to="/website/leads" className="text-xs font-semibold text-[color:var(--color-g-blue)]">
              Lead inbox →
            </Link>
          }
        >
          <div className="space-y-6">
            <DataTable
              columns={attrColumns("Channel")}
              rows={attr.channel}
              getRowKey={(r) => `ch-${r.key}`}
              loading={isLoading}
              empty={
                <EmptyState
                  compact
                  title="No leads captured yet"
                  description="Channel attribution appears as soon as the first tracked form submission lands."
                />
              }
            />
            {attr.source.length ? (
              <DataTable
                columns={attrColumns("Source")}
                rows={attr.source}
                getRowKey={(r) => `sr-${r.key}`}
              />
            ) : null}
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel title="Campaign attribution" description="Leads by UTM campaign.">
            <DataTable
              columns={attrColumns("Campaign")}
              rows={attr.campaign}
              getRowKey={(r) => `cp-${r.key}`}
              loading={isLoading}
              empty={<EmptyState compact title="No campaign-tagged leads yet" />}
            />
          </Panel>

          <Panel title="Closed-loop revenue">
            <InstrumentNote>
              Lead → opportunity → closed-won revenue is not joined yet. It activates once leads carry a
              contract reference so we can attribute signed revenue back to channel and campaign.
            </InstrumentNote>
          </Panel>

          <Panel title="Site traffic">
            <InstrumentNote>
              Visit volume (~100k/mo) still lives in the analytics provider. Connect it and sessions,
              landing pages and visit→lead rate will report here beside the lead counts.
            </InstrumentNote>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Active campaigns"
          value={liveCampaigns}
          hint={`${data?.campaigns.length ?? 0} total`}
          icon={<Megaphone className="h-4 w-4" />}
          tone="purple"
          loading={isLoading}
        />
        <StatTile
          label="Site alerts live"
          value={activeAlerts}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={activeAlerts ? "yellow" : "neutral"}
          loading={isLoading}
        />
        <StatTile
          label="Leads by form"
          value={attr.form.length}
          hint="distinct capture forms with leads"
          icon={<Users className="h-4 w-4" />}
          tone="neutral"
          loading={isLoading}
        />
        <StatTile
          label="Cohorts represented"
          value={attr.cohort.length}
          icon={<Users className="h-4 w-4" />}
          tone="neutral"
          loading={isLoading}
        />
      </div>

      <Panel className="mt-6" title="Recently updated pages">
        <DataTable
          columns={[
            { key: "t", header: "Page", cell: (p) => <span className="font-medium text-ink">{p.title ?? "Untitled"}</span> },
            { key: "s", header: "Slug", cell: (p) => <span className="text-xs text-[color:var(--color-ink-2)]">/{p.slug ?? ""}</span> },
            { key: "ty", header: "Type", cell: (p) => <Pill value={p.page_type} /> },
            { key: "st", header: "Status", cell: (p) => <Pill value={p.status} /> },
            {
              key: "u",
              header: "Updated",
              align: "right",
              cell: (p) => (
                <span className="text-xs text-[color:var(--color-ink-3)]">
                  {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}
                  {p.updated_by ? ` · ${p.updated_by}` : ""}
                </span>
              ),
            },
          ]}
          rows={pages.slice(0, 8)}
          getRowKey={(p) => p.id}
          loading={isLoading}
          empty={
            <EmptyState
              compact
              title="No pages in the CMS yet"
              description="Create the first page in CMS and it will show here with its publish state."
              action={
                <Link to="/website/cms" className="text-xs font-semibold text-[color:var(--color-g-blue)]">
                  Open CMS →
                </Link>
              }
            />
          }
        />
      </Panel>
    </PageBody>
  );
}
