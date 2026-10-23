import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { blocksOf } from "@/lib/public-site";

/* ───────────── Types (mirror exp_web_* tables) ───────────── */

export type PageType = "home" | "product" | "platform" | "trust" | "blog" | "landing" | "dev" | "page";
export const PAGE_TYPES: PageType[] = ["home", "product", "platform", "trust", "blog", "landing", "dev", "page"];

export type DesignTag = "old_design" | "new";
export const DESIGN_TAGS: DesignTag[] = ["old_design", "new"];
export const DESIGN_TAG_LABEL: Record<string, string> = {
  old_design: "Scott's OG templates",
  new: "Marketing designs",
};

export type WebPage = {
  id: string;
  slug: string | null;
  title: string | null;
  page_type: string | null;
  status: string | null;
  design_tag: string | null;
  body: Json;
  seo_title: string | null;
  seo_desc: string | null;
  published_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string | null;
  /** Coded pages: the real designed route (e.g. "/social"). */
  route_path: string | null;
  /** True when the layout is rendered by code, not by CMS blocks. */
  code_rendered: boolean | null;
  /** The template this page follows, when assigned. */
  template_id?: string | null;
  /** Set when the page is moved to Trash; null for live pages. */
  deleted_at?: string | null;
  deleted_by?: string | null;
};

export type WebPageTemplate = {
  id: string;
  name: string;
  template_kind: "page" | "section";
  source_page_id: string | null;
  source_page_title: string | null;
  body: Json;
  page_settings: Json;
  section_indexes: number[];
  design_tag: string;
  created_by: string;
  created_by_label: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
};

export type WebForm = {
  id: string;
  name: string | null;
  slug: string | null;
  fields: Json;
  destination: string | null;
  active: boolean | null;
  created_at: string | null;
};

export type LeadStatus = "new" | "contacted" | "qualified" | "ignored";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "ignored"];

export type WebLead = {
  id: string;
  form_slug: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  message: string | null;
  cohort: string | null;
  utm: Record<string, unknown> | null;
  status: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  first_touch: string | null;
  last_touch: string | null;
  created_at: string | null;
};

export type TrustItem = {
  id: string;
  category: string | null;
  title: string | null;
  body: string | null;
  doc_url: string | null;
  sort_order: number | null;
  updated_at: string | null;
};

export type ConsentEvent = {
  id: string;
  visitor_id: string | null;
  necessary: boolean | null;
  analytics: boolean | null;
  marketing: boolean | null;
  region: string | null;
  created_at: string | null;
};

export type ConsentConfig = {
  id: string;
  banner_enabled: boolean;
  banner_title: string;
  banner_message: string;
  analytics_default: boolean;
  marketing_default: boolean;
  policy_url: string | null;
};

export type WebAlert = {
  id: string;
  alert_type: string | null;
  message: string | null;
  active: boolean | null;
  created_at: string | null;
};

export type WebAd = {
  id: string;
  name: string | null;
  placement: string | null;
  creative: Json | null;
  status: string | null;
  starts_on: string | null;
  ends_on: string | null;
  budget: number | null;
  spend: number | null;
  created_at: string | null;
};

export type WebCampaign = {
  id: string;
  name: string | null;
  cohort: string | null;
  channel: string | null;
  status: string | null;
  assigned_profiles: number | null;
  starts_on: string | null;
  created_at: string | null;
};

export type WebMedia = {
  id: string;
  title: string | null;
  media_type: string | null;
  url: string | null;
  gated: boolean | null;
  form_slug: string | null;
  created_at: string | null;
};

export type SellerOption = { id: string; name: string; role: string | null };

/* ───────────── Loaders (live reads only) ───────────── */

const rows = <T,>(res: { data: unknown }) => (res.data ?? []) as T[];

export async function loadPages(): Promise<WebPage[]> {
  const res = await supabase
    .from("exp_web_pages")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  return rows<WebPage>(res);
}

/** Pages in the Trash, newest deletion first. */
export async function loadDeletedPages(): Promise<WebPage[]> {
  const res = await supabase
    .from("exp_web_pages")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(500);
  return rows<WebPage>(res);
}

