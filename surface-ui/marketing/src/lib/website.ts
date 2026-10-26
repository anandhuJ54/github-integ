import { api } from "@v3/ui/lib/server-fn";
import type { Json } from "@v3/ui/integrations/supabase/types";
import { blocksOf } from "@v3/ui/lib/public-site";

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

/* ───────────── Loaders (live reads only, through FastAPI /marketing/website) ───────────── */

const W = "/marketing/website";

export const loadPages = () => api.get<WebPage[]>(`${W}/pages`);

/** Pages in the Trash, newest deletion first. */
export const loadDeletedPages = () => api.get<WebPage[]>(`${W}/pages/trash`);

/** Templates in the Trash, newest deletion first. */
export const loadDeletedPageTemplates = () => api.get<WebPageTemplate[]>(`${W}/templates/trash`);

export const loadPageTemplates = () => api.get<WebPageTemplate[]>(`${W}/templates`);

export const loadForms = () => api.get<WebForm[]>(`${W}/forms`);

export const loadLeads = () => api.get<WebLead[]>(`${W}/leads`);

export const loadTrustItems = () => api.get<TrustItem[]>(`${W}/trust`);

export const loadConsent = () =>
  api.get<{ events: ConsentEvent[]; config: ConsentConfig | null }>(`${W}/consent`);

export const loadAlerts = () => api.get<WebAlert[]>(`${W}/alerts`);

export const loadAds = () => api.get<WebAd[]>(`${W}/ads`);

export const loadCampaigns = () => api.get<WebCampaign[]>(`${W}/campaigns`);

export const loadMedia = () => api.get<WebMedia[]>(`${W}/media`);

export const loadSellers = () => api.get<SellerOption[]>(`${W}/sellers`);

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

/* ───────────── Mutations (FastAPI /marketing/website; same statements, run as the signed-in user) ───────────── */

/** The old `run()`: resolves `true`, throws the database's message. */
const ok = (p: Promise<unknown>) => p.then(() => true as const);
const post = (path: string, body?: unknown) => ok(api.post(`${W}${path}`, body ?? {}));
const patch = (path: string, body: unknown) => ok(api.patch(`${W}${path}`, body));
const del = (path: string) => ok(api.delete(`${W}${path}`));

/** The columns a CMS page edit may send (updated_at is stamped by the server). */
export type WebPagePatch = Partial<
  Pick<WebPage, "title" | "slug" | "seo_title" | "seo_desc" | "body" | "design_tag" | "updated_by">
>;

