import { supabase } from "@/integrations/supabase/client";
import {
  loadContracts,
  loadPriceBook,
  loadReps,
  quoteDeal,
  quoteLines,
  type Contract,
  type Rep,
} from "@/lib/sales";
import type { DealMargin } from "@/lib/margin";

/** Contract statuses that count as won for commission purposes. */
export const WON_STATUSES = ["active", "won"];

export type CompPlan = {
  id: string;
  name: string;
  role: string;
  rate_pct: number;
  basis: string;
  active: boolean;
  is_demo: boolean;
  notes: string | null;
};

export async function loadCompPlans(): Promise<CompPlan[]> {
  const { data, error } = await supabase
    .from("exp_comp_plans")
    .select("id,name,role,rate_pct,basis,active,is_demo,notes")
    .order("role");
  if (error) throw error;
  return (data ?? []) as CompPlan[];
}

export async function saveCompRate(id: string, rate_pct: number) {
  const { error } = await supabase.from("exp_comp_plans").update({ rate_pct }).eq("id", id);
  if (error) throw error;
}

export type CompDeal = {
  contract: Contract & { accountName: string };
  deal: DealMargin;
  /** Below floor margin → commission is blocked and pays $0. */
  blocked: boolean;
  approvalState: string;
  commission: number;
  isDemo: boolean;
};

export type RepComp = {
  rep: Rep;
  plan: CompPlan | null;
  ratePct: number;
  basis: string;
  sale: number;
  net: number;
  commission: number;
  blockedNet: number;
  blockedDeals: number;
  deals: CompDeal[];
};

export type CompBook = {
  plans: CompPlan[];
  reps: RepComp[];
  unattributed: CompDeal[];
  totals: { sale: number; net: number; commission: number; blockedNet: number; blockedDeals: number };
};

/** Commission is computed on NET margin. Below-floor deals pay $0. */
export async function loadComp(opts: { includeDemo?: boolean } = {}): Promise<CompBook> {
  const [plans, reps, contracts, book] = await Promise.all([
    loadCompPlans(),
    loadReps(),
    loadContracts(),
    loadPriceBook(),
  ]);

  const won = contracts.contracts.filter(
    (c) => WON_STATUSES.includes(c.status) && (opts.includeDemo ? true : !c.is_demo),
  );

  const priced: CompDeal[] = won.map((c) => {
    const lines = contracts.lineItems.filter((li) => li.contract_id === c.id);
    const quoted = quoteLines(lines, book);
    const deal = quoteDeal(quoted);
    const blocked =
      deal.breachedLines > 0 ||
      (deal.floor != null && deal.marginPct != null && deal.marginPct < deal.floor);
    return {
      contract: c,
      deal,
      blocked,
      approvalState: c.approval_state ?? "not_required",
      commission: 0,
      isDemo: !!c.is_demo,
    };
  });

  const planFor = (role: string) => plans.find((p) => p.role === role && p.active) ?? null;

  const repComp: RepComp[] = reps.map((rep) => {
    const plan = planFor(rep.role);
    const rate = Number(plan?.rate_pct ?? 0);
    const mine = priced
      .filter((d) => d.contract.sold_by === rep.id)
      .map((d) => ({
        ...d,
        commission: d.blocked ? 0 : Math.max(0, d.deal.net) * rate,
      }));
    return {
      rep,
      plan,
      ratePct: rate,
      basis: plan?.basis ?? "net",
      sale: mine.reduce((s, d) => s + d.deal.sale, 0),
      net: mine.reduce((s, d) => s + d.deal.net, 0),
      commission: mine.reduce((s, d) => s + d.commission, 0),
      blockedNet: mine.filter((d) => d.blocked).reduce((s, d) => s + d.deal.net, 0),
      blockedDeals: mine.filter((d) => d.blocked).length,
      deals: mine.sort((a, b) => b.deal.net - a.deal.net),
    };
  });

  const attributed = new Set(reps.map((r) => r.id));
  const unattributed = priced.filter((d) => !d.contract.sold_by || !attributed.has(d.contract.sold_by));

  return {
    plans,
    reps: repComp.sort((a, b) => b.commission - a.commission),
    unattributed,
    totals: {
      sale: repComp.reduce((s, r) => s + r.sale, 0),
      net: repComp.reduce((s, r) => s + r.net, 0),
      commission: repComp.reduce((s, r) => s + r.commission, 0),
      blockedNet: repComp.reduce((s, r) => s + r.blockedNet, 0),
      blockedDeals: repComp.reduce((s, r) => s + r.blockedDeals, 0),
    },
  };
}

/** Per-rep commission map for the quota board. */
export function commissionByRep(book: CompBook) {
  return Object.fromEntries(
    book.reps.map((r) => [
      r.rep.id,
      { commission: r.commission, net: r.net, blockedDeals: r.blockedDeals, blockedNet: r.blockedNet, ratePct: r.ratePct },
    ]),
  ) as Record<
    string,
    { commission: number; net: number; blockedDeals: number; blockedNet: number; ratePct: number }
  >;
}
