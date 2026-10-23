import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerRegistry } from "@/lib/nora-runner";
import { claimCapabilityHandlers } from "@/lib/nora/claim-capabilities.server";
import { compileCategoryBrief } from "@/lib/category-brief";
import { loadCategoryBriefRows } from "@/lib/category-brief.functions";
import { extractFacts, graphEntityType, type CandidateFacts } from "@/lib/nora/extract";
import type { ExtractResult, ProposedNode } from "@/lib/nora/extract/types";
import { haikuExtractor } from "@/lib/nora/extract/haiku.server";
import {
  GRAPH_SOURCES,
  TRUST_TIERS,
  upsertGraphNodes,
  type GraphSource,
  type TrustTier,
} from "@/lib/nora/graph-upsert";
import { organizeHandlers } from "@/lib/nora/organize/handlers";

/*
 * Capability implementations — exp_capability_registry.key → handler.
 *
 * Only capabilities with a real implementation appear here. Anything absent makes the
 * runner return verdict "not_implemented"; nothing is ever faked. Handlers receive the
 * caller's RLS-scoped Supabase client and must declare readOnly honestly: the runner
 * only calls read-only handlers in a dry run (and double-checks the registry's
 * side_effects).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_CAP = 5000;
const COMPSET_CAP = 25;

type SrsPeer = {
  entity_id: string;
  entity_type: string;
  gcid: string | null;
  local_market: string | null;
  total_score: number | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capabilityHandlers(db: SupabaseClient<any>): HandlerRegistry {
  return {
    /** Claim gate (src/lib/nora/claim-capabilities.server.ts). */
    ...claimCapabilityHandlers(db),
    // Interview step 2 "organize the internet" — source layer (page_fetch, source_crawl, serp_fetch, geocode).
    ...organizeHandlers(db),

    /** Read the entity's expertise-graph footprint from graph_nodes (by ring, verified, active). */
    graph_query: {
      readOnly: true,
      async run({ entity }) {
        if (!entity || !UUID.test(entity.ref))
          throw new Error("graph_query needs a uuid entity reference");
        let q = db
          .from("graph_nodes")
          .select("ring,ring_key,node_type,verified,is_active,score_counted")
          .eq("entity_id", entity.ref)
          .limit(NODE_CAP);
        if (entity.type) q = q.eq("entity_type", entity.type);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as {
          ring: number | null;
          ring_key: string | null;
          verified: boolean | null;
          is_active: boolean | null;
          score_counted: boolean | null;
        }[];
        const by_ring: Record<string, number> = {};
        for (const r of rows) {
          const k = r.ring_key ?? (r.ring != null ? `ring_${r.ring}` : "unassigned");
          by_ring[k] = (by_ring[k] ?? 0) + 1;
        }
        return {
          outputs: {
            nodes: rows.length,
            truncated: rows.length >= NODE_CAP,
            active: rows.filter((r) => r.is_active !== false).length,
            verified: rows.filter((r) => r.verified).length,
            score_counted: rows.filter((r) => r.score_counted).length,
            by_ring,
          },
        };
      },
    },

    /** Competitive set from search_rank_scores: same gcid (and market when known), ranked. */
    compset_query: {
      readOnly: true,
      async run({ entity }) {
        if (!entity || !UUID.test(entity.ref))
          throw new Error("compset_query needs a uuid entity reference");
        const self = await db
          .from("search_rank_scores")
          .select("entity_id,entity_type,gcid,local_market,total_score")
          .eq("entity_id", entity.ref)
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (self.error) throw new Error(self.error.message);
        const me = self.data as SrsPeer | null;
        if (!me) return { outputs: { scored: false, reason: "entity has no Search Rank Score" } };
        if (!me.gcid)
          return { outputs: { scored: true, reason: "entity has no gcid — no category set" } };
        let q = db
          .from("search_rank_scores")
          .select("entity_id,entity_type,gcid,local_market,total_score")
          .eq("gcid", me.gcid)
          .order("total_score", { ascending: false })
          .limit(COMPSET_CAP);
        if (me.local_market) q = q.eq("local_market", me.local_market);
        const peers = await q;
        if (peers.error) throw new Error(peers.error.message);
        const set = (peers.data ?? []) as SrsPeer[];
        if (!set.some((p) => p.entity_id === me.entity_id)) set.push(me);
        set.sort((a, b) => Number(b.total_score ?? 0) - Number(a.total_score ?? 0));
        const ids = set.map((p) => p.entity_id);
        const names = new Map<string, string>();
        const nm = await db
          .from("exp_entity")
          .select("entity_id,display_name")
          .in("entity_id", ids);
        for (const r of (nm.data ?? []) as { entity_id: string; display_name: string | null }[])
          if (r.display_name) names.set(String(r.entity_id), r.display_name);
        const idx = set.findIndex((p) => p.entity_id === me.entity_id);
        const view = (p: SrsPeer | undefined) =>
          p
            ? {
                entity_id: p.entity_id,
                entity_type: p.entity_type,
                name: names.get(p.entity_id) ?? null,
                total_score: p.total_score,
              }
            : null;
        const leader = set[0];
        return {
          outputs: {
            scored: true,
            scope: { gcid: me.gcid, market: me.local_market },
            set_size: set.length,
            truncated: (peers.data ?? []).length >= COMPSET_CAP,
            rank: idx + 1,
            score: me.total_score,
            leader: view(leader),
            gap_to_leader: Number(leader?.total_score ?? 0) - Number(me.total_score ?? 0),
            next_above: view(idx > 0 ? set[idx - 1] : undefined),
            competitors: set.filter((p) => p.entity_id !== me.entity_id).map(view),
          },
        };
      },
    },

    /**
     * Category-aware extraction: organize-step pages → ProposedNode[] + conflicts,
     * driven by the category brief. Read-only. Dry run is deterministic only (no
     * model call); live adds one Haiku call per page for unfilled collections.
     */
    nlp_extract: {
      readOnly: true,
      async run({ mode, entity, inputs, prior }) {
        const gcid = str(inputs.gcid) ?? entity?.gcid ?? null;
        if (!gcid) throw new Error("nlp_extract needs a gcid (inputs.gcid or entity.gcid)");
        const pages = pagesFrom(inputs, prior);
        if (!pages.length) throw new Error("nlp_extract needs organized pages (inputs.pages)");
        const brief = compileCategoryBrief(await loadCategoryBriefRows(db, gcid));
        const entityType = str(inputs.entity_type) ?? entity?.type ?? null;
        const useModel = mode !== "dry_run" && inputs.use_model !== false;
        const result = await extractFacts({
          brief,
          entityType,
          pages,
          llm: useModel && process.env.ANTHROPIC_API_KEY ? haikuExtractor() : null,
        });
        return { outputs: { ...result, model_used: useModel && result.stats.llm_calls > 0 } };
      },
    },

    /**
     * Governed graph write through exp_graph_upsert_nodes (idempotent, never lowers
     * trust, the only path allowed to touch owner facts). Live only. Conflicted
     * single-valued nodes are never written — they wait for the resolve step.
     */
    graph_upsert: {
      readOnly: false,
      async run({ entity, inputs, prior }) {
        if (!entity || !UUID.test(entity.ref))
          throw new Error("graph_upsert needs a uuid entity reference");
        const extracted = prior.nlp_extract as ExtractResult | undefined;
        const nodes = (Array.isArray(inputs.nodes) ? inputs.nodes : (extracted?.nodes ?? [])) as ProposedNode[];
        const trust = (str(inputs.trust) ?? "self_declared") as TrustTier;
        const source = (str(inputs.source) ?? "platform") as GraphSource;
        if (!TRUST_TIERS.includes(trust)) throw new Error(`unknown trust tier ${trust}`);
        if (!GRAPH_SOURCES.includes(source)) throw new Error(`unknown source ${source}`);
        const entityType = graphEntityType(str(inputs.entity_type) ?? entity.type ?? extracted?.entity_type ?? "");
        const result = await upsertGraphNodes(db, {
          entityType,
          entityId: entity.ref,
          nodes,
          gcid: str(inputs.gcid) ?? extracted?.gcid ?? entity.gcid ?? null,
          source,
          trust,
        });
        return {
          outputs: { ...result, held_conflicts: extracted?.conflicts.length ?? 0 },
          graph_writes: result.ids.map((id) => ({ table: "graph_nodes", id, trust, source })),
        };
      },
    },
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Pages come from inputs.pages, else from the organize capabilities earlier in the run
 * (page_fetch → outputs.facts, source_crawl → outputs.pages[].facts).
 */
function pagesFrom(inputs: Record<string, unknown>, prior: Record<string, unknown>): CandidateFacts[] {
  if (Array.isArray(inputs.pages)) return inputs.pages as CandidateFacts[];
  const out: CandidateFacts[] = [];
  const pf = (prior.page_fetch as { facts?: CandidateFacts | null } | undefined)?.facts;
  if (pf) out.push(pf);
  const crawl = (prior.source_crawl as { pages?: { facts?: CandidateFacts | null }[] } | undefined)?.pages;
  for (const p of crawl ?? []) if (p.facts) out.push(p.facts);
  return out;
}

/** Keys with an implementation — usable without a client (governance only needs the keys). */
export const IMPLEMENTED_CAPABILITIES = Object.keys(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  capabilityHandlers(null as unknown as SupabaseClient<any>),
);
