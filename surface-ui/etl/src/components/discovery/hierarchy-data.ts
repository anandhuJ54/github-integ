import { api } from "@v3/state/api/server-fn";

/* Hierarchy reads go through /etl/console/hierarchy/* (surface-api/etl/queries/hierarchy.py),
   which rebuilds the PostgREST embed filters this file used to send. */

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


export async function gcidLabels(gcids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(gcids.filter(Boolean))];
  if (!uniq.length) return {};
  return api.post<Record<string, string>>("/etl/console/hierarchy/category-labels", { gcids: uniq });
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
