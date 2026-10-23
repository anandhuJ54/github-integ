import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerContext, HandlerRegistry } from "@/lib/nora-runner";
import { sumCosts } from "./costs";
import { fetchSite, hop2, ownedUrls, type CrawlMethod } from "./fetch-site";
import { gbpLookup } from "./gbp";
import { webSweep } from "./web-sweep";
import type { CandidateFacts, ProviderCost } from "./types";

/*
 * Capability handlers for interview step 2 "organize the internet" (source layer), keyed by
 * exp_capability_registry keys:
 *   page_fetch   → fetchSite(url)              (Oxylabs via scrapeWebsite; cost declared)
 *   source_crawl → hop2(owned candidates)      (one hop, same fetch + parse)
 *   serp_fetch   → webSweep(category, name, geo) (Oxylabs google_search; stub when unconfigured)
 *   geocode      → gbpLookup(name, address)    (Google Places; stub until PR #50 is live)
 *
 * All are read-only toward our DB (the only DB read is gbp_categories.display_name) and the
 * registry lists none with side effects, so the runner's dry-run rule (read-only AND no
 * registry side effects → may run) lets them fetch in a dry run. Every output carries
 * telemetry: { costs, total_est_cost_usd } and the run mode.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const crawl = (v: unknown): CrawlMethod | undefined =>
  v === "server_crawl" || v === "needs_proxy" || v === "needs_js_api" || v === "direct" ? v : undefined;

/** CandidateFacts from earlier capabilities in this run (page_fetch first, then hop2 pages). */
function priorFacts(prior: Record<string, unknown>): CandidateFacts[] {
  const out: CandidateFacts[] = [];
  const pf = (prior["page_fetch"] as { facts?: CandidateFacts | null } | undefined)?.facts;
  if (pf) out.push(pf);
  const pages = (prior["source_crawl"] as { pages?: { facts?: CandidateFacts | null }[] } | undefined)?.pages;
  for (const p of pages ?? []) if (p.facts) out.push(p.facts);
  return out;
}

const telemetry = (ctx: HandlerContext, costs: ProviderCost[]) => ({ mode: ctx.mode, ...sumCosts(costs) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function organizeHandlers(db: SupabaseClient<any>): HandlerRegistry {
  return {
    page_fetch: {
      readOnly: true,
      async run(ctx) {
        const url = str(ctx.inputs["url"]) ?? str(ctx.inputs["site_url"]);
        if (!url) throw new Error("page_fetch needs inputs.url");
        const r = await fetchSite(url, {
          crawlMethod: crawl(ctx.inputs["crawl_method"]),
          entityName: ctx.entity?.name ?? str(ctx.inputs["entity_name"]),
        });
        return {
          outputs: {
            url,
            ok: r.ok,
            status_code: r.status_code,
            rendered: r.rendered,
            error: r.error,
            facts: r.facts,
            telemetry: telemetry(ctx, [r.cost]),
          },
        };
      },
    },

    source_crawl: {
      readOnly: true,
      async run(ctx) {
        const given = ownedUrls(ctx.inputs["owned_candidates"]);
        const fromPrior = priorFacts(ctx.prior).flatMap((f) => f.links.ownedCandidates.map((o) => o.url));
        const candidates = given.length ? given : fromPrior;
        const r = await hop2(candidates, {
          crawlMethod: crawl(ctx.inputs["crawl_method"]),
          entityName: ctx.entity?.name ?? str(ctx.inputs["entity_name"]),
        });
        return {
          outputs: {
            followed: r.pages.length,
            skipped: r.skipped,
            pages: r.pages.map(({ cost: _c, ...p }) => p),
            telemetry: telemetry(ctx, r.pages.map((p) => p.cost)),
          },
        };
      },
    },

    serp_fetch: {
      readOnly: true,
      async run(ctx) {
        const facts = priorFacts(ctx.prior);
        const entityName = str(ctx.inputs["entity_name"]) ?? ctx.entity?.name ?? facts[0]?.nap.name ?? null;
        if (!entityName) throw new Error("serp_fetch needs an entity name");
        let categoryName = str(ctx.inputs["category_name"]);
        if (!categoryName && ctx.entity?.gcid) {
          const { data } = await db
            .from("gbp_categories")
            .select("display_name")
            .eq("gcid", ctx.entity.gcid)
            .maybeSingle();
          categoryName = str((data as { display_name?: unknown } | null)?.display_name);
        }
        const nap = facts[0]?.nap;
        const geo =
          str(ctx.inputs["geo"]) ??
          ctx.entity?.market ??
          ([nap?.address?.addressLocality, nap?.address?.addressRegion].filter(Boolean).join(", ") || null);
        const r = await webSweep({
          categoryName,
          entityName,
          geo,
          siteUrl: str(ctx.inputs["url"]) ?? facts[0]?.source_url ?? null,
          phone: nap?.phone ?? null,
          knownUrls: facts.flatMap((f) => [f.source_url, ...f.sameAs.map((s) => s.url), ...f.links.ownedCandidates.map((o) => o.url)]),
        });
        if (!r.ok) return { outputs: { ...r, telemetry: telemetry(ctx, []) } };
        const { cost, ...data } = r.data;
        return { outputs: { status: "live", ...data, telemetry: telemetry(ctx, [cost]) } };
      },
    },

    geocode: {
      readOnly: true,
      async run(ctx) {
        const facts = priorFacts(ctx.prior);
        const nap = facts.find((f) => f.nap.name)?.nap;
        const name = str(ctx.inputs["entity_name"]) ?? ctx.entity?.name ?? nap?.name ?? null;
        if (!name) throw new Error("geocode needs an entity name");
        const r = await gbpLookup({
          name,
          address: str(ctx.inputs["address"]) ?? nap?.address?.text ?? null,
          phone: str(ctx.inputs["phone"]) ?? nap?.phone ?? null,
          placeId: str(ctx.inputs["place_id"]) ?? facts.find((f) => f.place_id)?.place_id ?? null,
        });
        if (!r.ok) return { outputs: { ...r, telemetry: telemetry(ctx, []) } };
        const { cost, ...data } = r.data;
        return { outputs: { status: "live", ...data, telemetry: telemetry(ctx, [cost]) } };
      },
    },
  };
}
