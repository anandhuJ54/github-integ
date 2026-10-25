import type { ParityCase } from "./types";

// The endpoints moved (surface audit 2026-10-25): claims + PLG rules → /admin, claim profile → /srp.

// Legacy queries copied verbatim from surface-ui/conversion-agents/src/routes/_authenticated/
// at migrate/from-experiencesrp-clone (they were inline in components, so nothing to import).

// A professional and its organization known to exist on GCP, for the entity lookup and claim page.
const PRO_ID = "56d35654-1bcd-4ee6-97e3-3571ef61c8f1";
const PRO_SLUG = "sf-a9ee009780abff5cc27f";

const TABS = [
  { id: "pending", filter: ["pending"] },
  { id: "manual_review", filter: ["manual_review"] },
  { id: "auto_approved", filter: ["auto_approved", "approved"] },
  { id: "conflict", filter: ["conflict"] },
  { id: "all", filter: null as string[] | null },
] as const;

export const cases: ParityCase[] = [
  {
    // claims.tsx:95-111
    name: "claims: stats tiles",
    legacy: async (supabase) => {
      const counts = await Promise.all([
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).in("status", ["auto_approved", "approved"]),
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).eq("status", "manual_review"),
        supabase.from("claim_queue").select("*", { count: "exact", head: true }).eq("status", "conflict"),
      ]);
      return {
        pending: counts[0].count ?? 0,
        approved: counts[1].count ?? 0,
        manual: counts[2].count ?? 0,
        conflict: counts[3].count ?? 0,
      };
    },
    api: { method: "GET", path: "/admin/claims/stats" },
  },
  // claims.tsx:113-127, one case per tab
  ...TABS.map(
    (tabConfig): ParityCase => ({
      name: `claims: list, tab ${tabConfig.id}`,
      legacy: async (supabase) => {
        let q = supabase
          .from("claim_queue")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        if (tabConfig.filter) q = q.in("status", tabConfig.filter as unknown as string[]);
        const { data, error } = await q;
        if (error) throw error;
        return data ?? [];
      },
      api: { method: "GET", path: `/admin/claims?tab=${tabConfig.id}` },
    }),
  ),
  {
    // claims.tsx:132-171, with a known professional (the signed-in user may see no claims)
    name: "claims: entity lookup",
    legacy: async (supabase) => {
      const profIds = [PRO_ID];
      const orgIds: string[] = [];
      const [pros] = await Promise.all([
        supabase.from("professionals").select("id, display_name, first_name, last_name, gcid, photo_url").in("id", profIds),
      ]);
      const map: Record<string, unknown> = {};
      (pros.data ?? []).forEach((p) => {
        map[p.id] = {
          name: p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unnamed",
          gcid: p.gcid,
          imageUrl: p.photo_url ?? null,
          kind: "professional",
        };
      });
      void orgIds;
      return map;
    },
    api: {
      method: "POST",
      path: "/admin/claims/entities",
      body: { professionalIds: [PRO_ID], organizationIds: [] },
    },
  },
  {
    // emp.plg-rules.tsx:97-135; the Map of stats becomes an array sorted by rule_id
    name: "plg-rules: rules + event stats",
    legacy: async (supabase) => {
      const [ruleRes, eventRes] = await Promise.all([
        supabase
          .from("plg_rules")
          .select(
            "id,gcid,rule_name,rule_type,trigger_condition,priority,headline,body,cta_text,cta_action,cta_url,requires_upgrade,upgrade_tier,icon,is_active,created_at",
          )
          .order("priority", { ascending: true })
          .order("rule_name", { ascending: true })
          .limit(2000),
        supabase.from("plg_events").select("rule_id,fired_at,dismissed_at,converted_at").limit(50000),
      ]);
      const map = new Map<string, { rule_id: string; fires: number; dismissals: number; conversions: number }>();
      for (const e of (eventRes.data ?? []) as Array<{
        rule_id: string;
        fired_at: string | null;
        dismissed_at: string | null;
        converted_at: string | null;
      }>) {
        const cur = map.get(e.rule_id) ?? { rule_id: e.rule_id, fires: 0, dismissals: 0, conversions: 0 };
        if (e.fired_at) cur.fires += 1;
        if (e.dismissed_at) cur.dismissals += 1;
        if (e.converted_at) cur.conversions += 1;
        map.set(e.rule_id, cur);
      }
      return {
        rules: ruleRes.data ?? [],
        stats: [...map.values()].sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0)),
      };
    },
    api: { method: "GET", path: "/admin/plg-rules" },
  },
  {
    // claim.$professional.tsx:27-52
    name: "claim page: profile + license label",
    legacy: async (supabase) => {
      const { data: prof, error } = await supabase
        .from("professionals")
        .select(
          "id, first_name, last_name, display_name, slug, headline, photo_url, address_city, address_state, gcid, claimed, search_rank_score, local_rank, local_rank_of, gbp_connected, bio, primary_license_type",
        )
        .eq("slug", PRO_SLUG)
        .maybeSingle();
      if (error) throw error;
      if (!prof) throw new Error("notFound");
      let licenseLabel = "License Number";
      if (prof.gcid) {
        const { data: comp } = await supabase
          .from("exp_category_compliance")
          .select("license_label")
          .eq("gcid", prof.gcid)
          .maybeSingle();
        if (comp?.license_label) licenseLabel = comp.license_label;
      }
      return { prof, licenseLabel };
    },
    api: { method: "GET", path: `/srp/claim-profile/${PRO_SLUG}` },
  },
];
