/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import { supabase } from "@v3/ui/integrations/supabase/client";
import * as ent from "@v3/xmp/lib/enterprise-xmp";
// moved (surface audit 2026-10-25): the seat, office-mode and interview libs are in srp now
import * as seat from "@v3/srp/lib/seat";
import { loadOfficeMode } from "@v3/srp/lib/office-mode";
import { loadClaimSource, loadInterviewSubject } from "@v3/srp/lib/nora/interview-data";
import { loadTeamCentral } from "@v3/sales/lib/insurance-team";

// xmp enterprise, seat and dashboard pages (all signed in). Reads only: the writes
// (review_campaigns insert/update, invitations insert, professionals update, audit_log inserts)
// are covered by compiled-SQL / fake-connection unit tests, never run here.
// Legacy module paths: where the files lived at PARITY_LEGACY_REF (before the surface audit moves).
const ENT = "surface-ui/xmp/src/lib/enterprise-xmp.ts";
const SEAT = "surface-ui/xmp/src/lib/seat.ts";
const OFFICE_MODE = "surface-ui/xmp/src/lib/office-mode.ts";
const INTERVIEW = "surface-ui/xmp/src/lib/nora/interview-data.ts";
const TEAM = "surface-ui/xmp/src/lib/insurance-team.ts";

const BRAND = "bbbbbbb1-0000-4000-8000-000000000001"; // state-farm
const PRO = "56d35654-1bcd-4ee6-97e3-3571ef61c8f1"; // sf-a9ee009780abff5cc27f, single-pro office
const PRO_OFFICE = "6b253049-8c67-4c7e-8ffc-cf9a5ba5f9c6";
const BIG_OFFICE = "46721d8b-c3f9-4df6-b431-3619c9f0897e"; // compass-new-york-ny-2, 990 pros
const MID_OFFICE = "5a722aa9-c53c-49f5-ad24-657f3ed678ea"; // compass-fort-worth-tx, 150 pros (< 200)
const REVIEWED_OFFICE = "11111111-0000-4000-8000-000000000002"; // bettendorf-1872: reviews + ratings
const AMBER = "22222222-0000-4000-8000-000000000001"; // amber-ernst: score, reviews, terms
const NOBODY = "00000000-0000-4000-8000-00000000dead";
const NOW = new Date("2026-10-24T12:00:00Z");

const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...(rows ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);

const lib = (
  module: string,
  name: string,
  exp: string,
  args: unknown[],
  current: () => Promise<unknown>,
  extra: Partial<ParityCase> = {},
): ParityCase => ({ name, legacyModule: module, legacyExport: exp, legacyArgs: args, current, ...extra });

