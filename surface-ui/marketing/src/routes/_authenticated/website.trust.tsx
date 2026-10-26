import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Textarea } from "@v3/shared/components/ui/textarea";
import {
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/shared/components/ui/console-primitives";
import { FieldRow } from "@v3/shared/public/components/website-bits";
import { loadTrustItems, webMutations, type TrustItem } from "@v3/marketing/utils/website";

export const Route = createFileRoute("/_authenticated/website/trust")({
  head: () => ({
    meta: [
      { title: "Trust Center — Website" },
      {
        name: "description",
        content:
          "Owner-authored security, privacy and compliance content for the primary site: grouped items with body copy and linked documents.",
      },
      { property: "og:title", content: "Trust Center — Website" },
      { property: "og:description", content: "Security, privacy and compliance items grouped by category." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrustPage,
});

function TrustPage() {
  const qc = useQueryClient();
  const { data: items, isLoading } = useQuery({ queryKey: ["web-trust"], queryFn: loadTrustItems });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-trust"] });

  const [category, setCategory] = useState("Security");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [docUrl, setDocUrl] = useState("");

  const create = useMutation({
    mutationFn: () =>
      webMutations.createTrustItem({
        category: category.trim(),
        title: title.trim(),
        body: body.trim() || null,
        doc_url: docUrl.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Trust item added");
      setTitle("");
      setBody("");
      setDocUrl("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => webMutations.deleteTrustItem(id),
    onSuccess: () => {
      toast.success("Trust item removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, TrustItem[]>();
    for (const it of items ?? []) {
      const k = it.category ?? "General";
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Trust Center"
        title="Trust content"
        description="Owner-authored security, privacy and compliance statements, grouped by category, each with body copy and an optional linked document. Only publish claims you can evidence."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Items" value={items?.length ?? 0} icon={<ShieldCheck className="h-4 w-4" />} loading={isLoading} />
        <StatTile label="Categories" value={grouped.length} tone="blue" loading={isLoading} />
        <StatTile
          label="With documents"
          value={(items ?? []).filter((i) => i.doc_url).length}
          tone="purple"
          loading={isLoading}
        />
      </div>

      <Panel className="mt-6" title="Add trust item">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Security" />
          </FieldRow>
          <FieldRow label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Data retention" />
          </FieldRow>
          <div className="md:col-span-2">
            <FieldRow label="Body">
              <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
            </FieldRow>
          </div>
          <FieldRow label="Document URL">
            <Input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" />
          </FieldRow>
          <div className="flex items-end">
            <Button className="gap-1.5" disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>
        </div>
      </Panel>

      {isLoading ? null : grouped.length === 0 ? (
        <Panel className="mt-6">
          <EmptyState
            icon={<ShieldCheck className="h-4 w-4" />}
            title="No trust content yet"
            description="Add the first security, privacy or compliance item. Content published here is attributed to Experience.com as the site owner."
          />
        </Panel>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {grouped.map(([cat, list]) => (
            <Panel key={cat} title={cat} description={`${list.length} item${list.length === 1 ? "" : "s"}`}>
              <ul className="space-y-4">
                {list.map((it) => (
                  <li key={it.id} className="border-b border-[color:var(--color-hairline)] pb-4 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{it.title}</div>
                        {it.body ? (
                          <p className="mt-1 text-sm leading-relaxed text-[color:var(--color-ink-2)]">{it.body}</p>
                        ) : null}
                        {it.doc_url ? (
                          <a
                            href={it.doc_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs font-semibold text-[color:var(--color-g-blue)]"
                          >
                            View document
                          </a>
                        ) : null}
                      </div>
                      <Button size="sm" variant="ghost" className="text-[#c5221f]" onClick={() => remove.mutate(it.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </PageBody>
  );
}
