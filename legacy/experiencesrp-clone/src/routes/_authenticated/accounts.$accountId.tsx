import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronRight,
  LogIn,
  ShieldCheck,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { EmpLayout } from "@/components/emp-layout";
import {
  ConsoleTabs,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@/components/console/primitives";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_FOR_KIND, useImpersonation } from "@/lib/impersonation";
import { useRole } from "@/lib/roles";
import { getAccountCsm } from "@/lib/csm";
import { CsmControl } from "@/components/accounts/csm-control";
import { useQuery as useCsmQuery } from "@tanstack/react-query";
import {
  loadAccount,
  loadEntitlements,
  recordLoginAs,
  setEntitlement,
  type AccountTreeNode,
  type EntitlementState,
} from "@/lib/accounts";

export const Route = createFileRoute("/_authenticated/accounts/$accountId")({
  head: () => ({
    meta: [
      { title: "Account record — Experience.com Console" },
      {
        name: "description",
        content:
          "Account overview, hierarchy, product entitlements and data hygiene for a single customer.",
      },
      { property: "og:title", content: "Account record — Experience.com Console" },
      {
        property: "og:description",
        content: "Hierarchy, entitlements and data hygiene for one customer account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountDetailPage,
});

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const STATE_LABELS: Record<EntitlementState, string> = {
  not_entitled: "Not entitled",
  entitled_unconfigured: "Entitled · unconfigured",
  active: "Active",
};

function AccountDetailPage() {
  const { accountId } = Route.useParams();
  const { user, canEdit } = useRole();
  const { enter } = useImpersonation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const account = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => loadAccount(accountId),
  });
  const entitlements = useQuery({
    queryKey: ["account-entitlements", accountId],
    queryFn: () => loadEntitlements(accountId),
  });

  const saveEntitlement = useMutation({
    mutationFn: ({ key, state }: { key: string; state: EntitlementState }) =>
      setEntitlement(accountId, key, state),
    onSuccess: () => {
      toast.success("Entitlement updated");
      qc.invalidateQueries({ queryKey: ["account-entitlements", accountId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loginAs = useMutation({
    mutationFn: (args: {
      nodeType: "organization" | "professional";
      nodeId: string;
      nodeName: string;
    }) =>
      recordLoginAs({
        actorEmail: user?.email ?? null,
        accountId,
        ...args,
      }),
    onSuccess: (_d, v) => toast.success(`Viewing as ${v.nodeName}`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (account.isLoading) {
    return (
      <EmpLayout>
        <PageBody>
          <div className="h-40 animate-pulse rounded-[20px] bg-[color:var(--color-surface-2)]" />
        </PageBody>
      </EmpLayout>
    );
  }

  const data = account.data;
  if (!data) {
    return (
      <EmpLayout>
        <PageBody>
          <EmptyState
            title="Account not found"
            description="This organization no longer exists or is not a root account."
            action={
              <Button asChild variant="outline">
                <Link to="/accounts">Back to accounts</Link>
              </Button>
            }
          />
        </PageBody>
      </EmpLayout>
    );
  }

  const contract = data.contracts[0] ?? null;

  return (
    <EmpLayout>
      <PageBody>
        <Link
          to="/accounts"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--color-ink-2)] hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Accounts
        </Link>
        <PageHeader
          eyebrow={data.account.entity_type ?? "Account"}
          title={data.account.name}
          description={
            [data.account.address_city, data.account.address_state]
              .filter(Boolean)
              .join(", ") || "Customer account record."
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <AccountCsm orgId={String(data.account.id)} />
              {data.account.slug ? (
                <Button
                  className="rounded-[10px] bg-[color:var(--color-g-blue)] text-white hover:opacity-90"
                  onClick={() => {
                    const slug = data.account.slug!;
                    const path = `/enterprise/${slug}`;
                    loginAs.mutate({
                      nodeType: "organization",
                      nodeId: data.account.id,
                      nodeName: data.account.name,
                    });
                    enter(
                      {
                        kind: "brand",
                        id: data.account.id,
                        name: data.account.name,
                        role: ROLE_FOR_KIND.brand,
                        path,
                        orgSlug: slug,
                      },
                      `/accounts/${accountId}`,
                    );
                    void navigate({ to: path as never });
                  }}
                >
                  <LogIn className="mr-1.5 h-4 w-4" /> Log in as
                </Button>
              ) : null}
              {data.account.slug ? (
                <Button asChild variant="outline" className="rounded-[10px]">
                  <Link to="/o/$slug" params={{ slug: data.account.slug }}>
                    View public profile
                  </Link>
                </Button>
              ) : null}
            </div>
          }
        />

        <ConsoleTabs
          tabs={[
            {
              value: "overview",
              label: "Overview",
              content: (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatTile
                      label="Organizations"
                      tone="blue"
                      icon={<Building2 className="h-4 w-4" />}
                      value={nf.format(data.orgCount)}
                      hint="Account + descendants"
                    />
                    <StatTile
                      label="Users"
                      tone="purple"
                      icon={<User className="h-4 w-4" />}
                      value={nf.format(data.userCount)}
                      hint="Professionals in hierarchy"
                    />
                    <StatTile
                      label="Discovered entities"
                      tone="neutral"
                      value={
                        data.discoveredCount != null ? nf.format(data.discoveredCount) : "—"
                      }
                      hint="ETL entities matching this brand"
                    />
                    <StatTile
                      label="MRR"
                      tone="green"
                      value={contract?.mrr != null ? cf.format(Number(contract.mrr)) : "—"}
                      hint={contract ? `Contract · ${contract.status}` : "No contract"}
                    />
                  </div>

                  <Panel title="Contracts" bodyClassName="p-4">
                    <DataTable
                      rows={data.contracts}
                      getRowKey={(r) => r.id}
                      columns={[
                        {
                          key: "name",
                          header: "Contract",
                          cell: (r) => <span className="font-medium">{r.name}</span>,
                        },
                        {
                          key: "status",
                          header: "Status",
                          cell: (r) => <span className="capitalize">{r.status}</span>,
                        },
                        {
                          key: "mrr",
                          header: "MRR",
                          align: "right",
                          cell: (r) => (r.mrr != null ? cf.format(Number(r.mrr)) : "—"),
                        },
                        {
                          key: "tokens",
                          header: "Token package",
                          align: "right",
                          cell: (r) =>
                            r.token_package != null ? nf.format(Number(r.token_package)) : "—",
                        },
                      ]}
                      empty={
                        <EmptyState
                          title="No contract yet"
                          description="Create a contract in Sales to start billing this account."
                          compact
                        />
                      }
                    />
                  </Panel>
                </div>
              ),
            },
            {
              value: "hierarchy",
              label: "Hierarchy",
              content: (
                <Panel
                  title="Org → region → branch → users"
                  description="Expand a node to walk down the tree. Log in as records an audit entry."
                  bodyClassName="p-4"
                >
                  <TreeNode
                    node={data.tree}
                    depth={0}
                    canEdit={canEdit}
                    onLoginAs={(nodeType, nodeId, nodeName) => {
                      loginAs.mutate({ nodeType, nodeId, nodeName });
                      void navigate({
                        to: `/seat/${nodeType === "professional" ? "professional" : "office"}/${nodeId}` as never,
                      });
                      void nodeName;
                    }}
                  />
                </Panel>
              ),
            },
            {
              value: "entitlements",
              label: "Entitlements",
              content: (
                <Panel
                  title="Products"
                  description="What Nora reads. Set each product's state for this account."
                  bodyClassName="p-4"
                >
                  <DataTable
                    loading={entitlements.isLoading}
                    rows={entitlements.data ?? []}
                    getRowKey={(r) => r.product.product_key}
                    columns={[
                      {
                        key: "product",
                        header: "Product",
                        cell: (r) => (
                          <div>
                            <p className="font-medium text-ink">{r.product.name}</p>
                            <p className="text-xs text-[color:var(--color-ink-3)]">
                              {r.product.billing_type}
                              {r.product.entity_scope ? ` · ${r.product.entity_scope}` : ""}
                            </p>
                          </div>
                        ),
                      },
                      {
                        key: "price",
                        header: "Price",
                        align: "right",
                        cell: (r) => {
                          const pro = r.product.price_monthly;
                          const loc = r.product.price_monthly_location;
                          if (pro == null && loc == null) return "—";
                          return (
                            <span className="font-mono text-xs">
                              {pro != null ? cf.format(Number(pro)) : "—"}
                              {" / "}
                              {loc != null ? cf.format(Number(loc)) : "—"}
                            </span>
                          );
                        },
                      },
                      {
                        key: "tokens",
                        header: "Tokens",
                        align: "right",
                        cell: (r) =>
                          r.entitlement?.tokens_included != null
                            ? nf.format(Number(r.entitlement.tokens_included))
                            : "—",
                      },
                      {
                        key: "state",
                        header: "State",
                        align: "right",
                        width: "230px",
                        cell: (r) => (
                          <Select
                            value={r.state}
                            disabled={!canEdit || saveEntitlement.isPending}
                            onValueChange={(v) =>
                              saveEntitlement.mutate({
                                key: r.product.product_key,
                                state: v as EntitlementState,
                              })
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                ["not_entitled", "entitled_unconfigured", "active"] as const
                              ).map((s) => (
                                <SelectItem key={s} value={s}>
                                  {STATE_LABELS[s]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ),
                      },
                    ]}
                    empty={
                      <EmptyState
                        title="No products in the catalog"
                        description="Seed exp_products to configure entitlements."
                        compact
                      />
                    }
                  />
                </Panel>
              ),
            },
            {
              value: "hygiene",
              label: "Data hygiene",
              content: (
                <Panel
                  title="Mismatches & dedup candidates"
                  description="Entity resolution issues that need a decision for this account."
                  bodyClassName="p-4"
                >
                  <EmptyState
                    icon={<ShieldCheck className="h-4 w-4" />}
                    title="Nothing to review"
                    description="No mismatches or dedup candidates are reported for this account yet. The resolution pipeline will populate this list."
                    compact
                  />
                </Panel>
              ),
            },
          ]}
        />
      </PageBody>
    </EmpLayout>
  );
}

function TreeNode({
  node,
  depth,
  canEdit,
  onLoginAs,
}: {
  node: AccountTreeNode;
  depth: number;
  canEdit: boolean;
  onLoginAs: (
    nodeType: "organization" | "professional",
    nodeId: string,
    nodeName: string,
  ) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0 || node.pros.length > 0;

  return (
    <div style={{ paddingLeft: depth ? 18 : 0 }}>
      <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-[color:var(--color-surface-2)]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="grid h-5 w-5 place-items-center text-[color:var(--color-ink-3)]"
          aria-label={open ? "Collapse" : "Expand"}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : null}
        </button>
        <Building2 className="h-4 w-4 shrink-0 text-[color:var(--color-ink-3)]" />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{node.org.name}</span>
        <span className="text-[11px] uppercase tracking-wider text-[color:var(--color-ink-3)]">
          {node.org.entity_type ?? "org"}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            node.org.is_active
              ? "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]"
              : "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]"
          }`}
        >
          {node.org.is_active ? "Published" : "Unpublished"}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-[8px] px-2 text-xs"
          disabled={!canEdit}
          onClick={() => onLoginAs("organization", node.org.id, node.org.name)}
        >
          <LogIn className="mr-1 h-3.5 w-3.5" /> Log in as
        </Button>
      </div>

      {open ? (
        <>
          {node.children.map((c) => (
            <TreeNode
              key={c.org.id}
              node={c}
              depth={depth + 1}
              canEdit={canEdit}
              onLoginAs={onLoginAs}
            />
          ))}
          {node.pros.map((p) => {
            const name =
              p.display_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
            return (
              <div
                key={p.id}
                style={{ paddingLeft: 18 * (depth + 1) + 18 }}
                className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-[color:var(--color-surface-2)]"
              >
                <User className="h-4 w-4 shrink-0 text-[color:var(--color-ink-3)]" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
                <span className="text-xs text-[color:var(--color-ink-3)]">
                  {p.search_rank_score != null ? `${p.search_rank_score} / 850` : "—"}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    p.claimed
                      ? "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]"
                      : "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]"
                  }`}
                >
                  {p.claimed ? "Published" : "Unclaimed"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-[8px] px-2 text-xs"
                  disabled={!canEdit}
                  onClick={() => onLoginAs("professional", p.id, name)}
                >
                  <LogIn className="mr-1 h-3.5 w-3.5" /> Log in as
                </Button>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

function AccountCsm({ orgId }: { orgId: string }) {
  const q = useCsmQuery({ queryKey: ["account-csm", orgId], queryFn: () => getAccountCsm(orgId) });
  return (
    <span className="mr-2 rounded-[8px] border border-[color:var(--color-hairline)] bg-card px-3 py-1.5">
      <CsmControl orgId={orgId} csm={q.data ?? null} />
    </span>
  );
}