/** Templates in the Trash, newest deletion first. */
export async function loadDeletedPageTemplates(): Promise<WebPageTemplate[]> {
  const res = await supabase
    .from("exp_web_page_templates")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  return rows<WebPageTemplate>(res);
}

export async function loadPageTemplates(): Promise<WebPageTemplate[]> {
  const res = await supabase
    .from("exp_web_page_templates")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return rows<WebPageTemplate>(res);
}

export async function loadForms(): Promise<WebForm[]> {
  const res = await supabase.from("exp_web_forms").select("*").order("created_at", { ascending: false });
  return rows<WebForm>(res);
}

export async function loadLeads(): Promise<WebLead[]> {
  const res = await supabase
    .from("exp_web_leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  return rows<WebLead>(res);
}

export async function loadTrustItems(): Promise<TrustItem[]> {
  const res = await supabase
    .from("exp_web_trust_items")
    .select("*")
    .order("sort_order", { ascending: true });
  return rows<TrustItem>(res);
}

export async function loadConsent(): Promise<{ events: ConsentEvent[]; config: ConsentConfig | null }> {
  const [ev, cfg] = await Promise.all([
    supabase.from("exp_web_consent_events").select("*").order("created_at", { ascending: false }).limit(1000),
    supabase.from("exp_web_consent_config").select("*").eq("id", "default").maybeSingle(),
  ]);
  return { events: rows<ConsentEvent>(ev), config: (cfg.data ?? null) as ConsentConfig | null };
}

export async function loadAlerts(): Promise<WebAlert[]> {
  const res = await supabase.from("exp_web_alerts").select("*").order("created_at", { ascending: false });
  return rows<WebAlert>(res);
}

export async function loadAds(): Promise<WebAd[]> {
  const res = await supabase.from("exp_web_ads").select("*").order("created_at", { ascending: false });
  return rows<WebAd>(res);
}

export async function loadCampaigns(): Promise<WebCampaign[]> {
  const res = await supabase.from("exp_web_campaigns").select("*").order("created_at", { ascending: false });
  return rows<WebCampaign>(res);
}

export async function loadMedia(): Promise<WebMedia[]> {
  const res = await supabase.from("exp_web_media").select("*").order("created_at", { ascending: false });
  return rows<WebMedia>(res);
}

export async function loadSellers(): Promise<SellerOption[]> {
  const res = await supabase
    .from("exp_sales_reps")
    .select("id, name, role")
    .order("name", { ascending: true })
    .limit(500);
  return rows<SellerOption>(res);
}

/* ───────────── Lead metrics + SLA ───────────── */

/** Hours a lead may sit unworked before it is "aging". */
export const SLA_HOURS = 24;

export function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms >= 0 ? ms / 36e5 : 0;
}

export function isUnworked(lead: WebLead) {
  return (lead.status ?? "new") === "new";
}

export function isAging(lead: WebLead) {
  const h = hoursSince(lead.created_at);
  return isUnworked(lead) && h !== null && h > SLA_HOURS;
}

export function slaLabel(lead: WebLead) {
  const h = hoursSince(lead.created_at);
  if (h === null) return "—";
  const left = SLA_HOURS - h;
  if (!isUnworked(lead)) return "worked";
  if (left <= 0) return `${Math.floor(-left)}h over SLA`;
  return `${Math.max(1, Math.ceil(left))}h left`;
}

export function leadTotals(leads: WebLead[]) {
  const total = leads.length;
  const news = leads.filter((l) => (l.status ?? "new") === "new").length;
  const contacted = leads.filter((l) => l.status === "contacted").length;
  const qualified = leads.filter((l) => l.status === "qualified").length;
  const ignored = leads.filter((l) => l.status === "ignored").length;
  const aging = leads.filter(isAging).length;
  const unassigned = leads.filter((l) => !l.assigned_to).length;
  return {
    total,
    news,
    contacted,
    qualified,
    ignored,
    aging,
    unassigned,
    conversionPct: total ? (qualified / total) * 100 : 0,
    ignoredPct: total ? (ignored / total) * 100 : 0,
  };
}

