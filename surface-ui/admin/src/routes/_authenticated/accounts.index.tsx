import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, LogIn, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { ROLE_FOR_KIND, useImpersonation } from "@v3/ui/lib/impersonation";
import { useRole } from "@v3/ui/lib/roles";
import { loadAccounts, recordLoginAs, type AccountSummary } from "@v3/admin/lib/accounts";
import { isMine, listActiveCsms } from "@v3/admin/lib/csm";
import { CsmControl } from "@v3/admin/components/accounts/csm-control";
import { cn } from "@v3/ui/lib/utils";

const TAB_KEY = "xp.accounts.tab";

export const Route = createFileRoute("/_authenticated/accounts/")({
  head: () => ({
    meta: [
      { title: "Accounts — Experience.com Console" },
      {
        name: "description",
        content:
          "Every customer account: hierarchy, users, entitlements and data-hygiene health in one record.",
      },
      { property: "og:title", content: "Accounts — Experience.com Console" },
      {
        property: "og:description",
        content: "Customer accounts with hierarchy, users, entitlements and health.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountsPage,
});

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function StatusChip({ status }: { status: string | null }) {
  const label = status ?? "no contract";
  const tone =
    status === "active"
      ? "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]"
      : status
        ? "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]"
        : "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${tone}`}>{label}</span>
  );
}

function AccountsPage() {
  const navigate = useNavigate();
  const { user } = useRole();
  const { enter } = useImpersonation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const [tab, setTab] = useState<"all" | "mine">("all");
  useEffect(() => {
    if (window.localStorage.getItem(TAB_KEY) === "mine") setTab("mine");
  }, []);
  const pickTab = (t: "all" | "mine") => {
    setTab(t);
    window.localStorage.setItem(TAB_KEY, t);
  };

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: loadAccounts });
  const csms = useQuery({ queryKey: ["csm-assignments"], queryFn: listActiveCsms });

  const rows = useMemo(() => {
    let list = accounts.data ?? [];
    if (tab === "mine")
      list = list.filter((a) => {
        const c = csms.data?.get(String(a.account.id));
        return !!c && isMine(c, user?.id, user?.email);
      });
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) => a.account.name.toLowerCase().includes(q));
    if (status === "active") list = list.filter((a) => a.contractStatus === "active");
    if (status === "prospect") list = list.filter((a) => !a.contractStatus);
    return [...list].sort((a, b) => b.userCount - a.userCount);
  }, [accounts.data, csms.data, tab, user, search, status]);

  const totals = useMemo(() => {
    const list = accounts.data ?? [];
    return {
      accounts: list.length,
      users: list.reduce((s, a) => s + a.userCount, 0),
      mrr: list.reduce((s, a) => s + (a.contractStatus === "active" ? (a.mrr ?? 0) : 0), 0),
      mismatches: list.reduce((s, a) => s + a.mismatches, 0),
    };
  }, [accounts.data]);

  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="Customers"
          title="Accounts"
          description="The single customer record used by sales, onboarding, success and support. Open an account for its hierarchy, entitlements and data hygiene."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Accounts"
            tone="blue"
            icon={<Building2 className="h-4 w-4" />}
            loading={accounts.isLoading}
            value={nf.format(totals.accounts)}
            hint="Root organizations"
          />
          <StatTile
            label="Users in accounts"
            tone="purple"
            loading={accounts.isLoading}
            value={nf.format(totals.users)}
            hint="Professionals under an account"
          />
          <StatTile
            label="Contracted MRR"
            tone="green"
            loading={accounts.isLoading}
            value={cf.format(totals.mrr)}
            hint="Active contracts only"
          />
          <StatTile
            label="Hygiene flags"
            tone={totals.mismatches ? "red" : "neutral"}
            icon={totals.mismatches ? <TriangleAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            loading={accounts.isLoading}
            value={nf.format(totals.mismatches)}
            hint="Mismatch / dedup candidates"
          />
        </div>

        <div className="mt-8 flex gap-1 border-b border-[color:var(--color-hairline)]">
          {(["all", "mine"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pickTab(t)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                tab === t
                  ? "border-[color:var(--color-g-blue)] text-[color:var(--color-g-blue)]"
                  : "border-transparent text-[color:var(--color-ink-2)] hover:text-ink",
              )}
            >
              {t === "all" ? "All accounts" : "My accounts"}
            </button>
          ))}
        </div>

        <Panel
          className="mt-4"
          title={tab === "all" ? "All accounts" : "My accounts"}
          description={tab === "all" ? "Click a row to open the account record." : "Accounts where you are the assigned CSM."}
          bodyClassName="p-4"
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-ink-3)]" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search accounts…"
                  className="h-9 w-56 pl-8"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="active">Active contract</SelectItem>
                  <SelectItem value="prospect">No contract</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        >
          <DataTable<AccountSummary>
            loading={accounts.isLoading || (tab === "mine" && csms.isLoading)}
            rows={rows}
            getRowKey={(r) => r.account.id}
            onRowClick={(r) =>
              navigate({
                to: "/accounts/$accountId",
                params: { accountId: r.account.id },
              })
            }
            columns={[
              {
                key: "name",
                header: "Account",
                cell: (r) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{r.account.name}</p>
                    <CsmControl compact orgId={String(r.account.id)} csm={csms.data?.get(String(r.account.id)) ?? null} />
                    <p className="text-xs text-[color:var(--color-ink-3)]">
                      {[r.account.address_city, r.account.address_state]
                        .filter(Boolean)
                        .join(", ") || r.account.entity_type || "—"}
                    </p>
                  </div>
                ),
              },
              {
                key: "hierarchy",
                header: "Hierarchy",
                cell: (r) => (
                  <span className="text-xs text-[color:var(--color-ink-2)]">
                    {nf.format(r.regionCount)} regions · {nf.format(r.branchCount)} branches
                  </span>
                ),
              },
              {
                key: "users",
                header: "Users",
                align: "right",
                cell: (r) => nf.format(r.userCount),
              },
              {
                key: "discovered",
                header: "Discovered (ETL)",
                align: "right",
                cell: (r) =>
                  r.discoveredCount != null ? nf.format(r.discoveredCount) : "—",
              },
              {
                key: "mrr",
                header: "MRR",
                align: "right",
                cell: (r) => (r.mrr != null ? cf.format(r.mrr) : "—"),
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => <StatusChip status={r.contractStatus} />,
              },
              {
                key: "health",
                header: "Health",
                align: "right",
                cell: (r) =>
                  r.mismatches ? (
                    <span className="inline-flex items-center gap-1 text-xs text-[#c5221f]">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      {nf.format(r.mismatches)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-[#1e8e3e]">
                      <ShieldCheck className="h-3.5 w-3.5" /> Clear
                    </span>
                  ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (r) => (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-[8px] px-2 text-xs"
                    disabled={!r.account.slug}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!r.account.slug) return;
                      const slug = r.account.slug;
                      const path = `/enterprise/${slug}`;
                      void recordLoginAs({
                        actorEmail: user?.email ?? null,
                        nodeType: "organization",
                        nodeId: r.account.id,
                        nodeName: r.account.name,
                        accountId: r.account.id,
                      });
                      enter(
                        {
                          kind: "brand",
                          id: r.account.id,
                          name: r.account.name,
                          role: ROLE_FOR_KIND.brand,
                          path,
                          orgSlug: slug,
                        },
                        "/accounts",
                      );
                      toast.success(`Viewing as ${r.account.name}`);
                      void navigate({ to: path as never });
                    }}
                  >
                    <LogIn className="mr-1 h-3.5 w-3.5" /> Log in as
                  </Button>
                ),
              },
            ]}
            empty={
              tab === "mine" ? (
                <EmptyState
                  icon={<Building2 className="h-4 w-4" />}
                  title="No accounts assigned to you yet"
                  description="Use “Assign” on any account in All accounts to claim it, or ask a super-admin to assign you."
                  compact
                />
              ) : (
              <EmptyState
                icon={<Building2 className="h-4 w-4" />}
                title="No accounts yet"
                description="Accounts are root organizations. Create one, or run discovery to bring a brand in."
                compact
              />
              )
            }
          />
        </Panel>
      </PageBody>
    </EmpLayout>
  );
}
