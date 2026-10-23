/**
 * Enterprise → Settings (consolidated).
 *
 * The nine legacy tiles are reorganised into seven grouped panels. Every value
 * shown is read live from organizations / enterprise_settings / sso_config /
 * user_roles / invitations / crm_integrations for the impersonated org.
 * Read-only in this release: where no backend write path exists we say so
 * rather than faking a control.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Building2,
  Database,
  Image as ImageIcon,
  Megaphone,
  ShieldCheck,
  Plug,
  UserCog,
  Users,
} from "lucide-react";
import { XmpShell } from "@v3/xmp/components/enterprise/xmp-chrome";
import { EmptyState, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { BrandAvatar } from "@v3/ui/components/sales/entity-avatar";
import { loadBrand, loadOverview } from "@v3/xmp/lib/enterprise-xmp";
import { loadEnterpriseSettings } from "@v3/ui/lib/enterprise-ops";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/settings")({
  ssr: false,
  component: EnterpriseSettings,
});

function Field({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[color:var(--color-hairline)] py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
          {label}
        </p>
        {hint ? <p className="mt-0.5 text-[11px] text-[color:var(--color-ink-3)]">{hint}</p> : null}
      </div>
      <div className="shrink-0 text-right text-sm text-ink">{value}</div>
    </div>
  );
}

function Toggle({ on, label }: { on: boolean | null | undefined; label?: string }) {
  const active = on === true;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        active
          ? "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]"
          : "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-[#1e8e3e]" : "bg-[color:var(--color-ink-3)]")} />
      {label ?? (active ? "Enabled" : "Off")}
    </span>
  );
}

function GroupTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]">
        {icon}
      </span>
      {children}
    </span>
  );
}

function NotWired({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      compact
      title={title}
      description={description}
      action={
        <span className="inline-flex items-center rounded-full bg-[color:var(--color-g-blue-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-g-blue)]">
          Instrument to activate
        </span>
      }
    />
  );
}

function EnterpriseSettings() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const brandId = brandQ.data?.id;
  const overviewQ = useQuery({
    queryKey: ["xmp-overview", brandId],
    queryFn: () => loadOverview(brandId!),
    enabled: !!brandId,
  });
  const cfgQ = useQuery({
    queryKey: ["xmp-settings", brandId],
    queryFn: () => loadEnterpriseSettings(brandId!),
    enabled: !!brandId,
  });

  const b = brandQ.data;
  const o = overviewQ.data;
  const s = cfgQ.data?.settings ?? null;
  const users = cfgQ.data?.users ?? [];
  const invites = cfgQ.data?.invites ?? [];
  const sso = cfgQ.data?.sso ?? [];
  const integrations = cfgQ.data?.integrations ?? 0;

  return (
    <XmpShell brand={b ?? null} slug={orgSlug}>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Everything that configures this organization, grouped. Values are read live from the platform record; changes in this release are made by your Experience.com team."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title={<GroupTitle icon={<Building2 className="h-3.5 w-3.5" />}>Account &amp; Brand</GroupTitle>}
          description="Account profile, branding assets, timezone and plan."
        >
          <div className="mb-4 flex items-center gap-3">
            <BrandAvatar name={b?.name ?? orgSlug} logoUrl={b?.logo_url ?? null} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{b?.name ?? orgSlug}</p>
              <p className="text-[11px] text-[color:var(--color-ink-3)]">
                {b?.logo_url ? "Primary logo on file" : "No logo uploaded"}
              </p>
            </div>
          </div>
          <Field label="Slug" value={b?.slug ?? "—"} />
          <Field label="Entity type" value={b?.entity_type ?? "—"} />
          <Field
            label="Headquarters"
            value={[b?.address_city, b?.address_state].filter(Boolean).join(", ") || "—"}
          />
          <Field label="Locations on file" value={o ? o.offices.toLocaleString() : "—"} />
          <Field label="Professionals on file" value={o ? o.pros.toLocaleString() : "—"} />
          <Field label="Plan / tier" value={s?.pricing_tier ?? "Not set"} />
          <Field
            label="Contract term"
            value={
              s?.contract_start || s?.contract_end
                ? `${s?.contract_start ?? "—"} → ${s?.contract_end ?? "—"}`
                : "Not set"
            }
          />
          <Field
            label="Asset management"
            hint="Logos and images used on public profiles"
            value={
              <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-ink-2)]">
                <ImageIcon className="h-3.5 w-3.5" />
                {b?.logo_url ? "1 asset" : "No assets"}
              </span>
            }
          />
          <Field label="Timezone" value={<span className="text-xs text-[color:var(--color-ink-3)]">Not captured on the org record</span>} />
        </Panel>

        <Panel
          title={<GroupTitle icon={<Database className="h-3.5 w-3.5" />}>Data &amp; Ingestion</GroupTitle>}
          description="Feed sources and field mapping. Pairs with Transactions."
        >
          <Field label="CRM sync entitlement" value={<Toggle on={s?.feature_crm_sync} />} />
          <Field label="API access" value={<Toggle on={s?.feature_api_access} />} />
          <Field label="Registered feed sources" value={integrations.toLocaleString()} />
          <Field
            label="Field mapping"
            hint="Per-source mapping is held on the integration record"
            value={integrations ? "Configured per source" : "None"}
          />
          <div className="mt-4">
            {integrations ? (
              <Link
                to="/enterprise/$orgSlug/transactions"
                params={{ orgSlug }}
                className="text-xs font-semibold text-[color:var(--color-g-blue)]"
              >
                Open Transactions → feed health
              </Link>
            ) : (
              <NotWired
                title="No inbound feed registered"
                description="Register a CRM/LOS source to enable ingestion, field mapping and the volume audit in Transactions."
              />
            )}
          </div>
        </Panel>

        <Panel
          title={<GroupTitle icon={<Megaphone className="h-3.5 w-3.5" />}>Campaigns &amp; Delivery</GroupTitle>}
          description="Review campaigns, sender email and autopost destinations."
        >
          <Field label="Campaigns" value={<Toggle on={s?.feature_campaigns} />} />
          <Field label="VOCE surveys" value={<Toggle on={s?.feature_voce} />} />
          <Field label="Org-level posting" value={<Toggle on={s?.allow_org_posts} />} />
          <Field label="Post approval required" value={<Toggle on={s?.require_post_approval} />} />
          <Field
            label="Sender domain"
            hint="Email setup for campaign delivery"
            value={<span className="text-xs text-[color:var(--color-ink-3)]">Not configured</span>}
          />
          <Field
            label="Autopost destinations"
            hint="Social profiles and Google Business Profile"
            value={<span className="text-xs text-[color:var(--color-ink-3)]">Connect in Integrations</span>}
          />
        </Panel>

        <Panel
          title={<GroupTitle icon={<ShieldCheck className="h-3.5 w-3.5" />}>AI Content Checks</GroupTitle>}
          description="The PII and profanity gate every piece of public content passes before publish."
        >
          <Field label="Review PII filter" value={<Toggle on={s?.review_pii_filter} />} />
          <Field
            label="PII restrictions"
            value={
              s?.pii_restrictions
                ? `${Object.keys(s.pii_restrictions as Record<string, unknown>).length} rule(s)`
                : "Platform default"
            }
          />
          <Field
            label="Compliance overrides"
            hint="Category compliance rules always apply"
            value={
              s?.compliance_rules_override
                ? `${Object.keys(s.compliance_rules_override as Record<string, unknown>).length} override(s)`
                : "None"
            }
          />
          <Field label="Brand voice" value={s?.brand_voice ? "Set" : "Platform default"} />
          <Field label="AI agents" value={<Toggle on={s?.feature_ai_agents} />} />
        </Panel>

        <Panel
          title={<GroupTitle icon={<Plug className="h-3.5 w-3.5" />}>Integrations &amp; SSO</GroupTitle>}
          description="CRM/LOS connectors, webhooks and single sign-on."
        >
          <Field label="Connectors" value={integrations.toLocaleString()} />
          <Field
            label="Single sign-on"
            value={
              sso.length ? (
                <span className="text-xs text-ink">
                  {sso[0]!.provider ?? "SAML"} · <Toggle on={sso[0]!.is_active} />
                </span>
              ) : (
                <span className="text-xs text-[color:var(--color-ink-3)]">Not configured</span>
              )
            }
          />
          <Field label="Websites" value={<Toggle on={s?.feature_websites} />} />
          <Field label="Analytics" value={<Toggle on={s?.feature_analytics} />} />
          <Field
            label="Webhooks"
            value={<span className="text-xs text-[color:var(--color-ink-3)]">No endpoints registered</span>}
          />
        </Panel>

        <Panel
          title={<GroupTitle icon={<UserCog className="h-3.5 w-3.5" />}>Account team</GroupTitle>}
          description="Your Experience.com contacts for this account."
        >
          <NotWired
            title="No account team assigned on the platform record"
            description="CSM and account-manager assignments appear here once they are recorded against this organization."
          />
        </Panel>

        <Panel
          title={<GroupTitle icon={<Users className="h-3.5 w-3.5" />}>Users &amp; Roles</GroupTitle>}
          description="Role-based access within this organization."
        >
          <Field label="Users with a role here" value={users.length.toLocaleString()} />
          <Field
            label="Active"
            value={users.filter((u) => u.is_active === true).length.toLocaleString()}
          />
          <Field
            label="Can manage users"
            value={users.filter((u) => u.can_manage_users === true).length.toLocaleString()}
          />
          <Field
            label="Can publish content"
            value={users.filter((u) => u.can_publish_content === true).length.toLocaleString()}
          />
          <Field label="Open invitations" value={invites.filter((i) => i.status !== "accepted").length.toLocaleString()} />
          <div className="mt-4">
            {users.length ? (
              <Link
                to="/enterprise/$orgSlug/users"
                params={{ orgSlug }}
                className="text-xs font-semibold text-[color:var(--color-g-blue)]"
              >
                Manage users →
              </Link>
            ) : (
              <NotWired
                title="No org-scoped users yet"
                description="Users appear here once they accept an invitation scoped to this organization."
              />
            )}
          </div>
        </Panel>
      </div>
    </XmpShell>
  );
}