/* ─── lib/enterprise-xmp.ts ─── */
const enterpriseCases: ParityCase[] = [
  lib(ENT, "enterprise: brand state-farm", "loadBrand", ["state-farm"], () => ent.loadBrand("state-farm")),
  lib(ENT, "enterprise: brand unknown → null", "loadBrand", ["does-not-exist-parity"], () =>
    ent.loadBrand("does-not-exist-parity"),
  ),
  lib(ENT, "enterprise: overview (exp_xmp_brand_overview)", "loadOverview", [BRAND], () => ent.loadOverview(BRAND)),
  lib(ENT, "enterprise: state rollup 60", "loadStateRollup", [BRAND, 60], () => ent.loadStateRollup(BRAND, 60)),
  lib(ENT, "enterprise: state options", "loadStateOptions", [BRAND], () => ent.loadStateOptions(BRAND)),
  lib(ENT, "enterprise: offices page 0", "loadOfficePage", [{ brandId: BRAND, page: 0, pageSize: 25 }], () =>
    ent.loadOfficePage({ brandId: BRAND, page: 0, pageSize: 25 }),
  ),
  lib(
    ENT,
    "enterprise: offices page 2, q + state",
    "loadOfficePage",
    [{ brandId: BRAND, q: "st", state: "TX", page: 2, pageSize: 10 }],
    () => ent.loadOfficePage({ brandId: BRAND, q: "st", state: "TX", page: 2, pageSize: 10 }),
  ),
  lib(ENT, "enterprise: office pros 50", "loadOfficePros", [BIG_OFFICE, 50], () => ent.loadOfficePros(BIG_OFFICE, 50), {
    // display_name ties: compare the name sequence and the rows in one order
    normalize: (rows: any[]) => ({ names: rows.map((r) => r.display_name), rows: sortRows(rows) }),
  }),
  lib(
    ENT,
    "enterprise: office pros, limit 2000 → the whole 990 roster (cap 1000 on both)",
    "loadOfficePros",
    [BIG_OFFICE, 2000],
    () => ent.loadOfficePros(BIG_OFFICE, 2000),
    { normalize: (rows: any[]) => ({ names: rows.map((r) => r.display_name), rows: sortRows(rows) }) },
  ),
  lib(ENT, "enterprise: top pros by score", "loadTopProsByScore", [BRAND, 20], () => ent.loadTopProsByScore(BRAND, 20)),
  lib(ENT, "enterprise: top offices by score", "loadTopOfficesByScore", [BRAND, 20], () =>
    ent.loadTopOfficesByScore(BRAND, 20),
  ),
  lib(ENT, "enterprise: top depth", "loadTopDepth", [BRAND, 20], () => ent.loadTopDepth(BRAND, 20)),
  lib(ENT, "enterprise: top reviews", "loadTopReviews", [BRAND, 20], () => ent.loadTopReviews(BRAND, 20)),
  lib(ENT, "enterprise: view-as professional", "loadViewAsProfessional", [PRO], () => ent.loadViewAsProfessional(PRO), {
    // nodes are ordered by ring only: ties inside a ring come back in any order
    normalize: (r: any) => (r ? { ...r, nodes: sortRows(r.nodes) } : r),
  }),
  lib(ENT, "enterprise: view-as professional (reviewed: amber-ernst)", "loadViewAsProfessional", [AMBER], () =>
    ent.loadViewAsProfessional(AMBER), {
      // 2,644 active nodes, ordered by ring, limit 300: which tied rows make the cut is arbitrary
      normalize: (r: any) =>
        r ? { ...r, nodes: { count: r.nodes.length, rings: r.nodes.map((n: any) => n.ring) } } : r,
    }),
  lib(ENT, "enterprise: view-as professional unknown → null", "loadViewAsProfessional", [NOBODY], () =>
    ent.loadViewAsProfessional(NOBODY),
  ),
  lib(ENT, "enterprise: view-as location (990-pro office, first 100)", "loadViewAsLocation", [BIG_OFFICE], () =>
    ent.loadViewAsLocation(BIG_OFFICE), {
      normalize: (r: any) =>
        r ? { ...r, pros: { names: r.pros.map((p: any) => p.display_name), rows: sortRows(r.pros) } } : r,
    }),
  lib(ENT, "enterprise: view-as location unknown → null", "loadViewAsLocation", [NOBODY], () =>
    ent.loadViewAsLocation(NOBODY),
  ),
  lib(ENT, "enterprise: moderation queue", "loadModerationQueue", [BRAND, 50], () => ent.loadModerationQueue(BRAND, 50)),
];

/* ─── lib/seat.ts ─── */
const locationNorm = (r: any) =>
  r
    ? {
        ...r,
        // the roster is ordered by score only (ties in any order): the score sequence + the rows
        pros: { scores: r.pros.map((p: any) => p.search_rank_score), rows: sortRows(r.pros) },
        ratings: sortRows(r.ratings),
        proRatings: sortRows(r.proRatings),
        reviews: sortRows(r.reviews),
      }
    : r;