export function utmField(lead: WebLead, key: string): string | null {
  const utm = (lead.utm ?? {}) as Record<string, unknown>;
  const v = utm[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export type AttributionRow = { key: string; label: string; leads: number; qualified: number; ignored: number };

function groupBy(leads: WebLead[], pick: (l: WebLead) => string | null): AttributionRow[] {
  const map = new Map<string, AttributionRow>();
  for (const l of leads) {
    const key = pick(l) ?? "unattributed";
    const row = map.get(key) ?? { key, label: key, leads: 0, qualified: 0, ignored: 0 };
    row.leads += 1;
    if (l.status === "qualified") row.qualified += 1;
    if (l.status === "ignored") row.ignored += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

export function attribution(leads: WebLead[]) {
  return {
    channel: groupBy(leads, (l) => utmField(l, "utm_medium") ?? utmField(l, "medium") ?? l.first_touch),
    source: groupBy(leads, (l) => utmField(l, "utm_source") ?? utmField(l, "source") ?? l.last_touch),
    campaign: groupBy(leads, (l) => utmField(l, "utm_campaign") ?? utmField(l, "campaign")),
    form: groupBy(leads, (l) => l.form_slug),
    cohort: groupBy(leads, (l) => l.cohort),
  };
}

export function consentStats(events: ConsentEvent[]) {
  const total = events.length;
  const analytics = events.filter((e) => e.analytics).length;
  const marketing = events.filter((e) => e.marketing).length;
  return {
    total,
    analytics,
    marketing,
    analyticsPct: total ? (analytics / total) * 100 : 0,
    marketingPct: total ? (marketing / total) * 100 : 0,
  };
}

/** Where a CMS page lives on the public site. */
export function publicPathForPage(p: {
  page_type: string | null;
  slug: string | null;
  route_path?: string | null;
}) {
  if (p.route_path) return p.route_path;
  const slug = (p.slug ?? "").replace(/^\/+/, "");
  switch (p.page_type) {
    case "home":
      return "/";
    case "product":
      return `/product/${slug}`;
    case "platform":
      return `/platform/${slug}`;
    case "trust":
      return slug ? `/trust/${slug}` : "/trust";
    default:
      return `/${slug}`;
  }
}

export function slugify(v: string) {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ───────────── Mutations ───────────── */

async function run<T>(p: PromiseLike<{ error: { message: string } | null; data?: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(error.message);
  return true as unknown as T;
}

export const webMutations = {
  /* CMS */
  createPage: (v: { title: string; slug: string; page_type: string; updated_by?: string | null }) =>
    run(
      supabase.from("exp_web_pages").insert({
        title: v.title,
        slug: v.slug,
        page_type: v.page_type,
        status: "draft",
        body: {} as Json,
        updated_by: v.updated_by ?? null,
      }),
    ),
  updatePage: (id: string, patch: Partial<WebPage> & { updated_by?: string | null }) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({
          ...patch,
          design_tag: patch.design_tag ?? undefined,
          code_rendered: patch.code_rendered ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id),
    ),
  publishPage: (id: string, updated_by?: string | null) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: updated_by ?? null,
        })
        .eq("id", id),
    ),
  unpublishPage: (id: string) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", id),
    ),
  /** Move a page to Trash (recoverable) rather than removing the row. */
  deletePage: (id: string, deleted_by?: string | null) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({ deleted_at: new Date().toISOString(), deleted_by: deleted_by ?? null })
        .eq("id", id),
    ),
  restorePage: (id: string) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({ deleted_at: null, deleted_by: null, status: "draft" })
        .eq("id", id),
    ),
  purgePage: (id: string) => run(supabase.from("exp_web_pages").delete().eq("id", id)),
  duplicatePage: async (p: WebPage, updated_by?: string | null) => {
    const base = slugify(`${p.slug ?? p.title ?? "page"}-copy`);
    const { data: existing } = await supabase
      .from("exp_web_pages")
      .select("slug")
      .eq("page_type", p.page_type ?? "page")
      .like("slug", `${base}%`);
    const taken = new Set(((existing as { slug: string | null }[] | null) ?? []).map((r) => r.slug));
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    return run(
      supabase.from("exp_web_pages").insert({
        title: `${p.title ?? "Untitled"} (copy)`,
        slug,
        page_type: p.page_type ?? "page",
        status: "draft",
        body: (p.body ?? {}) as Json,
        seo_title: p.seo_title ?? null,
        seo_desc: p.seo_desc ?? null,
        design_tag: p.design_tag ?? undefined,
        updated_by: updated_by ?? null,
      }),
    );
  },
  setPageDesignTag: (id: string, design_tag: DesignTag) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({ design_tag, updated_at: new Date().toISOString() })
        .eq("id", id),
    ),

  /* Bulk CMS actions */
  bulkPublishPages: (ids: string[], updated_by?: string | null) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: updated_by ?? null,
        })
        .in("id", ids),
    ),
  bulkUnpublishPages: (ids: string[]) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .in("id", ids),
    ),
  bulkDeletePages: (ids: string[], deleted_by?: string | null) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({ deleted_at: new Date().toISOString(), deleted_by: deleted_by ?? null })
        .in("id", ids),
    ),

  /* CMS templates */
  createPageTemplate: async (v: {
    name: string;
    template_kind: "page" | "section";
    source_page_id: string;
    source_page_title: string;
    body: Json;
    page_settings: Json;
    section_indexes: number[];
    design_tag: string;
    created_by: string;
    created_by_label?: string | null;
  }) => {
    const { data, error } = await supabase
      .from("exp_web_page_templates")
      .insert(v)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as WebPageTemplate;
  },
  /** Point a page at a template (or clear the link with null). */
  setPageTemplate: (pageId: string, templateId: string | null) =>
    run(supabase.from("exp_web_pages").update({ template_id: templateId }).eq("id", pageId)),
  renamePageTemplate: (id: string, name: string) =>
    run(supabase.from("exp_web_page_templates").update({ name }).eq("id", id)),
  deletePageTemplate: (id: string, deleted_by?: string | null) =>
    run(
      supabase
        .from("exp_web_page_templates")
        .update({ deleted_at: new Date().toISOString(), deleted_by: deleted_by ?? null })
        .eq("id", id),
    ),
  restorePageTemplate: (id: string) =>
    run(supabase.from("exp_web_page_templates").update({ deleted_at: null, deleted_by: null }).eq("id", id)),
  purgePageTemplate: (id: string) =>
    run(supabase.from("exp_web_page_templates").delete().eq("id", id)),
  createPageFromTemplate: async (v: {
    title: string;
    page_type: string;
    body: Json;
    settings?: Record<string, unknown>;
    updated_by?: string | null;
  }) => {
    const base = slugify(v.title);
    const { data: existing } = await supabase.from("exp_web_pages").select("slug").like("slug", `${base}%`);
    const taken = new Set(((existing as { slug: string | null }[] | null) ?? []).map((r) => r.slug));
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    const settings = v.settings ?? {};
    const { data, error } = await supabase
      .from("exp_web_pages")
      .insert({
        title: v.title,
        slug,
        page_type: v.page_type,
        status: "draft",
        body: v.body,
        seo_title: typeof settings.seo_title === "string" ? settings.seo_title : null,
        seo_desc: typeof settings.seo_desc === "string" ? settings.seo_desc : null,
        design_tag: settings.design_tag === "old_design" ? "old_design" : "new",
        updated_by: v.updated_by ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as WebPage;
  },
  applyPageTemplate: (pageId: string, body: Json, settings: Record<string, unknown>, updated_by?: string | null) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({
          body,
          seo_title: typeof settings.seo_title === "string" ? settings.seo_title : undefined,
          seo_desc: typeof settings.seo_desc === "string" ? settings.seo_desc : undefined,
          design_tag: settings.design_tag === "old_design" ? "old_design" : "new",
          updated_by: updated_by ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pageId),
    ),
  appendSectionTemplate: (page: WebPage, body: Json, updated_by?: string | null) =>
    run(
      supabase
        .from("exp_web_pages")
        .update({
          body: [...blocksOf(page.body), ...blocksOf(body)] as unknown as Json,
          updated_by: updated_by ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", page.id),
    ),

  /* Forms */
  createForm: (v: { name: string; slug: string; destination?: string | null; fields?: Json }) =>
    run(
      supabase.from("exp_web_forms").insert({
        name: v.name,
        slug: v.slug,
        destination: v.destination ?? null,
        fields: v.fields ?? ([] as unknown as Json),
        active: true,
      }),
    ),
  updateForm: (id: string, patch: Partial<WebForm>) =>
    run(supabase.from("exp_web_forms").update(patch).eq("id", id)),
  deleteForm: (id: string) => run(supabase.from("exp_web_forms").delete().eq("id", id)),

  /* Leads */
  setLeadStatus: (id: string, status: LeadStatus) =>
    run(supabase.from("exp_web_leads").update({ status }).eq("id", id)),
  assignLead: (id: string, assigned_to: string | null) =>
    run(
      supabase
        .from("exp_web_leads")
        .update({ assigned_to, assigned_at: assigned_to ? new Date().toISOString() : null })
        .eq("id", id),
    ),

  /* Trust */
  createTrustItem: (v: { category: string; title: string; body?: string | null; doc_url?: string | null }) =>
    run(
      supabase.from("exp_web_trust_items").insert({
        category: v.category,
        title: v.title,
        body: v.body ?? null,
        doc_url: v.doc_url ?? null,
      }),
    ),
  updateTrustItem: (id: string, patch: Partial<TrustItem>) =>
    run(
      supabase
        .from("exp_web_trust_items")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id),
    ),
  deleteTrustItem: (id: string) => run(supabase.from("exp_web_trust_items").delete().eq("id", id)),

  /* Consent config */
  saveConsentConfig: (patch: Partial<ConsentConfig>) =>
    run(
      supabase
        .from("exp_web_consent_config")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", "default"),
    ),

  /* Alerts */
  createAlert: (v: { alert_type: string; message: string }) =>
    run(supabase.from("exp_web_alerts").insert({ alert_type: v.alert_type, message: v.message, active: true })),
  updateAlert: (id: string, patch: Partial<WebAlert>) =>
    run(supabase.from("exp_web_alerts").update(patch).eq("id", id)),
  deleteAlert: (id: string) => run(supabase.from("exp_web_alerts").delete().eq("id", id)),

  /* Ads */
  createAd: (v: {
    name: string;
    placement: string;
    budget?: number | null;
    starts_on?: string | null;
    ends_on?: string | null;
    creative?: Json;
  }) =>
    run(
      supabase.from("exp_web_ads").insert({
        name: v.name,
        placement: v.placement,
        budget: v.budget ?? null,
        starts_on: v.starts_on || null,
        ends_on: v.ends_on || null,
        creative: v.creative ?? ({} as Json),
        status: "draft",
        spend: 0,
      }),
    ),
  updateAd: (id: string, patch: Partial<WebAd>) =>
    run(supabase.from("exp_web_ads").update(patch).eq("id", id)),
  deleteAd: (id: string) => run(supabase.from("exp_web_ads").delete().eq("id", id)),

  /* Campaigns */
  createCampaign: (v: { name: string; cohort: string; channel: string; starts_on?: string | null }) =>
    run(
      supabase.from("exp_web_campaigns").insert({
        name: v.name,
        cohort: v.cohort,
        channel: v.channel,
        starts_on: v.starts_on || null,
        status: "draft",
        assigned_profiles: 0,
      }),
    ),
  updateCampaign: (id: string, patch: Partial<WebCampaign>) =>
    run(supabase.from("exp_web_campaigns").update(patch).eq("id", id)),
  deleteCampaign: (id: string) => run(supabase.from("exp_web_campaigns").delete().eq("id", id)),

  /* Media */
  createMedia: (v: {
    title: string;
    media_type: string;
    url: string;
    gated: boolean;
    form_slug?: string | null;
  }) =>
    run(
      supabase.from("exp_web_media").insert({
        title: v.title,
        media_type: v.media_type,
        url: v.url,
        gated: v.gated,
        form_slug: v.form_slug || null,
      }),
    ),
  updateMedia: (id: string, patch: Partial<WebMedia>) =>
    run(supabase.from("exp_web_media").update(patch).eq("id", id)),
  deleteMedia: (id: string) => run(supabase.from("exp_web_media").delete().eq("id", id)),
};