export const webMutations = {
  /* CMS */
  createPage: (v: { title: string; slug: string; page_type: string; updated_by?: string | null }) =>
    post("/pages", { title: v.title, slug: v.slug, page_type: v.page_type, updated_by: v.updated_by ?? null }),
  updatePage: (id: string, patch_: WebPagePatch) =>
    patch(`/pages/${id}`, { ...patch_, design_tag: patch_.design_tag ?? undefined }),
  publishPage: (id: string, updated_by?: string | null) =>
    post(`/pages/${id}/publish`, { updated_by: updated_by ?? null }),
  unpublishPage: (id: string) => post(`/pages/${id}/unpublish`),
  /** Move a page to Trash (recoverable) rather than removing the row. */
  deletePage: (id: string, deleted_by?: string | null) =>
    post(`/pages/${id}/trash`, { deleted_by: deleted_by ?? null }),
  restorePage: (id: string) => post(`/pages/${id}/restore`),
  purgePage: (id: string) => del(`/pages/${id}`),
  duplicatePage: (p: WebPage, updated_by?: string | null) =>
    post("/pages/duplicate", {
      slug_base: slugify(`${p.slug ?? p.title ?? "page"}-copy`),
      title: `${p.title ?? "Untitled"} (copy)`,
      page_type: p.page_type ?? "page",
      body: (p.body ?? {}) as Json,
      seo_title: p.seo_title ?? null,
      seo_desc: p.seo_desc ?? null,
      design_tag: p.design_tag ?? undefined,
      updated_by: updated_by ?? null,
    }),
  setPageDesignTag: (id: string, design_tag: DesignTag) => patch(`/pages/${id}`, { design_tag }),

  /* Bulk CMS actions */
  bulkPublishPages: (ids: string[], updated_by?: string | null) =>
    post("/pages/bulk-publish", { ids, updated_by: updated_by ?? null }),
  bulkUnpublishPages: (ids: string[]) => post("/pages/bulk-unpublish", { ids }),
  bulkDeletePages: (ids: string[], deleted_by?: string | null) =>
    post("/pages/bulk-trash", { ids, deleted_by: deleted_by ?? null }),

  /* CMS templates */
  createPageTemplate: (v: {
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
  }) => api.post<WebPageTemplate>(`${W}/templates`, v),
  /** Point a page at a template (or clear the link with null). */
  setPageTemplate: (pageId: string, templateId: string | null) =>
    ok(api.put(`${W}/pages/${pageId}/template`, { template_id: templateId })),
  renamePageTemplate: (id: string, name: string) => patch(`/templates/${id}`, { name }),
  deletePageTemplate: (id: string, deleted_by?: string | null) =>
    post(`/templates/${id}/trash`, { deleted_by: deleted_by ?? null }),
  restorePageTemplate: (id: string) => post(`/templates/${id}/restore`),
  purgePageTemplate: (id: string) => del(`/templates/${id}`),
  createPageFromTemplate: (v: {
    title: string;
    page_type: string;
    body: Json;
    settings?: Record<string, unknown>;
    updated_by?: string | null;
  }) => {
    const settings = v.settings ?? {};
    return api.post<WebPage>(`${W}/pages/from-template`, {
      slug_base: slugify(v.title),
      title: v.title,
      page_type: v.page_type,
      body: v.body,
      seo_title: typeof settings.seo_title === "string" ? settings.seo_title : null,
      seo_desc: typeof settings.seo_desc === "string" ? settings.seo_desc : null,
      design_tag: settings.design_tag === "old_design" ? "old_design" : "new",
      updated_by: v.updated_by ?? null,
    });
  },
  applyPageTemplate: (pageId: string, body: Json, settings: Record<string, unknown>, updated_by?: string | null) =>
    patch(`/pages/${pageId}`, {
      body,
      seo_title: typeof settings.seo_title === "string" ? settings.seo_title : undefined,
      seo_desc: typeof settings.seo_desc === "string" ? settings.seo_desc : undefined,
      design_tag: settings.design_tag === "old_design" ? "old_design" : "new",
      updated_by: updated_by ?? null,
    }),
  appendSectionTemplate: (page: WebPage, body: Json, updated_by?: string | null) =>
    patch(`/pages/${page.id}`, {
      body: [...blocksOf(page.body), ...blocksOf(body)] as unknown as Json,
      updated_by: updated_by ?? null,
    }),

  /* Forms */
  createForm: (v: { name: string; slug: string; destination?: string | null; fields?: Json }) =>
    post("/forms", {
      name: v.name,
      slug: v.slug,
      destination: v.destination ?? null,
      fields: v.fields ?? ([] as unknown as Json),
    }),
  updateForm: (id: string, p: Partial<Pick<WebForm, "active">>) => patch(`/forms/${id}`, p),
  deleteForm: (id: string) => del(`/forms/${id}`),

  /* Leads */
  setLeadStatus: (id: string, status: LeadStatus) => patch(`/leads/${id}/status`, { status }),
  assignLead: (id: string, assigned_to: string | null) => patch(`/leads/${id}/assignee`, { assigned_to }),

  /* Trust */
  createTrustItem: (v: { category: string; title: string; body?: string | null; doc_url?: string | null }) =>
    post("/trust", { category: v.category, title: v.title, body: v.body ?? null, doc_url: v.doc_url ?? null }),
  updateTrustItem: (id: string, p: Partial<Pick<TrustItem, "category" | "title" | "body" | "doc_url" | "sort_order">>) =>
    patch(`/trust/${id}`, p),
  deleteTrustItem: (id: string) => del(`/trust/${id}`),

  /* Consent config */
  saveConsentConfig: (p: Partial<Omit<ConsentConfig, "id">>) => patch("/consent", p),

  /* Alerts */
  createAlert: (v: { alert_type: string; message: string }) =>
    post("/alerts", { alert_type: v.alert_type, message: v.message }),
  updateAlert: (id: string, p: Partial<Pick<WebAlert, "active">>) => patch(`/alerts/${id}`, p),
  deleteAlert: (id: string) => del(`/alerts/${id}`),

  /* Ads */
  createAd: (v: {
    name: string;
    placement: string;
    budget?: number | null;
    starts_on?: string | null;
    ends_on?: string | null;
    creative?: Json;
  }) =>
    post("/ads", {
      name: v.name,
      placement: v.placement,
      budget: v.budget ?? null,
      starts_on: v.starts_on || null,
      ends_on: v.ends_on || null,
      creative: v.creative ?? ({} as Json),
    }),
  updateAd: (id: string, p: Partial<Pick<WebAd, "status">>) => patch(`/ads/${id}`, p),
  deleteAd: (id: string) => del(`/ads/${id}`),

  /* Campaigns */
  createCampaign: (v: { name: string; cohort: string; channel: string; starts_on?: string | null }) =>
    post("/campaigns", { name: v.name, cohort: v.cohort, channel: v.channel, starts_on: v.starts_on || null }),
  updateCampaign: (id: string, p: Partial<Pick<WebCampaign, "status" | "assigned_profiles">>) =>
    patch(`/campaigns/${id}`, p),
  deleteCampaign: (id: string) => del(`/campaigns/${id}`),

  /* Media */
  createMedia: (v: {
    title: string;
    media_type: string;
    url: string;
    gated: boolean;
    form_slug?: string | null;
  }) =>
    post("/media", { title: v.title, media_type: v.media_type, url: v.url, gated: v.gated, form_slug: v.form_slug || null }),
  updateMedia: (id: string, p: Partial<Pick<WebMedia, "gated">>) => patch(`/media/${id}`, p),
  deleteMedia: (id: string) => del(`/media/${id}`),
};
