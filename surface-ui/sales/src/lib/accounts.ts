import type { Tables } from "@v3/ui/integrations/supabase/types";
import { api } from "@v3/ui/lib/server-fn";

// FastAPI: surface-api/sales/routers/accounts_data.py (runs as the signed-in user).
const ACCOUNTS = "/sales/accounts";
const enc = encodeURIComponent;

// The rows the old selects returned (same columns, same generated types).
type ListContract = Pick<Tables<"exp_contracts">, "account_id" | "org_id" | "status" | "mrr">;
type TreeContract = Pick<
  Tables<"exp_contracts">,
  "id" | "name" | "account_id" | "org_id" | "status" | "mrr" | "token_package" | "start_date"
>;
type EntitlementRow = Pick<
  Tables<"exp_entitlements">,
  "id" | "product_key" | "state" | "tokens_included" | "source" | "granted_at"
>;

/** The exp_entity display_name ilike %name% exact count per name, in order (null when it failed). */
async function discoveredCounts(names: string[]): Promise<(number | null)[]> {
  return api.post<(number | null)[]>(`${ACCOUNTS}/discovered-counts`, { names });
}

export type OrgNode = {
  id: string;
  name: string;
  slug: string | null;
  entity_type: string | null;
  parent_org_id: string | null;
  hierarchy_depth: number | null;
  is_active: boolean | null;
  claimed: boolean | null;
  search_rank_score: number | null;
  address_city: string | null;
  address_state: string | null;
};

export type ProNode = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  slug: string | null;
  primary_org_id: string | null;
  claimed: boolean | null;
  search_rank_score: number | null;
  job_title: string | null;
};

// The organization / professional select lists live in surface-api/sales/queries/accounts.py.

export type AccountSummary = {
  account: OrgNode;
  orgCount: number;
  regionCount: number;
  branchCount: number;
  userCount: number;
  publishedCount: number;
  discoveredCount: number | null;
  mrr: number | null;
  contractStatus: string | null;
  mismatches: number;
};

/** All root organizations are accounts; everything under them is hierarchy. */
export async function loadAccounts(): Promise<AccountSummary[]> {
  // orgs and pros are cut to 1000 rows each, as PostgREST cut the old limit(5000) (follow-up 1j);
  // the contracts come back [] on error, as before
  const { orgs, pros, contracts } = await api.get<{
    orgs: OrgNode[];
    pros: ProNode[];
    contracts: ListContract[];
  }>(`${ACCOUNTS}/list-rows`);

  const childrenOf = new Map<string, OrgNode[]>();
  orgs.forEach((o) => {
    if (!o.parent_org_id) return;
    const list = childrenOf.get(o.parent_org_id) ?? [];
    list.push(o);
    childrenOf.set(o.parent_org_id, list);
  });
  const prosOf = new Map<string, ProNode[]>();
  pros.forEach((p) => {
    if (!p.primary_org_id) return;
    const list = prosOf.get(p.primary_org_id) ?? [];
    list.push(p);
    prosOf.set(p.primary_org_id, list);
  });

  const roots = orgs.filter((o) => !o.parent_org_id);

  const discovered = roots.length ? await discoveredCounts(roots.map((r) => r.name)) : [];

  return roots.map((root, i) => {
    const descendants: OrgNode[] = [];
    const walk = (id: string) => {
      (childrenOf.get(id) ?? []).forEach((c) => {
        descendants.push(c);
        walk(c.id);
      });
    };
    walk(root.id);

    const users = [root, ...descendants].flatMap((o) => prosOf.get(o.id) ?? []);
    const contract =
      contracts.find((c) => c.account_id === root.id) ??
      contracts.find((c) => c.org_id === root.id) ??
      null;

    return {
      account: root,
      orgCount: descendants.length + 1,
      regionCount: descendants.filter((d) => (d.hierarchy_depth ?? 0) === 1).length,
      branchCount: descendants.filter((d) => (d.hierarchy_depth ?? 0) >= 2).length,
      userCount: users.length,
      publishedCount:
        descendants.filter((d) => d.is_active).length + (root.is_active ? 1 : 0),
      discoveredCount: discovered[i],
      mrr: contract?.mrr != null ? Number(contract.mrr) : null,
      contractStatus: contract?.status ?? null,
      mismatches: 0,
    };
  });
}

export type AccountTreeNode = {
  org: OrgNode;
  children: AccountTreeNode[];
  pros: ProNode[];
};

export async function loadAccount(accountId: string) {
  // as in loadAccounts: orgs and pros cut to 1000 rows each (follow-up 1j)
  const { orgs, pros, contracts: allContracts } = await api.get<{
    orgs: OrgNode[];
    pros: ProNode[];
    contracts: TreeContract[];
  }>(`${ACCOUNTS}/tree-rows`);
  const account = orgs.find((o) => o.id === accountId);
  if (!account) return null;

  const build = (org: OrgNode): AccountTreeNode => ({
    org,
    pros: pros.filter((p) => p.primary_org_id === org.id),
    children: orgs
      .filter((o) => o.parent_org_id === org.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(build),
  });

  const tree = build(account);

  const flatten = (n: AccountTreeNode): AccountTreeNode[] => [
    n,
    ...n.children.flatMap(flatten),
  ];
  const all = flatten(tree);

  const [discovered] = await discoveredCounts([account.name]);

  const contracts = allContracts.filter(
    (c) => c.account_id === accountId || c.org_id === accountId,
  );

  return {
    account,
    tree,
    orgCount: all.length,
    userCount: all.reduce((s, n) => s + n.pros.length, 0),
    discoveredCount: discovered ?? null,
    contracts,
  };
}

export type EntitlementState = "not_entitled" | "entitled_unconfigured" | "active";

export async function loadEntitlements(accountId: string) {
  const { products, entitlements } = await api.get<{
    products: Tables<"exp_products">[];
    entitlements: EntitlementRow[];
  }>(`${ACCOUNTS}/${enc(accountId)}/entitlements`);
  const byKey = new Map(entitlements.map((e) => [e.product_key, e]));
  return products.map((p) => ({
    product: p,
    entitlement: byKey.get(p.product_key) ?? null,
    state: (byKey.get(p.product_key)?.state ?? "not_entitled") as EntitlementState,
  }));
}

export async function setEntitlement(
  accountId: string,
  productKey: string,
  state: EntitlementState,
  tokens?: number,
) {
  // upsert on (subject_type "organization", subject_id, product_key), source "console"
  await api.put(`${ACCOUNTS}/${enc(accountId)}/entitlements/${enc(productKey)}`, {
    state,
    ...(tokens != null ? { tokens_included: tokens } : {}),
  });
}

/**
 * Records who logged in as which node. Session switch itself is not wired yet.
 * The server takes actor_email from the signed-in user's token; `actorEmail` (every caller passed
 * the signed-in user's email) is kept in the signature and not sent.
 */
export async function recordLoginAs(args: {
  actorEmail: string | null;
  nodeType: "organization" | "professional";
  nodeId: string;
  nodeName: string;
  accountId: string;
}) {
  await api.post(`${ACCOUNTS}/login-as`, {
    node_type: args.nodeType,
    node_id: args.nodeId,
    node_name: args.nodeName,
    account_id: args.accountId,
  });
}
