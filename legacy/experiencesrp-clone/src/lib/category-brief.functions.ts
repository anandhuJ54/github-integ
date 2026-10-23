import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  compileCategoryBrief,
  type CategoryBrief,
  type CategoryBriefRows,
} from "@/lib/category-brief";

/* Server loader for the category brief — reads the category's rows and hands
   them to the pure compiler in category-brief.ts. gcid is used verbatim. */

const Input = z.object({ gcid: z.string().min(1) });

const VOCAB_LEVELS = [
  "product_service",
  "specialization",
  "profession_title",
  "alias",
  "industry_term",
];

const NODE_COLUMNS =
  "id, node_slug, node_name, ring, entity_scope, node_class, connection_method, schema_type, schema_property, required_for_score, score_points, priority, counts_toward_m, owns_lane, requires_verification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** PostgREST caps responses (1000 rows); page through until exhausted. */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

export async function loadCategoryBriefRows(db: Db, gcid: string): Promise<CategoryBriefRows> {
  const one = (table: string, cols: string) =>
    db.from(table).select(cols).eq("gcid", gcid).maybeSingle();
  const [
    category,
    shape,
    profileConfig,
    completeness,
    schemaTypes,
    compliance,
    ear,
    eaa,
    eaq,
    eav,
    rings,
  ] = await Promise.all([
    one("gbp_categories", "gcid, display_name, slug, entity_type, status"),
    one(
      "exp_category_shape",
      "gcid, shape, allowed_entity_types, required_entity_types, claimable_types, monetizable_types, teams_allowed, multi_affiliation_allowed, identity_keys, allowed_relationships",
    ),
    one(
      "exp_category_profile_config",
      "gcid, entity_noun, service_label, credential_label, credential_id_label, cta_label, schema_type, show_prequalify",
    ),
    one("exp_category_completeness", "total_node_types, core_node_types, expected_m"),
    db.from("exp_category_schema_type").select("schema_type, confidence, rule").eq("gcid", gcid),
    one(
      "exp_category_compliance",
      "license_label, required_disclaimers, content_restrictions, prohibited_phrases, required_disclosures, regulated_by, hipaa_applies, glba_applies, coppa_applies, ferpa_applies, age_gate_required, age_gate_minimum, review_verification_required, review_transaction_required, compliance_notes",
    ),
    one("exp_category_ear", "ear, ear_professional, band, non_reviewable"),
    one("exp_category_eaa", "eaa, eaa_professional, band, non_authored"),
    one("exp_category_eaq", "eaq, eaq_professional, band, non_qa"),
    one("exp_category_eav", "eav, eav_professional, band, non_video"),
    db
      .from("exp_rings")
      .select("position, ring_key, ring_name, schema_properties")
      .order("position"),
  ]);

  const [nodes, taxonomy] = await Promise.all([
    selectAll((from, to) =>
      db
        .from("exp_vertical_node_registry")
        .select(NODE_COLUMNS)
        .eq("gcid", gcid)
        .eq("is_active", true)
        .order("node_slug")
        .range(from, to),
    ),
    selectAll((from, to) =>
      db
        .from("exp_taxonomy")
        .select("level, term, term_display, entity_scope, schema_property, is_required, priority")
        .eq("gcid", gcid)
        .eq("is_active", true)
        .in("level", VOCAB_LEVELS)
        .order("level")
        .order("priority")
        .order("term")
        .range(from, to),
    ),
  ]);

  return {
    gcid,
    category: category.data,
    shape: shape.data,
    profileConfig: profileConfig.data,
    nodes,
    taxonomy,
    completeness: completeness.data,
    schemaTypes: schemaTypes.data,
    compliance: compliance.data,
    ear: ear.data,
    eaa: eaa.data,
    eaq: eaq.data,
    eav: eav.data,
    rings: rings.data,
  } as CategoryBriefRows;
}

export const getCategoryBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<CategoryBrief> => {
    const { supabase } = context as { supabase: Db };
    return compileCategoryBrief(await loadCategoryBriefRows(supabase, data.gcid));
  });
