// ============================================================================
// ETL AI cost log (2026-10-22). Every ETL AI call notes its token usage here; the rows are written to
// exp_etl_cost_events once per worker request (one insert), so a failure to log never stops the work.
// The request context (activity, category, site, request, job) is carried with AsyncLocalStorage, so
// overlapping worker calls in the same isolate never mix their rows. Dollars = tokens x the model's list
// price below (USD per million tokens); a model without a price is logged with its tokens, cost 0 and
// detail.unpriced = true, so it can be priced later. The leading dash keeps this file out of the file router.
// ============================================================================
import { AsyncLocalStorage } from 'node:async_hooks';

/** USD per million tokens: input, cache read, cache write, output (moved here from disco-agent-mapper.ts). */
export const PRICES: Record<string, [number, number, number, number]> = {
  // Fix (Sonnet 5 price, 2026-10-22): from platform.claude.com/docs/en/about-claude/pricing (5-minute cache write);
  // Sonnet 5.5 cache read corrected from 0.2 to 0.1 per the same page.
  'claude-sonnet-5': [2.0, 0.2, 2.5, 10.0],
  'claude-sonnet-5-5': [2.0, 0.1, 2.5, 10.0],
  'claude-opus-5-5': [4.0, 0.2, 5.0, 20.0],
  'claude-sonnet-4-6': [3.0, 0.3, 3.75, 15.0],
};

/** The price row for a model id; dated ids ("claude-sonnet-4-6-20260101") use their base name. */
export function priceFor(model: string | null | undefined): [number, number, number, number] | null {
  const m = String(model ?? '');
  if (PRICES[m]) return PRICES[m];
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => m.startsWith(k));
  return key ? PRICES[key] : null;
}

export type AiUsage = {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
} | null | undefined;

type CostRow = {
  activity: string; model: string; calls: number;
  input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number;
  cost_usd: number; gcid: string | null; domain: string | null; request_id: number | null; job_id: number | null;
  detail: Record<string, unknown>; occurred_at: string;
};

export type CostContext = {
  db: any;
  activity: string;
  gcid?: string | null;
  domain?: string | null;
  request_id?: number | null;
  job_id?: number | null;
};
type Store = CostContext & { pending: CostRow[] };

const als = new AsyncLocalStorage<Store>();

/** Tool names whose calls belong to their own activity, whatever request they run in. */
const ACTIVITY_BY_TOOL: Record<string, string> = {
  return_extra_key_matches: 'extra_match',
  define_category_boundary: 'boundary',
};

/** Activity of a worker request by its tool. */
export const ACTIVITY_BY_REQUEST_TOOL: Record<string, string> = {
  discover_companies: 'discovery',
  classify_method: 'method_check',
  map_site: 'map_contract',
};

/** Dollar cost of one usage block, or null when the model has no price. */
export function costOf(model: string, usage: AiUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const u = usage ?? {};
  return ((u.input_tokens ?? 0) * p[0] + (u.cache_read_input_tokens ?? 0) * p[1]
    + (u.cache_creation_input_tokens ?? 0) * p[2] + (u.output_tokens ?? 0) * p[3]) / 1e6;
}

/** Notes one AI call (synchronous; written when the surrounding withCostContext ends). No context: not logged. */
export function noteAiUsage(args: { model: string; usage: AiUsage; tool?: string; activity?: string; step?: string }): void {
  const s = als.getStore();
  if (!s) return;
  try {
    const u = args.usage ?? {};
    const cost = costOf(args.model, u);
    const p = priceFor(args.model);
    s.pending.push({
      activity: args.activity ?? (args.tool ? ACTIVITY_BY_TOOL[args.tool] : undefined) ?? s.activity,
      model: String(args.model || 'unknown'),
      calls: 1,
      input_tokens: Math.round(u.input_tokens ?? 0),
      cache_read_tokens: Math.round(u.cache_read_input_tokens ?? 0),
      cache_write_tokens: Math.round(u.cache_creation_input_tokens ?? 0),
      output_tokens: Math.round(u.output_tokens ?? 0),
      cost_usd: Math.round((cost ?? 0) * 1e6) / 1e6,
      gcid: s.gcid ?? null, domain: s.domain ?? null, request_id: s.request_id ?? null, job_id: s.job_id ?? null,
      detail: {
        ...(args.tool ? { tool: args.tool } : {}),
        ...(args.step ? { step: args.step } : {}),
        ...(p ? { price_per_mtok: { input: p[0], cache_read: p[1], cache_write: p[2], output: p[3] } } : { unpriced: true }),
        ...(args.usage ? {} : { usage_missing: true }),
      },
      occurred_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('ai cost note failed', e);
  }
}

/** Runs fn with a cost context; the AI calls noted inside are written to exp_etl_cost_events at the end (one insert). */
export async function withCostContext<T>(ctx: CostContext, fn: () => Promise<T>): Promise<T> {
  const store: Store = { ...ctx, pending: [] };
  try {
    return await als.run(store, fn);
  } finally {
    if (store.pending.length) {
      try {
        for (let i = 0; i < store.pending.length; i += 200) {
          const { error } = await ctx.db.from('exp_etl_cost_events').insert(store.pending.slice(i, i + 200) as any);
          if (error) console.error('ai cost log insert failed', error.message);
        }
      } catch (e) {
        console.error('ai cost log failed', e);
      }
    }
  }
}
