import { supabase } from "@v3/ui/integrations/supabase/client";

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

const ORG_COLS =
  "id,name,slug,entity_type,parent_org_id,hierarchy_depth,is_active,claimed,search_rank_score,address_city,address_state";
const PRO_COLS =
  "id,display_name,first_name,last_name,slug,primary_org_id,claimed,search_rank_score,job_title";

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
  const [orgsRes, prosRes, contractsRes] = await Promise.all([
    supabase.from("organizations").select(ORG_COLS).limit(5000),
    supabase.from("professionals").select(PRO_COLS).limit(5000),
    supabase.from("exp_contracts").select("account_id,org_id,status,mrr"),
  ]);
  if (orgsRes.error) throw orgsRes.error;
  if (prosRes.error) throw prosRes.error;

  const orgs = (orgsRes.data ?? []) as OrgNode[];
  const pros = (prosRes.data ?? []) as ProNode[];
  const contracts = contractsRes.data ?? [];

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

  const discovered = await Promise.all(
    roots.map(async (r) => {
      const { count } = await supabase
        .from("exp_entity")
        .select("*", { count: "exact", head: true })
        .ilike("display_name", `%${r.name}%`);
      return count ?? null;
    }),
  );

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
  const [orgsRes, prosRes, contractsRes] = await Promise.all([
    supabase.from("organizations").select(ORG_COLS).limit(5000),
    supabase.from("professionals").select(PRO_COLS).limit(5000),
    supabase.from("exp_contracts").select("id,name,account_id,org_id,status,mrr,token_package,start_date"),
  ]);
  if (orgsRes.error) throw orgsRes.error;
  if (prosRes.error) throw prosRes.error;

  const orgs = (orgsRes.data ?? []) as OrgNode[];
  const pros = (prosRes.data ?? []) as ProNode[];
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

  const { count: discovered } = await supabase
    .from("exp_entity")
    .select("*", { count: "exact", head: true })
    .ilike("display_name", `%${account.name}%`);

  const contracts = (contractsRes.data ?? []).filter(
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
  const [productsRes, entRes] = await Promise.all([
    supabase.from("exp_products").select("*").eq("active", true).order("sort"),
    supabase
      .from("exp_entitlements")
      .select("id,product_key,state,tokens_included,source,granted_at")
      .eq("subject_type", "organization")
      .eq("subject_id", accountId),
  ]);
  if (productsRes.error) throw productsRes.error;
  if (entRes.error) throw entRes.error;
  const byKey = new Map((entRes.data ?? []).map((e) => [e.product_key, e]));
  return (productsRes.data ?? []).map((p) => ({
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
  const { error } = await supabase.from("exp_entitlements").upsert(
    {
      subject_type: "organization",
      subject_id: accountId,
      product_key: productKey,
      state,
      source: "console",
      ...(tokens != null ? { tokens_included: tokens } : {}),
    },
    { onConflict: "subject_type,subject_id,product_key" },
  );
  if (error) throw error;
}

/** Records who logged in as which node. Session switch itself is not wired yet. */
export async function recordLoginAs(args: {
  actorEmail: string | null;
  nodeType: "organization" | "professional";
  nodeId: string;
  nodeName: string;
  accountId: string;
}) {
  const { error } = await supabase.from("audit_log").insert({
    action: "login_as",
    entity_type: args.nodeType,
    entity_id: args.nodeId,
    field_changes: {
      actor_email: args.actorEmail,
      target_name: args.nodeName,
      account_id: args.accountId,
    },
  });
  if (error) throw error;
}
