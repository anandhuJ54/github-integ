import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* G2 (contract review, 2026-10-13): "Preview records" for a pending site-map proposal.
   Builds records exactly as the harvest would stage them (same exported builders as the harvest workers:
   applySiteContract, applyAddressOwner, applyExtraFields, buildHarvestRecord). Read-only: nothing is
   written. Not included: the category's generic taxonomy routes the harvest adds at run time (they only
   fill values that are still empty). Admins only (super_admin / architect).
   Contract re-check (2026-10-15): the same preview also runs on the SAVED contract ({ domain, gcid } instead of
   proposalId), on the contract's sample pages or on up to 10 URLs given by the reviewer. A given URL must be on
   the site and match the contract's profile page pattern, otherwise it is listed with the reason and not fetched.
   A contract whose detail route reads the site's profile API (record_source 'api' / 'api+page') is previewed the
   way disco-detail-api-worker harvests it: JSON values first, the page fills the rest (or is the fallback). */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ProposalPreviewRecord = {
  url: string;
  ok: boolean;
  reason?: string;
  entity_type?: string;
  filled?: number;
  floor_needed?: number;
  shallow?: boolean;
  must_have?: { ok: boolean; missing: string[] };
  universal?: Record<string, any>;
  /** Full record as staging would store it (taxonomy values, _subjects, _extra, _static_sources). */
  payload?: Record<string, any>;
  identity?: Record<string, any>;
  /** Where the values came from: page, api, api+page, or page_fallback (API did not answer). */
  detail_source?: string;
};

// Fix (preview uses the harvest's fetch method, 2026-10-16): the fetch tier decides first, exactly as exp_etl_fetch_tick
// does (proxy_render -> rendered, proxy -> server_crawl, direct -> direct); the crawl method only when no tier is set.
// It used to read the crawl method alone, so century21.com (tier proxy_render) was previewed with a plain fetch.
const CRAWL_BY_TIER: Record<string, "server_crawl" | "needs_js_api" | "direct"> = {
  proxy_render: "needs_js_api",
  proxy: "server_crawl",
  direct: "direct",
};
const CRAWL_BY_SOURCE: Record<string, "server_crawl" | "needs_proxy" | "needs_js_api"> = {
  blocked_needs_proxy: "needs_proxy",
  js_needs_api: "needs_js_api",
};
const MAX_GIVEN_URLS = 10;
const emptyV = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

function patternMatches(url: string, pattern: string | null): boolean {
  if (!pattern) return true;
  try { const re = new RegExp(pattern); return re.test(url) || re.test(url.split("#")[0]!.split("?")[0]!); } catch { return true; }
}
/** Why a reviewer-given URL is not fetched, or null when it may be fetched. */
function givenUrlProblem(url: string, domain: string, pattern: string | null): string | null {
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "not an http(s) address";
    host = u.hostname.toLowerCase();
  } catch { return "not a valid address"; }
  const d = domain.toLowerCase();
  if (host !== d && !host.endsWith("." + d)) return `not on ${domain}`;
  if (!patternMatches(url, pattern)) return "does not match the contract's profile page pattern";
  return null;
}