const seatCases: ParityCase[] = [
  lib(SEAT, "seat: location (150 pros, all within the 200 roster)", "loadLocationSeat", [MID_OFFICE], () =>
    seat.loadLocationSeat(MID_OFFICE), { legacyDeps: [OFFICE_MODE], normalize: locationNorm }),
  lib(SEAT, "seat: location with reviews and ratings", "loadLocationSeat", [REVIEWED_OFFICE], () =>
    seat.loadLocationSeat(REVIEWED_OFFICE), { legacyDeps: [OFFICE_MODE], normalize: locationNorm }),
  lib(SEAT, "seat: location single-pro office", "loadLocationSeat", [PRO_OFFICE], () =>
    seat.loadLocationSeat(PRO_OFFICE), { legacyDeps: [OFFICE_MODE], normalize: locationNorm }),
  lib(SEAT, "seat: location 990-pro office (roster 200 of tied scores)", "loadLocationSeat", [BIG_OFFICE], () =>
    seat.loadLocationSeat(BIG_OFFICE), {
      legacyDeps: [OFFICE_MODE],
      // every score is tied, so which 200 of the 990 are read (and their ratings / reviews) is
      // arbitrary on both sides: compare the office, brand, score, office ratings and the counts
      normalize: (r: any) =>
        r
          ? {
              office: r.office,
              brand: r.brand,
              score: r.score,
              ratings: sortRows(r.ratings),
              pros: r.pros.length,
              isDemo: r.isDemo,
            }
          : r,
    }),
  lib(SEAT, "seat: location unknown → null", "loadLocationSeat", [NOBODY], () => seat.loadLocationSeat(NOBODY), {
    legacyDeps: [OFFICE_MODE],
  }),
  lib(SEAT, "seat: location listings", "loadLocationListings", [REVIEWED_OFFICE], () =>
    seat.loadLocationListings(REVIEWED_OFFICE), { legacyDeps: [OFFICE_MODE] }),
  lib(SEAT, "seat: professional (single-pro office: listings via the location)", "loadProfessionalSeat", [PRO], () =>
    seat.loadProfessionalSeat(PRO), {
      legacyDeps: [OFFICE_MODE],
      normalize: (r: any) => (r ? { ...r, nodes: sortRows(r.nodes), ratings: sortRows(r.ratings) } : r),
    }),
  lib(SEAT, "seat: professional with reviews, score (amber-ernst)", "loadProfessionalSeat", [AMBER], () =>
    seat.loadProfessionalSeat(AMBER), {
      legacyDeps: [OFFICE_MODE],
      // 2,644 active nodes ordered by ring, limit 400: the tied rows in the cut are arbitrary
      normalize: (r: any) =>
        r
          ? { ...r, ratings: sortRows(r.ratings), nodes: { count: r.nodes.length, rings: r.nodes.map((n: any) => n.ring) } }
          : r,
    }),
  lib(SEAT, "seat: professional unknown → null", "loadProfessionalSeat", [NOBODY], () =>
    seat.loadProfessionalSeat(NOBODY), { legacyDeps: [OFFICE_MODE] }),
];

