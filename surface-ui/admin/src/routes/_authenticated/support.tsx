import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Inbox, Clock, Users, Info, ArrowRight } from "lucide-react";
import { EmpLayout } from "@v3/shared/components/ui/emp-layout";
import {
  PageBody,
  PageHeader,
  Panel,
  StatTile,
  EmptyState,
  ConsoleTabs,
} from "@v3/shared/components/ui/console-primitives";
import { num } from "@v3/shared/public/utils/console-surfaces";
import { loadOrgStats } from "@v3/admin/utils/console-surfaces";

export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({
    meta: [
      { title: "Support — Experience.com Console" },
      {
        name: "description",
        content:
          "The support queue for customer-reported issues, escalations and account health signals across the book of business.",
      },
      { property: "og:title", content: "Support — Experience.com Console" },
      {
        property: "og:description",
        content: "Support queue, escalation paths and account health signals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupportPage,
});

function Instrument({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      icon={<Info className="h-4 w-4" />}
      title={title}
      description={description}
      compact
    />
  );
}

function SupportPage() {
  const { data, isLoading } = useQuery({ queryKey: ["org-stats"], queryFn: loadOrgStats });

  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="Customers"
          title="Support"
          description="Where customer-reported issues, escalations and account health signals converge. The ticket store is not connected yet, so every queue below states plainly what it needs rather than showing invented volume."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Open tickets"
            value="Instrument"
            hint="No ticket store connected"
            icon={<Inbox className="h-4 w-4" />}
            tone="neutral"
          />
          <StatTile
            label="Breaching SLA"
            value="Instrument"
            hint="Requires ticket timestamps"
            icon={<Clock className="h-4 w-4" />}
            tone="neutral"
          />
          <StatTile
            label="Accounts supported"
            value={num(data?.real)}
            hint="Live non-demo organizations"
            icon={<Users className="h-4 w-4" />}
            tone="blue"
            loading={isLoading}
          />
          <StatTile
            label="Claimed accounts"
            value={num(data?.claimed)}
            hint="Claimed profiles can raise tickets"
            icon={<Headphones className="h-4 w-4" />}
            tone="green"
            loading={isLoading}
          />
        </div>

        <div className="mt-8 space-y-6">
          <Panel
            title="Queues"
            description="The scaffold for the three queues support will run. Each activates as soon as its source is connected."
          >
            <ConsoleTabs
              tabs={[
                {
                  value: "inbox",
                  label: "Inbox",
                  content: (
                    <Instrument
                      title="Instrument to activate"
                      description="Inbound tickets need a support store — either a native tickets table or an inbound email/helpdesk connector. Until one exists, this queue stays empty rather than showing sample tickets."
                    />
                  ),
                },
                {
                  value: "escalations",
                  label: "Escalations",
                  content: (
                    <Instrument
                      title="Instrument to activate"
                      description="Escalations route from the inbox once severity and ownership fields exist. The audit trail for who touched an account is already captured in exp_admin_audit and will attach here."
                    />
                  ),
                },
                {
                  value: "health",
                  label: "Account health",
                  content: (
                    <div className="space-y-4">
                      <p className="text-sm leading-relaxed text-[color:var(--color-ink-2)]">
                        Account health will combine three signals that already exist live in the
                        platform: entitlement state, Search Rank Score movement and data-hygiene
                        mismatches per account.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Link
                          to="/accounts"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-hairline)] px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-[color:var(--color-g-blue)] hover:text-[color:var(--color-g-blue)]"
                        >
                          Open Accounts <ArrowRight className="h-3 w-3" />
                        </Link>
                        <Link
                          to="/billing"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-hairline)] px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-[color:var(--color-g-blue)] hover:text-[color:var(--color-g-blue)]"
                        >
                          Entitlement state <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="What this surface needs">
            <ul className="space-y-2.5">
              {[
                "A tickets table (subject, account, requester, severity, status, assignee, opened/closed timestamps) or a helpdesk connector.",
                "An SLA policy per tier so breach detection can be computed rather than estimated.",
                "Routing rules mapping account tier and category to the owning support pod.",
                "A link from ticket to entity so support lands directly on the affected profile or graph node.",
              ].map((b) => (
                <li key={b} className="flex gap-3 text-sm text-[color:var(--color-ink-2)]">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-g-blue)]" />
                  {b}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </PageBody>
    </EmpLayout>
  );
}
