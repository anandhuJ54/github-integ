import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cookie } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { Switch } from "@v3/ui/components/ui/switch";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { FieldRow, InstrumentNote } from "@v3/ui/components/website/bits";
import { consentStats, loadConsent, webMutations, type ConsentConfig } from "@v3/marketing/lib/website";

export const Route = createFileRoute("/_authenticated/website/consent")({
  head: () => ({
    meta: [
      { title: "Cookie Consent — Website" },
      {
        name: "description",
        content:
          "Manage the cookie banner and its categories — necessary, analytics and marketing — with privacy-preserving defaults, and read live consent statistics.",
      },
      { property: "og:title", content: "Cookie Consent — Website" },
      { property: "og:description", content: "Banner configuration, privacy-preserving defaults and consent stats." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConsentPage,
});

function ConsentPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["web-consent"], queryFn: loadConsent });
  const [cfg, setCfg] = useState<ConsentConfig | null>(null);

  useEffect(() => {
    if (data?.config) setCfg(data.config);
  }, [data?.config]);

  const save = useMutation({
    mutationFn: () => {
      if (!cfg) throw new Error("No config loaded");
      return webMutations.saveConsentConfig({
        banner_enabled: cfg.banner_enabled,
        banner_title: cfg.banner_title,
        banner_message: cfg.banner_message,
        analytics_default: cfg.analytics_default,
        marketing_default: cfg.marketing_default,
        policy_url: cfg.policy_url,
      });
    },
    onSuccess: () => {
      toast.success("Banner settings saved");
      qc.invalidateQueries({ queryKey: ["web-consent"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const events = data?.events ?? [];
  const s = consentStats(events);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Website · Cookie Consent"
        title="Consent"
        description="The banner, its categories and the defaults visitors get before they choose. Necessary cookies are always on; analytics and marketing default off unless you deliberately opt in."
        actions={
          <Button onClick={() => save.mutate()} disabled={!cfg || save.isPending}>
            Save settings
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Consent events" value={s.total} icon={<Cookie className="h-4 w-4" />} loading={isLoading} />
        <StatTile
          label="Analytics accepted"
          value={`${s.analyticsPct.toFixed(0)}%`}
          hint={`${s.analytics} of ${s.total}`}
          tone="blue"
          loading={isLoading}
        />
        <StatTile
          label="Marketing accepted"
          value={`${s.marketingPct.toFixed(0)}%`}
          hint={`${s.marketing} of ${s.total}`}
          tone="purple"
          loading={isLoading}
        />
      </div>

      <Panel className="mt-6" title="Banner" description="Applies to the public site's consent banner.">
        {cfg ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FieldRow label="Banner title">
              <Input value={cfg.banner_title} onChange={(e) => setCfg({ ...cfg, banner_title: e.target.value })} />
            </FieldRow>
            <FieldRow label="Privacy policy URL">
              <Input value={cfg.policy_url ?? ""} onChange={(e) => setCfg({ ...cfg, policy_url: e.target.value })} />
            </FieldRow>
            <div className="md:col-span-2">
              <FieldRow label="Banner message">
                <Textarea rows={3} value={cfg.banner_message} onChange={(e) => setCfg({ ...cfg, banner_message: e.target.value })} />
              </FieldRow>
            </div>
            <div className="space-y-3 md:col-span-2">
              <label className="flex items-center gap-3 text-sm text-[color:var(--color-ink-2)]">
                <Switch checked={cfg.banner_enabled} onCheckedChange={(v) => setCfg({ ...cfg, banner_enabled: v })} />
                Banner enabled
              </label>
              <div className="flex items-center gap-3 text-sm text-[color:var(--color-ink-3)]">
                <Switch checked disabled /> Necessary — always on, cannot be disabled
              </div>
              <label className="flex items-center gap-3 text-sm text-[color:var(--color-ink-2)]">
                <Switch checked={cfg.analytics_default} onCheckedChange={(v) => setCfg({ ...cfg, analytics_default: v })} />
                Analytics on by default
              </label>
              <label className="flex items-center gap-3 text-sm text-[color:var(--color-ink-2)]">
                <Switch checked={cfg.marketing_default} onCheckedChange={(v) => setCfg({ ...cfg, marketing_default: v })} />
                Marketing on by default
              </label>
            </div>
          </div>
        ) : (
          <EmptyState compact title="Loading configuration" description="Reading the stored banner configuration." />
        )}
      </Panel>

      <Panel className="mt-6" title="Recent consent events" bodyClassName="px-3 py-2">
        <DataTable
          columns={[
            { key: "visitor", header: "Visitor", cell: (e) => <span className="font-mono text-xs">{e.visitor_id ?? "—"}</span> },
            { key: "necessary", header: "Necessary", cell: (e) => (e.necessary ? "yes" : "no") },
            { key: "analytics", header: "Analytics", cell: (e) => (e.analytics ? "yes" : "no") },
            { key: "marketing", header: "Marketing", cell: (e) => (e.marketing ? "yes" : "no") },
            { key: "region", header: "Region", cell: (e) => <span className="text-xs">{e.region ?? "—"}</span> },
            {
              key: "when",
              header: "When",
              cell: (e) => (
                <span className="text-xs text-[color:var(--color-ink-2)]">
                  {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                </span>
              ),
            },
          ]}
          rows={events}
          getRowKey={(e) => e.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Cookie className="h-4 w-4" />}
              title="No consent events recorded"
              description="Events appear once the public banner posts visitor choices."
            />
          }
        />
      </Panel>

      <div className="mt-4">
        <InstrumentNote>
          The banner configuration is live, but the public site must post visitor choices into the consent event log
          before acceptance rates mean anything.
        </InstrumentNote>
      </div>
    </PageBody>
  );
}