/* ─── lib/office-mode.ts, lib/nora/interview-data.ts, lib/insurance-team.ts ─── */
const subjectOf = (id: string) => ({
  kind: "professional",
  id,
  name: "x",
  gcid: null,
  websiteUrl: null,
  city: null,
  state: null,
  phone: null,
  claimed: false,
});
const teamNorm = (t: any) => ({
  ...t,
  // reps are ordered by role only, links and quotas are unordered
  members: [...t.members]
    .map((m: any) => ({ ...m, logos: sortRows(m.logos), territories: sortRows(m.territories) }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id)),
  logos: sortRows(t.logos),
  expansion: sortRows(t.expansion),
  expansionThisYear: t.expansionThisYear,
});
const otherCases: ParityCase[] = [
  lib(OFFICE_MODE, "office mode: single-pro professional", "loadOfficeMode", [supabase, "professional", PRO], () =>
    loadOfficeMode("professional", PRO),
  ),
  lib(OFFICE_MODE, "office mode: multi-pro location", "loadOfficeMode", [supabase, "organization", MID_OFFICE], () =>
    loadOfficeMode("organization", MID_OFFICE),
  ),
  lib(OFFICE_MODE, "office mode: unknown → not_found", "loadOfficeMode", [supabase, "professional", NOBODY], () =>
    loadOfficeMode("professional", NOBODY),
  ),
  lib(INTERVIEW, "interview: professional subject", "loadInterviewSubject", ["professional", PRO], () =>
    loadInterviewSubject("professional", PRO),
  ),
  lib(INTERVIEW, "interview: office subject", "loadInterviewSubject", ["office", MID_OFFICE], () =>
    loadInterviewSubject("office", MID_OFFICE),
  ),
  lib(INTERVIEW, "interview: unknown subject → null", "loadInterviewSubject", ["professional", NOBODY], () =>
    loadInterviewSubject("professional", NOBODY),
  ),
  lib(INTERVIEW, "interview: claim source (claim_queue, own rows only)", "loadClaimSource", [subjectOf(PRO)], () =>
    loadClaimSource(subjectOf(PRO) as any),
  ),
  lib(
    INTERVIEW,
    "interview: claim source, entity with a claim_queue row",
    "loadClaimSource",
    [subjectOf("02c8255e-f5c5-43d5-8639-64891810d607")],
    () => loadClaimSource(subjectOf("02c8255e-f5c5-43d5-8639-64891810d607") as any),
  ),
  lib(TEAM, "team central: insurance (family insurance_agency, 90 revenue rows)", "loadTeamCentral", ["insurance", NOW], () =>
    loadTeamCentral("insurance", NOW), { normalize: teamNorm }),
  lib(TEAM, "team central: real_estate", "loadTeamCentral", ["real_estate", NOW], () => loadTeamCentral("real_estate", NOW), {
    normalize: teamNorm,
  }),
  lib(TEAM, "team central: unknown group (no family)", "loadTeamCentral", ["no_such_group", NOW], () =>
    loadTeamCentral("no_such_group", NOW), { normalize: teamNorm }),
];

/* ─── routes/_authenticated/dashboard.*.tsx (inline reads, verbatim) ─── */
const HOME_COLS = "id,display_name,first_name,last_name,job_title,headline,photo_url,address_city,gcid,local_rank,local_rank_of";
const PRO_COLS = "id,display_name,first_name,last_name,photo_url,gcid";

/** The page's professional read: by the signed-in user (as the page) or, for the explicit-id
 * cases, by id (what `?professional_id=` does). */
async function dashPro(sb: any, cols: string, proId?: string) {
  if (proId) return (await sb.from("professionals").select(cols).eq("id", proId).maybeSingle()).data;
  const { data: { session } } = await sb.auth.getSession();
  return (await sb.from("professionals").select(cols).eq("user_id", session.user.id).maybeSingle()).data;
}

/** dashboard.index.tsx load() */
async function legacyHome(sb: any, proId?: string) {
  const proRow = await dashPro(sb, HOME_COLS, proId);
  if (!proRow) return { pro: null };
  const [{ data: scoreRow }, { data: subRow }, { data: plgRows }] = await Promise.all([
    sb.from("search_rank_scores")
      .select("total_score,max_possible,score_change_7d,score_reviews,score_web_analytics,score_profile,score_connections,score_listings,score_content,gaps,next_milestone")
      .eq("entity_type", "professional").eq("entity_id", proRow.id)
      .order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("subscriptions").select("plan_name,status").eq("entity_type", "professional").eq("entity_id", proRow.id).maybeSingle(),
    sb.from("plg_rules").select("id,headline,body,cta_text,cta_url,cta_action,icon,priority")
      .eq("is_active", true).eq("gcid", proRow.gcid ?? "").order("priority", { ascending: true }).limit(5),
  ]);
  return { pro: proRow, score: scoreRow ?? null, subscription: subRow ?? null, plg: plgRows ?? [] };
}

