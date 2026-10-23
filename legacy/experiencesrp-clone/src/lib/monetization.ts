import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SearchKind } from "@/lib/search";
import { decodeName } from "@/lib/search";

/* ----------------------------- sponsored slots ----------------------------- */

export type SponsoredSlot = {
  slot_id: string;
  slot_position: number;
  advertiser_name: string | null;
  advertiser_org_id: string | null;
  doc_entity_type: SearchKind | null;
  doc_slug: string | null;
  doc_name: string | null;
  doc_title: string | null;
  doc_city: string | null;
  doc_state: string | null;
  doc_zip: string | null;
  doc_rating: number | null;
  doc_review_count: number | null;
  doc_rank_score: number | null;
  doc_completeness_pct: number | null;
  doc_photo_url: string | null;
  doc_claimed: boolean | null;
};

/** Cap is 3 active slots per category per zip; the RPC enforces it too. */
export const SPONSORED_CAP = 3;

const ZIP = /^\d{5}$/;

/** A sponsored buy is priced on category + zip, so both must be present. */
export function sponsoredKey(gcid: string, loc: string) {
  const zip = loc.trim();
  if (!gcid || !ZIP.test(zip)) return null;
  return { gcid, zip };
}

export async function loadSponsoredSlots(gcid: string, loc: string): Promise<SponsoredSlot[]> {
  const key = sponsoredKey(gcid, loc);
  if (!key) return [];
  const { data } = await supabase.rpc("public_sponsored_slots", {
    p_gcid: key.gcid,
    p_geo: key.zip,
  });
  return ((data ?? []) as SponsoredSlot[])
    .slice(0, SPONSORED_CAP)
    .map((s) => ({
      ...s,
      advertiser_name: decodeName(s.advertiser_name),
      doc_name: s.doc_name ? decodeName(s.doc_name) : null,
    }));
}

/* --------------------------------- ad units -------------------------------- */

export type AdCreative = {
  headline?: string;
  body?: string;
  cta?: string;
  variant?: string;
  href?: string;
};

export type AdUnit = {
  id: string;
  name: string;
  context: string;
  target_gcid: string | null;
  target_geo: string | null;
  creative: AdCreative | null;
  specificity: number;
};

/** Ordered best-match first (exact gcid + geo beats gcid beats 'default'). */
export async function loadAdUnits(
  context: string,
  gcid: string | null,
  geo: string | null,
): Promise<AdUnit[]> {
  const { data } = await supabase.rpc("public_ad_units", {
    p_context: context,
    p_gcid: gcid ?? "default",
    p_geo: geo ?? "",
  });
  return (data ?? []) as AdUnit[];
}

export function pickVariant(units: AdUnit[], variant: string): AdUnit | null {
  return units.find((u) => (u.creative?.variant ?? "") === variant) ?? null;
}

/* ---------------------------- impression accounting --------------------------- */

/**
 * One upsert per public render, fired from the browser on mount rather than in
 * SSR: the loaders also run during prerender/hydration, which would double count.
 */
export async function pingPageView(opts: {
  gcid: string | null;
  zip: string | null;
  claimCta: boolean;
}) {
  if (!opts.gcid || !opts.zip) return;
  await supabase.rpc("public_page_view_ping", {
    p_gcid: opts.gcid,
    p_geo_value: opts.zip,
    p_claim_cta: opts.claimCta,
    p_geo_type: "zip",
  });
}

export function usePageViewPing(opts: { gcid: string | null; zip: string | null; claimCta: boolean }) {
  const { gcid, zip, claimCta } = opts;
  useEffect(() => {
    if (!gcid || !zip) return;
    void pingPageView({ gcid, zip, claimCta });
  }, [gcid, zip, claimCta]);
}