export const previewSiteProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const x = (d ?? {}) as any;
    const id = Number(x.proposalId);
    const urls: string[] = Array.isArray(x.urls)
      ? [...new Set((x.urls as unknown[]).map((u) => String(u ?? "").trim()).filter(Boolean))]
      : [];
    if (urls.length > MAX_GIVEN_URLS) throw new Error(`at most ${MAX_GIVEN_URLS} URLs`);
    if (Number.isFinite(id) && id > 0) return { proposalId: id, domain: null as string | null, gcid: null as string | null, urls };
    const domain = typeof x.domain === "string" ? x.domain.trim().toLowerCase() : "";
    const gcid = typeof x.gcid === "string" ? x.gcid.trim() : "";
    if (!domain || !gcid) throw new Error("proposalId, or domain and gcid, required");
    return { proposalId: null as number | null, domain, gcid, urls };
  })
  .handler(async ({ data, context }): Promise<{ domain: string; target: string; records: ProposalPreviewRecord[] }> => {
    const ctx = context as { supabase: any };
    const { data: allowed } = await ctx.supabase.rpc("exp_ctrl_has_role", { p_roles: ["super_admin", "architect"] });
    if (allowed !== true) throw new Error("insufficient_privilege");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // The contract to preview: a pending proposal, or the saved contract of domain + category.
    let sc: any; let domain: string; let gcid: string; let target: string;
    let fieldFloor: number | null; let detailEntityType: string | null; let detailPattern: string | null;
    if (data.proposalId) {
      const { data: prop, error } = await db
        .from("disco_proposals")
        .select("proposal_id, category_slug, kind, payload")
        .eq("proposal_id", data.proposalId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!prop || prop.kind !== "site_map") throw new Error("proposal not found");
      const p = prop.payload ?? {};
      sc = p?.extraction?.site_contract;
      domain = String(p.domain ?? "");
      gcid = String(prop.category_slug ?? "");
      fieldFloor = p.field_floor ?? null;
      detailEntityType = p.detail_entity_type ?? null;
      detailPattern = typeof p.detail_pattern === "string" ? p.detail_pattern : null;
      target = `proposal #${data.proposalId}`;
    } else {
      const { data: row, error } = await db
        .from("disco_site_contract")
        .select("domain, category_slug, detail_pattern, field_floor, detail_entity_type, learned_at, extraction")
        .eq("domain", data.domain).eq("category_slug", data.gcid)
        .order("learned_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      sc = row?.extraction?.site_contract;
      domain = String(row?.domain ?? data.domain);
      gcid = String(data.gcid);
      fieldFloor = row?.field_floor ?? null;
      detailEntityType = row?.detail_entity_type ?? null;
      detailPattern = typeof row?.detail_pattern === "string" ? row.detail_pattern : null;
      target = "saved contract";
    }
    if (!sc || !domain || Number(sc.version ?? 0) < 3) throw new Error("no site contract to preview");

    const { data: src } = await db
      .from("exp_etl_sources")
      .select("crawl_method, fetch_tier, source_type")
      .eq("source_domain", domain)
      .eq("gcid", gcid)
      .limit(1)
      .maybeSingle();
    const crawl_method = CRAWL_BY_TIER[String(src?.fetch_tier ?? "")] ?? CRAWL_BY_SOURCE[String(src?.crawl_method ?? "")] ?? "server_crawl";

    // Pages: the reviewer's URLs (checked first), else up to 5 of the contract's sample pages.
    const skipped = new Map<string, string>();
    let urls: string[];
    if (data.urls.length) {
      urls = data.urls;
      for (const u of urls) { const why = givenUrlProblem(u, domain, detailPattern); if (why) skipped.set(u, why); }
    } else {
      const samples: string[] = (Array.isArray(sc.samples) ? sc.samples : [])
        .map((x: any) => (typeof x === "string" ? x : x?.url))
        .filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
      urls = [...new Set(samples)].slice(0, 5);
    }
    if (!urls.length) return { domain, target, records: [] };

    const { scrapeWebsite, looksBlocked } = await import("@/routes/api/public/disco-webscraper-worker");
    const SC = await import("@/routes/api/public/-disco-site-contract");
    const DA = await import("@/routes/api/public/-disco-detail-api");
    const names = new Set<string>(Array.isArray(sc.site_entity_names) ? sc.site_entity_names : []);
    const firmSignatures = new Set<string>(sc.firm_signatures ?? []);
    const dr = sc.detail_route ?? {};
    const mode: "api" | "api+page" | "page" = dr.record_source === "api" || dr.record_source === "api+page" ? dr.record_source : "page";

    const records = await Promise.all(
      urls.map(async (url): Promise<ProposalPreviewRecord> => {
        const why = skipped.get(url);
        if (why) return { url, ok: false, reason: `not fetched: ${why}` };
        try {
          // 1. Profile API (contracts proven on it), as disco-detail-api-worker does.
          let apiValues: Record<string, unknown> | null = null;
          let apiWhy = "";
          if (mode !== "page" && dr.api && dr.json_fields && Object.keys(dr.json_fields).length) {
            const got = await DA.fetchDetailFor(dr.api, url, 30_000);
            apiWhy = got.why;
            if (got.json !== undefined) apiValues = DA.jsonValues(got.json, dr.json_fields);
          }
          const source = mode === "page" ? "page" : apiValues ? mode : "page_fallback";
          // 2. Profile page (page contracts, api+page, or the API did not answer).
          let pageValues: Record<string, unknown> = {};
          let extras: Record<string, unknown> = {};
          let firmRelabelled: string[] = [];
          if (source !== "api") {
            const page = await scrapeWebsite({ url, crawl_method });
            const failed = !page.ok || !page.content || looksBlocked(page.status_code, page.content);
            if (failed && !apiValues) {
              const base = page.ok && page.content ? "blocked" : `did not load (status ${page.status_code ?? 0})`;
              return { url, ok: false, reason: apiWhy ? `${base}; profile API: ${apiWhy}` : base };
            }
            if (!failed) {
              const applied = SC.applySiteContract(page.content!, url, sc, names, { firmSignatures });
              pageValues = applied.values; firmRelabelled = applied.firmRelabelled;
              if (!apiValues && SC.looksNotFound(page.content!, SC.applyAddressOwner(pageValues, sc))) {
                return { url, ok: false, reason: "page reads as not found" };
              }
              extras = SC.applyExtraFields(page.content!, url, sc, names, { firmSignatures });
            }
          }
          // 3. Merge: the JSON value wins where both have one; the page fills the rest.
          const merged: Record<string, unknown> = { ...pageValues };
          for (const [k, v] of Object.entries(apiValues ?? {})) if (!emptyV(v)) merged[k] = v;
          const filled = SC.applyAddressOwner(SC.applyValueRules(merged, sc, url), sc);
          if (src?.source_type === "brand_site" && sc.own_page_key && emptyV(filled["tax." + sc.own_page_key])) filled["tax." + sc.own_page_key] = url;
          const rec = SC.buildHarvestRecord({
            contract: sc,
            values: filled,
            detailUrl: url,
            detailEntityType,
            fieldFloor,
            firmRelabelled,
            extras,
          });
          return {
            url, ok: true, entity_type: rec.entity_type, filled: rec.filled, floor_needed: rec.floor_needed,
            shallow: rec.shallow, must_have: rec.must_have, universal: rec.identity_candidates.universal,
            payload: rec.payload, identity: rec.identity_candidates, detail_source: source,
          };
        } catch (e) {
          return { url, ok: false, reason: String((e as Error)?.message ?? e).slice(0, 200) };
        }
      }),
    );
    return { domain, target, records };
  });

/* G2 (2026-10-13): Accept from the review panel. The database function does the save and the admin check
   (disco_accept_site_proposal, called with the reviewer's own session); then the category's shared
   extra-key list is refreshed the same way the mapping worker does after an auto-save. */
export const acceptSiteProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const id = Number((d as any)?.proposalId);
    if (!Number.isFinite(id) || id <= 0) throw new Error("proposalId required");
    return { proposalId: id };
  })
  .handler(async ({ data, context }): Promise<Record<string, any>> => {
    const ctx = context as { supabase: any };
    const { data: res, error } = await ctx.supabase.rpc("disco_accept_site_proposal", { p_proposal_id: data.proposalId });
    if (error) throw new Error(error.message);
    const out: Record<string, any> = { ...(res ?? {}) };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as any;
      const domain = String(res?.domain ?? "");
      const { data: prop } = await db.from("disco_proposals").select("category_slug").eq("proposal_id", data.proposalId).maybeSingle();
      const gcid = String(prop?.category_slug ?? "");
      const { data: row } = await db.from("disco_site_contract")
        .select("extraction").eq("domain", domain).eq("category_slug", gcid).maybeSingle();
      const { refreshExtraKeys } = await import("@/routes/api/public/-disco-extra-keys");
      await refreshExtraKeys(db, gcid, domain, row?.extraction?.site_contract?.extra_fields ?? {});
      out.extra_keys_refreshed = true;
    } catch (e) {
      out.extra_keys_refreshed = false;
      out.extra_keys_error = String((e as Error)?.message ?? e).slice(0, 200);
    }
    return out;
  });
