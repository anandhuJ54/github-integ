// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY RELATIONSHIPS — overlap-awareness layer (full corpus).
//
// Google Business Profile categories are NOT a partition: ~43% are "(modifier)
// (head)" specializations whose counts are subsets of a head category, and a few
// families pair across the location/professional lanes. Summing estimates across
// categories therefore double-counts. This resolver makes the structure explicit.
//
// Data is generated deterministically from category names (see
// category-relationships.data.ts): a category is a specialization of the LONGEST
// trailing suffix that is itself a real category (so multi-level chains resolve to
// the direct parent), and no parent is invented when no head category exists.
// ─────────────────────────────────────────────────────────────────────────────

import { PARENT, CHILDREN, LANE, NAMES } from "./category-relationships.data";

export type RelationshipRole = "head" | "specialization" | "lane" | "standalone";

export type CategoryRelationship = {
  role: RelationshipRole;
  parent?: { gcid: string; name: string };
  childrenCount?: number;
  childrenGcids?: string[];
  childrenSample?: string[];
  lanePair?: { gcid: string; name: string };
  laneOwns?: "profiles" | "locations";
  /** one-line badge shown next to the estimate / in the list */
  badge: string;
  /** full explanation shown in the relationships card */
  overlapNote: string;
};

const fullId = (g: string) => (g.startsWith("gcid:") ? g : `gcid:${g}`);

export function getCategoryRelationships(
  gcid: string,
  _displayName?: string,
): CategoryRelationship | null {
  const id = fullId(gcid);
  const parentGcid = PARENT[id];
  const kids = CHILDREN[id];
  const lane = LANE[id];
  if (!parentGcid && !kids && !lane) return null;

  const parent = parentGcid
    ? { gcid: parentGcid, name: NAMES[parentGcid] ?? parentGcid }
    : undefined;
  const childrenCount = kids?.length;
  const lanePair = lane ? { gcid: lane.g, name: NAMES[lane.g] ?? lane.g } : undefined;

  let role: RelationshipRole;
  if (parent) role = "specialization"; // includes intermediates (also parents)
  else if (kids) role = "head";
  else role = "lane";

  let badge: string;
  if (parent) badge = `↳ included in ${parent.name}`;
  else if (kids) badge = `head of ${childrenCount} specialization${childrenCount === 1 ? "" : "s"}`;
  else badge = `lane pair: ${lanePair!.name}`;

  let overlapNote: string;
  if (parent && kids) {
    overlapNote = `Specialization of ${parent.name} (already counted there) and itself the head of ${childrenCount} narrower categories. Don't add this on top of ${parent.name}, and don't add its own specializations on top of it.`;
  } else if (parent) {
    overlapNote = `Specialization of ${parent.name}. These profiles and locations are a subset of ${parent.name} and are already counted there — don't add this category on top of ${parent.name}.`;
  } else if (kids) {
    overlapNote = `Head category. ${childrenCount} specializations are subsets of this category — their profiles and locations are already inside these numbers. Never add the specializations on top.`;
  } else {
    overlapNote = `Lane pair with ${lanePair!.name}. This category canonically owns its ${lane!.owns}; the other count overlaps ${lanePair!.name} and should be counted once there. Count each real-world entity once, in its canonical lane.`;
  }

  return {
    role,
    parent,
    childrenCount,
    childrenGcids: kids,
    lanePair,
    laneOwns: lane?.owns,
    badge,
    overlapNote,
  };
}
