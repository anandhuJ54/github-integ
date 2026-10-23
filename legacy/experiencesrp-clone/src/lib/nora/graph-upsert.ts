import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposedNode } from "@/lib/nora/extract/types";

/*
 * Client side of the governed graph write. All writes go through the DB function
 * exp_graph_upsert_nodes (drizzle/migrations/0022_graph_upsert.sql): it checks the
 * caller, is idempotent on (entity, registry node or node_type, value hash), never
 * lowers trust, and is the only path allowed to change owner-confirmed facts.
 */

export const TRUST_TIERS = [
  "self_declared",
  "imported",
  "platform_observed",
  "authority_verified",
  "owner_verified",
] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const GRAPH_SOURCES = [
  "oauth",
  "etl",
  "crm_sync",
  "api",
  "manual",
  "rss",
  "platform",
  "user",
] as const;
export type GraphSource = (typeof GRAPH_SOURCES)[number];

export type UpsertResult = {
  inserted: number;
  updated: number;
  kept: number;
  skipped: number;
  ids: string[];
  trust_tier: TrustTier;
  source: GraphSource;
};

/** ProposedNode[] → the jsonb array exp_graph_upsert_nodes reads. */
export function toUpsertPayload(nodes: ProposedNode[], gcid: string | null) {
  return nodes.map((n) => ({
    value: n.value,
    title: n.title,
    node_type: n.node_type,
    schema_property: n.schema_property,
    ring: n.ring,
    registry_node_id: n.registry_node_id,
    registry_node_slug: n.registry_node_slug,
    gcid,
    source_url: n.source_url,
    fetched_at: n.fetched_at,
    extracted_data: n.extracted_data,
    evidence: n.evidence,
    confidence: n.confidence,
    method: n.method,
  }));
}

export async function upsertGraphNodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  args: {
    entityType: "professional" | "organization";
    entityId: string;
    nodes: ProposedNode[];
    gcid: string | null;
    source: GraphSource;
    trust: TrustTier;
  },
): Promise<UpsertResult> {
  if (!TRUST_TIERS.includes(args.trust)) throw new Error(`unknown trust tier ${args.trust}`);
  if (!GRAPH_SOURCES.includes(args.source)) throw new Error(`unknown source ${args.source}`);
  const { data, error } = await db.rpc("exp_graph_upsert_nodes", {
    p_entity_type: args.entityType,
    p_entity_id: args.entityId,
    p_nodes: toUpsertPayload(args.nodes, args.gcid),
    p_source: args.source,
    p_trust: args.trust,
  });
  if (error) throw new Error(error.message);
  return data as UpsertResult;
}
