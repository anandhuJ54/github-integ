import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Public reads for the engagement layer: direct card actions, the compare
 * view and taxonomy-derived related searches. Read-only, live data only.
 */
function publicClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

type Any = { from: (table: string) => { select: (cols: string) => any } };

export type CardAction = {
  phone: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
};

function trim(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function addressOf(row: Record<string, unknown>) {
  return (
    [row.address_street, row.address_city, row.address_state, row.address_zip]
      .map((part) => trim(part))
      .filter(Boolean)
      .join(", ") || null
  );
}

/** Call / Website / Directions / Message data for a batch of result cards. */
export const getCardActions = createServerFn({ method: "GET" })
  .inputValidator((input: { entityIds: string[] } | undefined) => ({
    entityIds: (input?.entityIds ?? []).filter(Boolean).slice(0, 40),
  }))
  .handler(async ({ data }): Promise<Record<string, CardAction>> => {
    if (!data.entityIds.length) return {};
    const sb = publicClient() as unknown as Any;
    const [pros, orgs, nodes] = await Promise.all([
      Promise.resolve(
        sb
          .from("professionals")
          .select("id, phone, email, website_url, address_city, address_state, address_zip")
          .in("id", data.entityIds),
      ).catch(() => ({ data: [] })),
      Promise.resolve(
        sb
          .from("organizations")
          .select(
            "id, phone, email, website_url, address_street, address_city, address_state, address_zip",
          )
          .in("id", data.entityIds),
      ).catch(() => ({ data: [] })),
      Promise.resolve(
        sb
          .from("graph_nodes")
          .select("entity_id, node_type, title, url")
          .in("entity_id", data.entityIds)
          .in("node_type", ["contact_phone", "website", "contact_email", "address"])
          .eq("is_active", true)
          .limit(400),
      ).catch(() => ({ data: [] })),
    ]);

    const out: Record<string, CardAction> = {};
    const put = (id: string, patch: Partial<CardAction>) => {
      const current = out[id] ?? { phone: null, website: null, email: null, address: null };
      out[id] = {
        phone: current.phone ?? patch.phone ?? null,
        website: current.website ?? patch.website ?? null,
        email: current.email ?? patch.email ?? null,
        address: current.address ?? patch.address ?? null,
      };
    };

    for (const row of [...((pros.data ?? []) as Record<string, unknown>[]), ...((orgs.data ?? []) as Record<string, unknown>[])]) {
      put(String(row.id), {
        phone: trim(row.phone),
        website: trim(row.website_url),
        email: trim(row.email),
        address: addressOf(row),
      });
    }
    for (const node of (nodes.data ?? []) as Record<string, unknown>[]) {
      const id = String(node.entity_id);
      const type = String(node.node_type ?? "");
      const value = trim(node.title) ?? trim(node.url);
      if (!value) continue;
      if (type === "contact_phone") put(id, { phone: value });
      else if (type === "website") put(id, { website: trim(node.url) ?? value });
      else if (type === "contact_email") put(id, { email: value });
      else if (type === "address") put(id, { address: value });
    }
    return out;
  });

export type CompareEntity = {
  id: string;
  entityId: string;
  name: string;
  slug: string | null;
  entityType: string;
  photoUrl: string | null;
  categoryLabel: string | null;
  location: string | null;
  rating: number | null;
  reviewCount: number | null;
  rankScore: number | null;
  score: number | null;
  band: string | null;
  components: { label: string; value: string }[];
  specialties: string[];
  languages: string[];
  credentials: string[];
  actions: CardAction;
};

/** Side-by-side facts for 2–3 selected profiles, all graph/table sourced. */
export const getCompareEntities = createServerFn({ method: "GET" })
  .inputValidator((input: { docIds: string[] } | undefined) => ({
    docIds: (input?.docIds ?? []).filter(Boolean).slice(0, 3),
  }))
  .handler(async ({ data }): Promise<CompareEntity[]> => {
    if (!data.docIds.length) return [];
    const sb = publicClient() as unknown as Any;
    const docsRes = await Promise.resolve(
      sb
        .from("search_documents")
        .select(
          "id, entity_id, entity_type, slug, gcid, name, title, city, state, zip, rating, review_count, rank_score, photo_url",
        )
        .in("id", data.docIds),
    ).catch(() => ({ data: [] }));
    const docs = (docsRes.data ?? []) as Record<string, unknown>[];
    if (!docs.length) return [];
    const entityIds = docs.map((doc) => String(doc.entity_id));
    const gcids = [...new Set(docs.map((doc) => String(doc.gcid ?? "")).filter(Boolean))];

    const [scoresRes, nodesRes, credsRes, catsRes, actions] = await Promise.all([
      Promise.resolve(
        sb.from("exp_profile_scores").select("entity_id, score, band, components").in("entity_id", entityIds),
      ).catch(() => ({ data: [] })),
      Promise.resolve(
        sb
          .from("graph_nodes")
          .select("entity_id, node_type, title, extracted_data")
          .in("entity_id", entityIds)
          .in("node_type", ["specialty", "language", "credential"])
          .eq("is_active", true)
          .limit(600),
      ).catch(() => ({ data: [] })),
      Promise.resolve(
        sb
          .from("credentials")
          .select("professional_id, credential_type, credential_name")
          .in("professional_id", entityIds)
          .limit(200),
      ).catch(() => ({ data: [] })),
      gcids.length
        ? Promise.resolve(sb.from("gbp_categories").select("gcid, display_name").in("gcid", gcids)).catch(
            () => ({ data: [] }),
          )
        : Promise.resolve({ data: [] }),
      getCardActions({ data: { entityIds } }),
    ]);

    const scores = new Map(
      ((scoresRes.data ?? []) as Record<string, unknown>[]).map((row) => [String(row.entity_id), row]),
    );
    const labels = new Map(
      ((catsRes.data ?? []) as { gcid: string; display_name: string }[]).map((row) => [
        row.gcid,
        row.display_name,
      ]),
    );

    const byType = (id: string, type: string) =>
      ((nodesRes.data ?? []) as Record<string, unknown>[])
        .filter((node) => String(node.entity_id) === id && node.node_type === type)
        .map((node) => {
          const extracted = (node.extracted_data ?? {}) as Record<string, unknown>;
          return (
            trim(extracted.language) ??
            trim(extracted.name) ??
            trim(extracted.specialty) ??
            trim(node.title) ??
            ""
          );
        })
        .filter(Boolean);

    return docs.map((doc) => {
      const entityId = String(doc.entity_id);
      const scoreRow = scores.get(entityId);
      const components = ((scoreRow?.components ?? {}) as Record<string, unknown>) || {};
      const tableCreds = ((credsRes.data ?? []) as Record<string, unknown>[])
        .filter((row) => String(row.professional_id) === entityId)
        .map((row) => trim(row.credential_name) ?? trim(row.credential_type) ?? "")
        .filter(Boolean);
      return {
        id: String(doc.id),
        entityId,
        name: String(doc.name ?? ""),
        slug: (doc.slug as string | null) ?? null,
        entityType: String(doc.entity_type ?? ""),
        photoUrl: (doc.photo_url as string | null) ?? null,
        categoryLabel: doc.gcid ? labels.get(String(doc.gcid)) ?? null : null,
        location: [doc.city, doc.state].map((part) => trim(part)).filter(Boolean).join(", ") || null,
        rating: doc.rating === null ? null : Number(doc.rating),
        reviewCount: doc.review_count === null ? null : Number(doc.review_count),
        rankScore: doc.rank_score === null ? null : Number(doc.rank_score),
        score: scoreRow?.score === undefined || scoreRow?.score === null ? null : Number(scoreRow.score),
        band: (scoreRow?.band as string | null) ?? null,
        components: Object.entries(components)
          .filter(([, value]) => typeof value === "number" || typeof value === "string")
          .slice(0, 8)
          .map(([key, value]) => ({
            label: key.replace(/_/g, " "),
            value: String(value),
          })),
        specialties: byType(entityId, "specialty").slice(0, 8),
        languages: byType(entityId, "language").slice(0, 6),
        credentials: [...new Set([...tableCreds, ...byType(entityId, "credential")])].slice(0, 6),
        actions: actions[entityId] ?? { phone: null, website: null, email: null, address: null },
      };
    });
  });

/** "People also searched" — real taxonomy terms for the category in view. */
export const getRelatedSearches = createServerFn({ method: "GET" })
  .inputValidator((input: { gcid?: string } | undefined) => ({ gcid: input?.gcid ?? "" }))
  .handler(async ({ data }): Promise<{ terms: string[] }> => {
    if (!data.gcid) return { terms: [] };
    const sb = publicClient() as unknown as Any;
    const res = await Promise.resolve(
      sb
        .from("exp_taxonomy")
        .select("term_display, term, search_volume_monthly, use_srp, use_search, is_active, level")
        .eq("gcid", data.gcid)
        .eq("is_active", true)
        .order("search_volume_monthly", { ascending: false, nullsFirst: false })
        .limit(40),
    ).catch(() => ({ data: [] }));
    const terms = ((res.data ?? []) as Record<string, unknown>[])
      .filter((row) => row.use_srp !== false || row.use_search !== false)
      .map((row) => trim(row.term_display) ?? trim(row.term) ?? "")
      .filter(Boolean);
    return { terms: [...new Set(terms)].slice(0, 10) };
  });
