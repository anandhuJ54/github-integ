import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Newspaper, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Switch } from "@v3/ui/components/ui/switch";
import {
  DataTable,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
  type Column,
} from "@v3/ui/components/console/primitives";
import { FieldRow, InstrumentNote, Pill } from "@v3/ui/components/website/bits";
import { ReadOnlyLock } from "@v3/ui/components/model-lock";
import { money, num } from "@v3/ui/lib/console-surfaces";
import { useRole } from "@v3/ui/lib/roles";
import { catLabel, loadLaunchedCategories } from "@v3/admin/lib/search-console";
import {
  BOOST_PLACEMENTS,
  PLACEMENT_LABEL,
  boostLive,
  boostTotals,
  hubPath,
  loadAllArticles,
  prettyTopic,
  updateBoost,
  type BoostPlacement,
  type VoceArticle,
} from "@v3/ui/lib/voce";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/search/voce")({
  head: () => ({
    meta: [
      { title: "VOCE Boost — Article placement manager" },
      {
        name: "description",
        content:
          "Boost VOCE articles into profile, category hub, topic hub, search and syndication placements, with live boost windows and spend.",
      },
      { property: "og:title", content: "VOCE Boost manager" },
      {
        property: "og:description",
        content: "Control which VOCE articles serve on profiles, hubs and search.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoceBoostPage,
});

function VoceBoostPage() {
  const role = useRole();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["voce-articles"], queryFn: loadAllArticles });
  const { data: cats } = useQuery({
    queryKey: ["launched-categories"],
    queryFn: loadLaunchedCategories,
  });
  const articles = data ?? [];
  const totals = boostTotals(articles);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = articles.find((a) => a.id === selectedId) ?? null;

  const labels = new Map((cats ?? []).map((c) => [c.gcid, c.label]));
  const label = (gcid: string | null) => catLabel(labels, gcid);

  const save = useMutation({
    mutationFn: async (args: Parameters<typeof updateBoost>) => updateBoost(args[0], args[1]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["voce-articles"] });
      toast.success("Boost updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<VoceArticle>[] = [
    {
      key: "title",
      header: "Article",
      cell: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{a.title}</div>
          <div className="truncate text-xs text-[color:var(--color-ink-3)]">
            {a.slug ?? "no slug"}
            {a.is_demo ? " · demo" : ""}
          </div>
        </div>
      ),
    },
    { key: "author", header: "Author", cell: (a) => a.author_name ?? "—" },
    { key: "gcid", header: "Category", cell: (a) => label(a.gcid) },
    { key: "topic", header: "Topic", cell: (a) => prettyTopic(a.topic) ?? "—" },
    { key: "published", header: "Published", cell: (a) => a.published_on ?? "—" },
    {
      key: "boosted",
      header: "Boosted",
      cell: (a) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={a.boosted}
            disabled={!role.canEdit || save.isPending}
            onCheckedChange={(v) => save.mutate([a.id, { boosted: v }])}
            aria-label={`Boost ${a.title}`}
          />
          {a.boosted ? <Pill value={boostLive(a) ? "live" : "scheduled"} /> : null}
        </div>
      ),
    },
    {
      key: "placements",
      header: "Placements",
      cell: (a) =>
        a.boost_placements.length === 0 ? (
          <span className="text-xs text-[color:var(--color-ink-3)]">none</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {a.boost_placements.map((p) => (
              <span
                key={p}
                className="rounded-full bg-[color:var(--color-surface-3)] px-2 py-0.5 text-[11px] text-[color:var(--color-ink-2)]"
              >
                {PLACEMENT_LABEL[p]}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: "window",
      header: "Boost window",
      cell: (a) =>
        a.boost_starts_on || a.boost_ends_on
          ? `${a.boost_starts_on ?? "open"} → ${a.boost_ends_on ?? "open"}`
          : "—",
    },
    {
      key: "spend",
      header: "Spend",
      align: "right",
      cell: (a) => (a.boost_spend === null ? "—" : money(a.boost_spend)),
    },
    {
      key: "hub",
      header: "",
      cell: (a) =>
        a.gcid ? (
          <a
            href={hubPath(a.gcid, a.topic)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--color-g-blue)]"
            onClick={(e) => e.stopPropagation()}
          >
            Hub <ExternalLink className="h-3 w-3" />
          </a>
        ) : null,
    },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Search"
        title="VOCE Boost"
        description="Map VOCE articles into the growth engine: profile features, category and topic hubs, SERP placement and syndication."
        actions={role.canEdit ? undefined : <ReadOnlyLock />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Articles" value={num(totals.total)} icon={<Newspaper />} loading={isLoading} />
        <StatTile
          label="Live boosts"
          value={num(totals.boosted)}
          hint="Boosted and inside window"
          tone="green"
          icon={<Rocket />}
          loading={isLoading}
        />
        <StatTile label="Live boost spend" value={money(totals.spend)} loading={isLoading} />
        <StatTile
          label="Serving in search"
          value={num(totals.byPlacement.find((p) => p.placement === "search")?.count ?? 0)}
          hint="Featured article units"
          loading={isLoading}
        />
      </div>

      <Panel
        title="Articles"
        description="Live rows from the VOCE library. Toggle a boost, then edit placements, window and spend."
      >
        <DataTable
          columns={columns}
          rows={articles}
          getRowKey={(a) => a.id}
          loading={isLoading}
          onRowClick={(a) => setSelectedId(a.id)}
          empty={
            <InstrumentNote>
              No VOCE articles exist yet. Publish articles to boost them into profiles, hubs and
              search.
            </InstrumentNote>
          }
        />
      </Panel>

      {selected ? (
        <BoostEditor
          key={selected.id}
          article={selected}
          canEdit={role.canEdit}
          saving={save.isPending}
          onSave={(patch) => save.mutate([selected.id, patch])}
        />
      ) : null}
    </PageBody>
  );
}

function BoostEditor({
  article,
  canEdit,
  saving,
  onSave,
}: {
  article: VoceArticle;
  canEdit: boolean;
  saving: boolean;
  onSave: (patch: Parameters<typeof updateBoost>[1]) => void;
}) {
  const [placements, setPlacements] = useState<BoostPlacement[]>(article.boost_placements);
  const [starts, setStarts] = useState(article.boost_starts_on ?? "");
  const [ends, setEnds] = useState(article.boost_ends_on ?? "");
  const [spend, setSpend] = useState(article.boost_spend === null ? "" : String(article.boost_spend));

  useEffect(() => {
    setPlacements(article.boost_placements);
    setStarts(article.boost_starts_on ?? "");
    setEnds(article.boost_ends_on ?? "");
    setSpend(article.boost_spend === null ? "" : String(article.boost_spend));
  }, [article]);

  const toggle = (p: BoostPlacement) =>
    setPlacements((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <Panel
      className="mt-6"
      title={`Boost — ${article.title}`}
      description={`${article.author_name ?? "Unattributed"} · ${article.topic ? prettyTopic(article.topic) : "no topic"}`}
      actions={
        canEdit ? (
          <Button
            disabled={saving}
            onClick={() =>
              onSave({
                boost_placements: placements,
                boost_starts_on: starts || null,
                boost_ends_on: ends || null,
                boost_spend: spend.trim() === "" ? null : Number(spend),
              })
            }
          >
            Save boost
          </Button>
        ) : (
          <ReadOnlyLock />
        )
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
            Placements
          </span>
          <div className="flex flex-wrap gap-2">
            {BOOST_PLACEMENTS.map((p) => {
              const on = placements.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggle(p)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    on
                      ? "border-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue)] text-white"
                      : "border-[color:var(--color-hairline)] bg-card text-[color:var(--color-ink-2)]",
                    !canEdit && "opacity-60",
                  )}
                >
                  {PLACEMENT_LABEL[p]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldRow label="Boost starts">
            <Input
              type="date"
              value={starts}
              disabled={!canEdit}
              onChange={(e) => setStarts(e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Boost ends">
            <Input
              type="date"
              value={ends}
              disabled={!canEdit}
              onChange={(e) => setEnds(e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Spend (USD)">
            <Input
              type="number"
              min={0}
              value={spend}
              disabled={!canEdit}
              onChange={(e) => setSpend(e.target.value)}
            />
          </FieldRow>
        </div>
      </div>
    </Panel>
  );
}