/** dashboard.content.tsx load() */
async function legacyContent(sb: any, proId?: string) {
  const proRow = await dashPro(sb, PRO_COLS, proId);
  if (!proRow) return { pro: null };
  const TERM = "id,term,term_display,level,search_volume_monthly,search_intent,priority";
  const [{ data: ci }, topicsRes, qRes, allTerms] = await Promise.all([
    sb.from("content_items")
      .select("id,title,slug,excerpt,status,published_at,views,ai_mentions,keywords,topic_ids,published_url,content_type")
      .eq("author_type", "professional").eq("author_id", proRow.id).order("created_at", { ascending: false }).limit(100),
    proRow.gcid
      ? sb.from("exp_taxonomy").select(TERM).eq("gcid", proRow.gcid).eq("level", "topic").eq("is_active", true)
          .order("search_volume_monthly", { ascending: false, nullsFirst: false }).limit(5)
      : Promise.resolve({ data: [] }),
    proRow.gcid
      ? sb.from("exp_taxonomy").select(TERM).eq("gcid", proRow.gcid).eq("level", "question").eq("is_active", true)
          .order("search_volume_monthly", { ascending: false, nullsFirst: false }).limit(20)
      : Promise.resolve({ data: [] }),
    proRow.gcid ? sb.from("exp_taxonomy").select(TERM).eq("gcid", proRow.gcid) : Promise.resolve({ data: [] }),
  ]);
  return { pro: proRow, items: ci ?? [], topics: topicsRes.data ?? [], questions: qRes.data ?? [], terms: allTerms.data ?? [] };
}

