/** Publisher catalog — read side.
 *  Source of truth: exp_listings_publishers + exp_listings_field_map (migration 0026).
 *  `buildCatalogs` is pure (tested); `fetchCatalogs` does the two selects and returns
 *  null when the 0026 columns/rows are not there yet, so the caller can fall back to the
 *  deprecated constants in ./catalog.fallback. */
import type { MapRow, PublisherCatalog, RowStatus, Section } from "./catalog.fallback";

/** field_map rows seeded from the listings-tab constants carry this tag; the 30 earlier
 *  Google rows are tagged 'legacy_2026_07_09' and are not rendered. */
export const CATALOG_VERSION = "listings_tab_2026_07";

export type ChannelRole = "direct" | "distribution" | "verify_only" | "hub" | "candidate";
export type RoleStatus = "proposed" | "ruled";

export interface PublisherDbRow {
  id: string;
  name: string;
  kind: string;
  subtitle: string | null;
  publishes_to: string | null;
  ops_notes: unknown;
  display_sort: number | null;
  channel_role: string | null;
  role_status: string | null;
}

export interface FieldMapDbRow {
  publisher_id: string | null;
  section: string;
  section_note: string | null;
  their_field: string;
  our_target: string;
  rules: string | null;
  applicability: string;
  status_default: string;
  variant_family: string | null;
  sort: number;
}

const STATUSES: RowStatus[] = ["mapped", "missing_ours", "na", "pipeline"];
export function normalizeStatus(s: string): RowStatus {
  if (s === "n/a") return "na";
  return (STATUSES as string[]).includes(s) ? (s as RowStatus) : "na";
}

/** Group field_map rows into the Section[] shape the PublisherCard renders. Section order =
 *  first appearance by `sort`; note/applicability come from the section's first row. */
export function buildSections(rows: FieldMapDbRow[]): Section[] {
  const out: Section[] = [];
  const byTitle = new Map<string, Section>();
  for (const r of [...rows].sort((a, b) => a.sort - b.sort)) {
    let sec = byTitle.get(r.section);
    if (!sec) {
      sec = { title: r.section, rows: [] };
      if (r.section_note) sec.note = r.section_note;
      if (r.applicability && r.applicability !== "base") sec.applicability = r.applicability;
      byTitle.set(r.section, sec);
      out.push(sec);
    }
    const row: MapRow = {
      their: r.their_field,
      ours: r.our_target,
      rules: r.rules ?? "",
      status: normalizeStatus(r.status_default),
    };
    if (r.variant_family) row.family = r.variant_family;
    sec.rows.push(row);
  }
  return out;
}

/** Returns null when nothing renderable is in the DB (migration not applied). */
export function buildCatalogs(
  pubs: PublisherDbRow[],
  rows: FieldMapDbRow[],
): PublisherCatalog[] | null {
  const ordered = pubs
    .filter((p) => p.display_sort !== null)
    .sort((a, b) => (a.display_sort ?? 0) - (b.display_sort ?? 0));
  if (!ordered.length) return null;
  const cats = ordered.map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: p.subtitle ?? "",
    kind: p.kind,
    publishesTo: p.publishes_to ?? "",
    opsNotes: Array.isArray(p.ops_notes) ? (p.ops_notes as unknown[]).map(String) : [],
    sections: buildSections(rows.filter((r) => r.publisher_id === p.id)),
  }));
  return cats.some((c) => c.sections.length) ? cats : null;
}

// Structural (untyped) handle: the 0026 columns are not in the generated supabase types until
// the migration is applied and types are regenerated; also keeps this module client-agnostic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Selectable = { from: (table: string) => any };

export async function fetchCatalogs(client: Selectable): Promise<PublisherCatalog[] | null> {
  const [p, f] = await Promise.all([
    client
      .from("exp_listings_publishers")
      .select("id,name,kind,subtitle,publishes_to,ops_notes,display_sort,channel_role,role_status"),
    client
      .from("exp_listings_field_map")
      .select(
        "publisher_id,section,section_note,their_field,our_target,rules,applicability,status_default,variant_family,sort",
      )
      .eq("catalog_version", CATALOG_VERSION),
  ]);
  // A missing column (0026 unapplied) surfaces as an error → fall back.
  if (p.error || f.error || !p.data || !f.data) return null;
  return buildCatalogs(p.data as PublisherDbRow[], f.data as FieldMapDbRow[]);
}
