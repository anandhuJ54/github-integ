import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { XmpShell } from "@v3/xmp/components/enterprise/xmp-chrome";
import { Panel, EmptyState, StatTile } from "@v3/shared/components/ui/console-primitives";
import { Badge } from "@v3/shared/components/ui/badge";
import { loadBrand, loadModerationQueue } from "@v3/xmp/utils/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/moderation")({
  ssr: false,
  component: Moderation,
});

function Moderation() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const brandId = brandQ.data?.id;

  const queueQ = useQuery({
    queryKey: ["xmp-moderation", brandId],
    queryFn: () => loadModerationQueue(brandId!, 50),
    enabled: !!brandId,
  });

  const items = queueQ.data ?? [];
  const flagged = items.filter((i) => i.flags.length > 0);

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Items in queue" value={items.length.toLocaleString()} tone="neutral" loading={queueQ.isLoading} />
          <StatTile
            label="Flagged for review"
            value={flagged.length.toLocaleString()}
            hint="PII or profanity detected"
            tone={flagged.length ? "red" : "green"}
            loading={queueQ.isLoading}
          />
          <StatTile label="Clean" value={(items.length - flagged.length).toLocaleString()} tone="green" loading={queueQ.isLoading} />
        </div>

        <Panel
          title="AI moderation queue"
          description="Public content is screened for PII and profanity before publish. Screening is deterministic today; the queue is read-only in XMP — no approve/publish action is exposed here."
        >
          {queueQ.isLoading ? (
            <div className="h-24 animate-pulse rounded-xl bg-[color:var(--color-surface-2)]" />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-4 w-4" />}
              title="Instrument to activate"
              description="No public content exists for this brand's professionals yet, so the moderation queue is empty. Once review or content ingestion is wired, incoming items are screened here before publish."
            />
          ) : (
            <ul className="divide-y divide-[color:var(--color-hairline)]">
              {items.map((i) => (
                <li key={i.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">{i.reviewer_name ?? "Anonymous"}</span>
                    {i.rating != null ? (
                      <Badge variant="secondary" className="border-0 bg-[color:var(--color-g-yellow-soft)] text-[#b06000] text-[10px]">
                        {i.rating}★
                      </Badge>
                    ) : null}
                    {i.review_date ? (
                      <span className="text-xs text-[color:var(--color-ink-3)]">
                        {new Date(i.review_date).toLocaleDateString()}
                      </span>
                    ) : null}
                    <span className="flex-1" />
                    {i.flags.length ? (
                      i.flags.map((f) => (
                        <Badge key={f} variant="secondary" className="border-0 bg-[color:var(--color-g-red-soft)] text-[#c5221f] text-[10px]">
                          {f}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="secondary" className="border-0 bg-[color:var(--color-g-green-soft)] text-[#1e8e3e] text-[10px]">
                        Clean
                      </Badge>
                    )}
                  </div>
                  {i.review_text ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--color-ink-2)]">{i.review_text}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </XmpShell>
  );
}
