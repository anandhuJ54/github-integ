import { supabase } from "@v3/ui/integrations/supabase/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Untyped handle: dynamic embed aliases/filters would explode supabase-js select-string type parsing.
export const db = supabase as any;

export const PAGE_SIZE = 50;
export const REL_TYPES = [
  "WORKS_AT",
  "REPRESENTS",
  "OPERATES_UNDER",
  "FRANCHISE_OF",
  "CLASSIFIED_AS",
  "BASED_AT",
  "MEMBER_OF",
  "SERVES_AREA",
] as const;

export type HierFilters = {
  gcid?: string;
  source?: string;
  brand?: string;
  office?: string;
  type?: string;
  claim?: string;
  q?: string;
};

export type EntityRow = {
  entity_id: string;
  entity_type: string | null;
  display_name: string | null;
  confidence: number | null;
  claim_state: string | null;
  source: string | null;
  status: string | null;
  created_at: string | null;
};

export const ENTITY_COLS =
  "entity_id, entity_type, display_name, confidence, claim_state, source, status, created_at";

const SUBJ = "exp_rel!exp_rel_subject_entity_id_fkey";

/** Builds the select string (embeds needed for filters) and applies every filter server-side. */
export function entityQuery(
  f: HierFilters,
  opts: { cols?: string; head?: boolean; typeOverride?: string | null } = {},
) {
  const embeds: string[] = [];
  if (f.gcid) embeds.push(`cls:${SUBJ}!inner(object_gcid)`);
  if (f.brand) embeds.push(`br:${SUBJ}(object_entity_id)`);
  if (f.office) embeds.push(`of:${SUBJ}!inner(object_entity_id)`);
  const sel = [opts.cols ?? ENTITY_COLS, ...embeds].join(", ");
  let q = db
    .from("exp_entity")
    .select(sel, { count: "exact", head: !!opts.head })
    .neq("status", "merged")
    .eq("is_demo", false);
  if (f.gcid)
    q = q
      .eq("cls.relationship_type", "CLASSIFIED_AS")
      .eq("cls.status", "current")
      .eq("cls.object_gcid", f.gcid);
  if (f.brand)
    q = q
      .in("br.relationship_type", ["OPERATES_UNDER", "REPRESENTS"])
      .eq("br.status", "current")
      .eq("br.object_entity_id", f.brand)
      .or(`entity_id.eq.${f.brand},br.not.is.null`);
  if (f.office)
    q = q
      .eq("of.relationship_type", "WORKS_AT")
      .eq("of.status", "current")
      .eq("of.object_entity_id", f.office);
  if (f.source) q = q.eq("source", f.source);
  const type = opts.typeOverride !== undefined ? opts.typeOverride : f.type;
  if (type) q = q.eq("entity_type", type);
  if (f.claim) q = q.eq("claim_state", f.claim);
  if (f.q) q = q.ilike("display_name", `%${f.q.replace(/[%_,()]/g, " ")}%`);
  return q;
}

export async function incomingCount(objectId: string, relType: string): Promise<number> {
  const { count, error } = await db
    .from("exp_rel")
    .select("subject_entity_id", { count: "exact", head: true })
    .eq("object_entity_id", objectId)
    .eq("relationship_type", relType)
    .eq("status", "current");
  if (error) throw error;
  return count ?? 0;
}

export async function gcidLabels(gcids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(gcids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await db
    .from("gbp_categories")
    .select("gcid, display_name")
    .in("gcid", uniq)
    .limit(uniq.length);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r: any) => [r.gcid, r.display_name]));
}

export function decodeEntities(s: string | null | undefined): string {
  if (!s) return "";
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return named[code.toLowerCase()] ?? m;
  });
}

export function sourceLabel(src: string | null | undefined): string {
  if (!src) return "—";
  return src.startsWith("etl:") ? src.slice(4) : src;
}

export const TYPE_LABEL: Record<string, string> = {
  brand: "Brand",
  location: "Office",
  professional: "Advisor",
  team: "Team",
};

export const TYPE_STYLES: Record<string, string> = {
  brand: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  location: "bg-emerald-50 text-emerald-700",
  professional: "bg-amber-50 text-amber-800",
  team: "bg-teal-50 text-teal-700",
};

export function fmtDate(s: string | null | undefined) {
  return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}