/** dashboard.listings.tsx load(): the listings + registry read for a subject */
async function legacyListingRows(sb: any, entityType: string, entityId: string, gcid: string | null) {
  const [{ data: lst }, { data: reg }] = await Promise.all([
    sb.from("listings")
      .select("id,directory_key,directory_name,directory_url,status,listing_url,last_verified,last_submitted,has_drift,drift_fields,score_points,name_match,phone_match,address_match")
      .eq("entity_type", entityType).eq("entity_id", entityId),
    gcid
      ? sb.from("exp_vertical_node_registry").select("id,node_name,node_slug,connection_method,score_points,priority,url_pattern,ring")
          .eq("gcid", gcid).eq("ring", "presence").eq("is_active", true).order("priority", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  return { listings: lst ?? [], registry: reg ?? [] };
}

/** dashboard.reviews.tsx load() */
async function legacyReviews(sb: any, proId?: string) {
  const proRow = await dashPro(sb, PRO_COLS, proId);
  if (!proRow) return { pro: null };
  const { data: rows } = await sb.from("reviews")
    .select("id,rating,title,body,reviewer_name,review_date,source,reply_body,reply_date,is_flagged,flag_reason")
    .eq("entity_type", "professional").eq("entity_id", proRow.id).order("review_date", { ascending: false }).limit(200);
  return { pro: proRow, reviews: rows ?? [] };
}

// moved (surface audit 2026-10-25): /xmp/dashboard/* → /srp/dashboard/*
const dashboardCases: ParityCase[] = [
  { name: "dashboard home: signed-in user's professional (none → pro null)", legacy: (sb) => legacyHome(sb),
    api: { method: "GET", path: "/srp/dashboard/home" } },
  { name: "dashboard home: explicit professional amber-ernst", legacy: (sb) => legacyHome(sb, AMBER),
    api: { method: "GET", path: `/srp/dashboard/home?professional_id=${AMBER}` } },
  { name: "dashboard content: signed-in user", legacy: (sb) => legacyContent(sb),
    api: { method: "GET", path: "/srp/dashboard/content" } },
  { name: "dashboard content: explicit professional amber-ernst", legacy: (sb) => legacyContent(sb, AMBER),
    api: { method: "GET", path: `/srp/dashboard/content?professional_id=${AMBER}` },
    // the term list is unordered; topics / questions tie on search volume
    normalize: (r: any) => (r.pro ? { ...r, topics: sortRows(r.topics), questions: sortRows(r.questions), terms: sortRows(r.terms) } : r) },
  { name: "dashboard listings: signed-in user's professional", legacy: async (sb) => ({ pro: await dashPro(sb, PRO_COLS) }),
    api: { method: "GET", path: "/srp/dashboard/me" } },
  { name: "dashboard listings: explicit professional", legacy: async (sb) => ({ pro: await dashPro(sb, PRO_COLS, PRO) }),
    api: { method: "GET", path: `/srp/dashboard/me?professional_id=${PRO}` } },
  { name: "dashboard listings: rows for the single-pro location", legacy: (sb) =>
      legacyListingRows(sb, "organization", PRO_OFFICE, "gcid:insurance_agency"),
    api: { method: "GET", path: `/srp/dashboard/listings?entity_type=organization&entity_id=${PRO_OFFICE}&gcid=gcid:insurance_agency` },
    normalize: (r: any) => ({ ...r, listings: sortRows(r.listings) }) },
  { name: "dashboard listings: rows, no gcid", legacy: (sb) => legacyListingRows(sb, "professional", AMBER, null),
    api: { method: "GET", path: `/srp/dashboard/listings?entity_type=professional&entity_id=${AMBER}` },
    normalize: (r: any) => ({ ...r, listings: sortRows(r.listings) }) },
  { name: "dashboard reviews: signed-in user", legacy: (sb) => legacyReviews(sb),
    api: { method: "GET", path: "/srp/dashboard/reviews" } },
  { name: "dashboard reviews: explicit professional amber-ernst", legacy: (sb) => legacyReviews(sb, AMBER),
    api: { method: "GET", path: `/srp/dashboard/reviews?professional_id=${AMBER}` } },
];

/* ─── routes/_authenticated/enterprise.$orgSlug.{campaigns,users}.tsx (inline reads, verbatim) ─── */
/** campaigns.tsx load(), in the API's shape (the page builds allOrgs from root + descendants) */
async function legacyCampaigns(sb: any, orgSlug: string) {
  const COLS = "id,name,slug,entity_type,gcid,hierarchy_path";
  const { data: rootRow } = await sb.from("organizations").select(COLS).eq("slug", orgSlug).maybeSingle();
  if (!rootRow) return { root: null };
  const { data: descRows } = await sb.from("organizations").select(COLS).like("hierarchy_path", `%${rootRow.id}%`);
  const orgIds = [rootRow.id, ...((descRows ?? []) as any[]).filter((o) => o.id !== rootRow.id).map((o) => o.id)];
  const [campRes, ruleRes] = await Promise.all([
    sb.from("review_campaigns")
      .select("id,entity_type,entity_id,name,campaign_type,status,subject,message_body,target_platform,sent_count,opened_count,clicked_count,completed_count,compliance_approved,includes_required_disclosures,created_at")
      .eq("entity_type", "organization").in("entity_id", orgIds).order("created_at", { ascending: false }),
    rootRow.gcid
      ? sb.from("content_compliance_rules").select("id,rule_name,rule_type,rule_value,applies_to,severity")
          .eq("gcid", rootRow.gcid).eq("is_active", true)
      : Promise.resolve({ data: [] }),
  ]);
  return { root: rootRow, descendants: descRows ?? [], campaigns: campRes.data ?? [], rules: ruleRes.data ?? [] };
}

/** users.tsx load(), in the API's shape */
async function legacyUsers(sb: any, orgSlug: string) {
  const { data: { session } } = await sb.auth.getSession();
  const COLS = "id,name,slug,entity_type,parent_org_id,hierarchy_path,hierarchy_depth";
  const { data: rootRow } = await sb.from("organizations").select(COLS).eq("slug", orgSlug).maybeSingle();
  if (!rootRow) return { root: null };
  const { data: descRows } = await sb.from("organizations").select(COLS).like("hierarchy_path", `%${rootRow.id}%`);
  const orgIds = [rootRow.id, ...((descRows ?? []) as any[]).filter((o) => o.id !== rootRow.id).map((o) => o.id)];
  const [proRes, roleRes, inviteRes, adminRoleRes] = await Promise.all([
    sb.from("professionals")
      .select("id,display_name,first_name,last_name,photo_url,email,user_id,primary_org_id,search_rank_score,claimed,is_active")
      .in("primary_org_id", orgIds).limit(2000),
    sb.from("user_roles").select("id,user_id,role,entity_type,entity_id,can_login_as,is_active")
      .eq("entity_type", "organization").in("entity_id", orgIds),
    sb.from("invitations").select("id,email,status,invited_at,entity_type,entity_id")
      .eq("entity_type", "organization").in("entity_id", orgIds).order("invited_at", { ascending: false }).limit(100),
    session?.user.id
      ? sb.from("user_roles").select("can_login_as").eq("user_id", session.user.id).eq("entity_type", "organization")
          .in("entity_id", orgIds).eq("is_active", true)
      : Promise.resolve({ data: [] }),
  ]);
  const userIds = ((proRes.data ?? []) as any[]).map((p) => p.user_id).filter(Boolean);
  let accounts: any[] = [];
  if (userIds.length) {
    const { data } = await sb.from("user_accounts").select("supabase_user_id,email,last_login_at,is_active").in("supabase_user_id", userIds);
    accounts = data ?? [];
  }
  return {
    root: rootRow,
    descendants: descRows ?? [],
    pros: proRes.data ?? [],
    roles: roleRes.data ?? [],
    invites: inviteRes.data ?? [],
    adminRoles: adminRoleRes.data ?? [],
    accounts,
  };
}
const usersNorm = (r: any) => (r.root ? { ...r, pros: sortRows(r.pros), roles: sortRows(r.roles), descendants: sortRows(r.descendants) } : r);

// moved (surface audit 2026-10-25): /xmp/enterprise/orgs/{slug}/campaigns → /campaigns/enterprise/orgs/{slug}/campaigns
const orgPageCases: ParityCase[] = [
  { name: "enterprise campaigns: state-farm", legacy: (sb) => legacyCampaigns(sb, "state-farm"),
    api: { method: "GET", path: "/campaigns/enterprise/orgs/state-farm/campaigns" }, normalize: (r: any) => (r.root ? { ...r, rules: sortRows(r.rules), descendants: sortRows(r.descendants) } : r) },
  { name: "enterprise campaigns: new-american-funding (has hierarchy_path)", legacy: (sb) => legacyCampaigns(sb, "new-american-funding"),
    api: { method: "GET", path: "/campaigns/enterprise/orgs/new-american-funding/campaigns" }, normalize: (r: any) => (r.root ? { ...r, rules: sortRows(r.rules), descendants: sortRows(r.descendants) } : r) },
  { name: "enterprise campaigns: unknown slug → root null", legacy: (sb) => legacyCampaigns(sb, "does-not-exist-parity"),
    api: { method: "GET", path: "/campaigns/enterprise/orgs/does-not-exist-parity/campaigns" } },
  { name: "enterprise users: state-farm", legacy: (sb) => legacyUsers(sb, "state-farm"),
    api: { method: "GET", path: "/xmp/enterprise/orgs/state-farm/users" }, normalize: usersNorm },
  { name: "enterprise users: compass-fort-worth-tx (150 pros)", legacy: (sb) => legacyUsers(sb, "compass-fort-worth-tx"),
    api: { method: "GET", path: "/xmp/enterprise/orgs/compass-fort-worth-tx/users" }, normalize: usersNorm },
  { name: "enterprise users: compass-new-york-ny-2 (990 pros, under the 1000 cap)", legacy: (sb) => legacyUsers(sb, "compass-new-york-ny-2"),
    api: { method: "GET", path: "/xmp/enterprise/orgs/compass-new-york-ny-2/users" }, normalize: usersNorm },
  { name: "enterprise users: unknown slug → root null", legacy: (sb) => legacyUsers(sb, "does-not-exist-parity"),
    api: { method: "GET", path: "/xmp/enterprise/orgs/does-not-exist-parity/users" } },
];

export const cases: ParityCase[] = [
  ...enterpriseCases,
  ...seatCases,
  ...otherCases,
  ...dashboardCases,
  ...orgPageCases,
];
