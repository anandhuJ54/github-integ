import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlayCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Switch } from "@v3/shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/shared/components/ui/console-primitives";
import { FieldRow, Pill } from "@v3/shared/public/components/website-bits";
import { leadTotals, loadForms, loadLeads, loadMedia, webMutations } from "@v3/marketing/utils/website";

const MEDIA_TYPES = ["video", "pdf", "deck", "asset"];

export const Route = createFileRoute("/_authenticated/website/demo-center")({
  head: () => ({
    meta: [
      { title: "Demo Center — Website" },
      {
        name: "description",
        content:
          "Gated demo videos and sales assets: publish media, gate it behind a capture form, and handle inbound demo requests from the same lead pipeline.",
      },
      { property: "og:title", content: "Demo Center — Website" },
      { property: "og:description", content: "Gated demo videos and assets plus demo request handling." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DemoCenterPage,
});

function DemoCenterPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["web-media"],
    queryFn: async () => {
      const [media, forms, leads] = await Promise.all([loadMedia(), loadForms(), loadLeads()]);
      return { media, forms, leads };
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-media"] });

  const media = data?.media ?? [];
  const forms = data?.forms ?? [];
  const demoLeads = (data?.leads ?? []).filter((l) => (l.form_slug ?? "").includes("demo"));

  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState("video");
  const [url, setUrl] = useState("");
  const [gated, setGated] = useState(true);
  const [formSlug, setFormSlug] = useState("none");

  const create = useMutation({
    mutationFn: () =>
      webMutations.createMedia({
        title: title.trim(),
        media_type: mediaType,
        url: url.trim(),
        gated,
        form_slug: formSlug === "none" ? null : formSlug,
      }),
    onSuccess: () => {
      toast.success("Media added");
      setTitle("");
      setUrl("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: (v: { id: string; gated: boolean }) => webMutations.updateMedia(v.id, { gated: v.gated }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => webMutations.deleteMedia(id),
    onSuccess: () => {
      toast.success("Media removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const t = leadTotals(demoLeads);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Demo Center"
        title="Demos & assets"
        description="Publish the demo library, decide what is gated behind a capture form, and work the demo requests that come out of it."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Assets" value={media.length} icon={<PlayCircle className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Gated" value={media.filter((m) => m.gated).length} tone="blue" loading={isLoading} />
        <StatTile
          label="Demo requests"
          value={t.total}
          hint={`${t.news} new · ${t.aging} past SLA`}
          tone={t.aging ? "red" : "green"}
          loading={isLoading}
        />
      </div>

      <Panel className="mt-6" title="Add media">
        <div className="grid gap-4 md:grid-cols-5 md:items-end">
          <FieldRow label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nora platform walkthrough" />
          </FieldRow>
          <FieldRow label="Type">
            <Select value={mediaType} onValueChange={setMediaType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDIA_TYPES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="URL">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </FieldRow>
          <FieldRow label="Gate behind form">
            <Select value={formSlug} onValueChange={setFormSlug}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No form</SelectItem>
                {forms.map((f) => (
                  <SelectItem key={f.id} value={f.slug ?? f.id}>
                    {f.name ?? f.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-[color:var(--color-ink-2)]">
              <Switch checked={gated} onCheckedChange={setGated} /> Gated
            </label>
            <Button className="gap-1.5" disabled={!title.trim() || !url.trim() || create.isPending} onClick={() => create.mutate()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>
        {forms.length === 0 ? (
          <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
            No capture forms exist yet — build one under Leads to gate an asset.
          </p>
        ) : null}
      </Panel>

      <Panel className="mt-6" title="Library" bodyClassName="px-3 py-2">
        <DataTable
          columns={[
            {
              key: "title",
              header: "Asset",
              cell: (m) => (
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{m.title ?? "Untitled"}</div>
                  <div className="truncate text-xs text-[color:var(--color-ink-3)]">{m.url ?? "—"}</div>
                </div>
              ),
            },
            { key: "type", header: "Type", cell: (m) => <Pill value={m.media_type} /> },
            { key: "gate", header: "Gate", cell: (m) => <Pill value={m.gated ? "gated" : "open"} /> },
            { key: "form", header: "Form", cell: (m) => <span className="text-xs">{m.form_slug ?? "—"}</span> },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (m) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: m.id, gated: !m.gated })}>
                    {m.gated ? "Ungate" : "Gate"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[#c5221f]" onClick={() => remove.mutate(m.id)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          rows={media}
          getRowKey={(m) => m.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<PlayCircle className="h-4 w-4" />}
              title="No demo media yet"
              description="Add the first video or asset and decide whether it sits behind a lead form."
            />
          }
        />
      </Panel>

      <Panel className="mt-6" title="Demo requests" description="Leads captured by any form whose slug contains “demo”." bodyClassName="px-3 py-2">
        <DataTable
          columns={[
            { key: "name", header: "Lead", cell: (l) => l.name ?? l.email ?? "Unnamed" },
            { key: "company", header: "Company", cell: (l) => <span className="text-xs">{l.company ?? "—"}</span> },
            { key: "form", header: "Form", cell: (l) => <span className="text-xs">{l.form_slug ?? "—"}</span> },
            { key: "status", header: "Status", cell: (l) => <Pill value={l.status ?? "new"} /> },
          ]}
          rows={demoLeads}
          getRowKey={(l) => l.id}
          loading={isLoading}
          empty={<EmptyState compact title="No demo requests yet" description="Gated assets post their requests into the lead inbox." />}
        />
      </Panel>
    </PageBody>
  );
}
