import {
  collectAllCredentialTexts,
  collectAllSameAsUrls,
  ENTITY_TYPE_RE,
  extractJsonLdBlocks,
  formatUrl,
  jsonLdTypes,
  normalizeAddress,
  parseDocument,
  toCredential,
  toE164,
  toPlaceId,
  validateValue,
} from "@/routes/api/public/-disco-site-contract";
import { SAMEAS_PLATFORM_RULES } from "@/routes/api/public/sameas-domain-classifier";
import { classifyCredential } from "@/routes/api/public/credential-name-classifier";
import { looksBlocked } from "@/routes/api/public/disco-webscraper-worker";
import type {
  CandidateFacts,
  CredentialCandidate,
  OwnedCandidate,
  SameAsLink,
  TextBlock,
} from "./types";

/*
 * Pure: HTML → CandidateFacts. No network, no DB. Every parse step is Abdul's ETL code
 * (-disco-site-contract.ts JSON-LD reader + formats, sameas/credential classifiers); this
 * file only arranges their outputs into the interview's candidate shape. Nothing here is
 * category-specific.
 */

const TEXT_BLOCK_CAP = 150;
const TEXT_CHAR_CAP = 20_000;
const LINK_CAP = 300;
const CRED_CAP = 50;
/** Credential-ish labels in visible text (license numbers, registry ids). Generic, not per category. */
const CRED_TEXT_RE = /\b(lic(?:en[cs]e)?\.?\s*(?:#|no\b|num(?:ber)?\b)|nmls|crd|npn)/i;
/** Words that never identify an owner's domain on their own. */
const NAME_STOP = new Set([
  "the", "and", "for", "with", "inc", "llc", "ltd", "corp", "company", "group", "services",
  "official", "home", "site", "website", "online",
]);

type Obj = Record<string, unknown>;
type Cheerio = NonNullable<ReturnType<typeof parseDocument>["$"]>;

export type ParseOptions = {
  sourceUrl: string;
  resolvedUrl?: string | null;
  fetchedAt?: string;
  /** Known entity name (from the interview) — sharpens owned-domain matching. */
  entityName?: string | null;
  /** HTTP status of the fetch, for looksBlocked(). */
  statusCode?: number | null;
};

/** Host without "www.". */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Registrable domain (naive eTLD+1, with the common two-level ccTLD suffixes). */
export function registrableDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const sld = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  const twoLevel = tld.length === 2 && /^(co|com|net|org|gov|edu|ac)$/.test(sld);
  return parts.slice(twoLevel ? -3 : -2).join(".");
}

/** Absolute https URL; accepts scheme-less "www.example.com" values (common in sameAs). */
export function absoluteUrl(raw: string, pageUrl: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.startsWith("#") || /^(javascript|mailto|tel|sms):/i.test(s)) return null;
  const withScheme = /^(www\.|[a-z0-9-]+\.[a-z]{2,}(\/|$))/i.test(s) ? `https://${s}` : s;
  const u = formatUrl(withScheme, pageUrl);
  if (!u) return null;
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString();
  } catch {
    return null;
  }
}

/** Platform label for a URL from the sameAs platform rules (first urlTest that matches). */
export function platformOf(url: string): string | null {
  if (toPlaceId(url)) return "Google Business Profile";
  return SAMEAS_PLATFORM_RULES.find((r) => r.urlTest.test(url))?.label ?? null;
}

function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function nameTokens(...names: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names)
    for (const t of String(n ?? "").toLowerCase().split(/[^a-z0-9]+/))
      if (t.length >= 4 && !NAME_STOP.has(t)) out.add(t);
  return [...out];
}

const firstString = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) for (const x of v) { const s = firstString(x); if (s) return s; }
  return null;
};

/** The page's own entity: first object carrying NAP data, else the first entity-typed one. */
function pageEntity(objs: Obj[]): Obj | null {
  return (
    objs.find((o) => typeof o["name"] === "string" && (o["address"] != null || o["telephone"] != null)) ??
    objs.find((o) => jsonLdTypes(o).some((t) => ENTITY_TYPE_RE.test(t)) && typeof o["name"] === "string") ??
    null
  );
}

function textBlocks($: Cheerio): TextBlock[] {
  const out: TextBlock[] = [];
  const seen = new Set<string>();
  let chars = 0;
  const push = (kind: TextBlock["kind"], raw: string | undefined) => {
    const text = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text) || out.length >= TEXT_BLOCK_CAP || chars + text.length > TEXT_CHAR_CAP) return;
    if (kind === "paragraph" && text.length < 20) return;
    seen.add(text);
    chars += text.length;
    out.push({ kind, text });
  };
  push("title", $("title").first().text());
  for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[property="og:title"]'])
    push("meta", $(sel).attr("content"));
  $("h1,h2,h3").each((_, el) => push("heading", $(el).text()));
  $("p,li").each((_, el) => push("paragraph", $(el).text()));
  return out;
}

function credentialCandidates($: Cheerio | null, objs: Obj[]): CredentialCandidate[] {
  const out: CredentialCandidate[] = [];
  const seen = new Set<string>();
  const add = (text: string, via: CredentialCandidate["via"]) => {
    const t = text.replace(/\s+/g, " ").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k) || out.length >= CRED_CAP) return;
    seen.add(k);
    const hint = /\blic/i.test(t) ? "license" : /\b(nmls|crd|npn)\b/i.test(t) ? "registration" : undefined;
    const c = toCredential(t, hint);
    const cls = classifyCredential(t, [t]);
    out.push({
      text: t,
      parsed: c ? { ...c } : null,
      label: cls.recognized && cls.value ? (cls.label ?? null) : null,
      via,
    });
  };
  for (const t of collectAllCredentialTexts(objs)) add(t, "jsonld_hasCredential");
  if ($) {
    // Deepest short element whose text carries a license / registry label.
    $("body *").each((_, el) => {
      const node = $(el);
      const text = node.text().replace(/\s+/g, " ").trim();
      if (text.length > 160 || !CRED_TEXT_RE.test(text)) return;
      if (node.children().toArray().some((c) => CRED_TEXT_RE.test($(c).text()))) return;
      add(text, "page_text");
    });
  }
  return out;
}

/** HTML → CandidateFacts. Pure. */
export function parseCandidateFacts(html: string, opts: ParseOptions): CandidateFacts {
  const pageUrl = opts.resolvedUrl || opts.sourceUrl;
  const { $, objs } = parseDocument(html ?? "", pageUrl);
  const blocks = extractJsonLdBlocks(html ?? "");
  const entity = pageEntity(objs);

  // ---- NAP ----
  let name = firstString(entity?.["name"]);
  let nameSrc: string | null = name ? "jsonld" : null;
  if (!name && $) {
    name = $("meta[property='og:site_name']").attr("content")?.trim() || $("h1").first().text().replace(/\s+/g, " ").trim() || null;
    nameSrc = name ? "html" : null;
  }
  let address = normalizeAddress(entity?.["address"]);
  let addrSrc: string | null = address ? "jsonld" : null;
  if (!address && $) {
    const raw = $("address").first().text() || $('[itemprop="address"]').first().text();
    address = raw ? normalizeAddress(raw) : null;
    addrSrc = address ? "html" : null;
  }
  const rawPhone = firstString(entity?.["telephone"]);
  let phone = rawPhone ? toE164(validateValue("phone", rawPhone, pageUrl)) : null;
  let phoneSrc: string | null = phone ? "jsonld" : null;
  if (!phone && $) {
    const tel = $('a[href^="tel:"]').first().attr("href");
    phone = tel ? toE164(validateValue("phone", tel.replace(/^tel:/i, ""), pageUrl)) : null;
    phoneSrc = phone ? "tel_link" : null;
  }

  // ---- own domains ----
  const ownHosts = new Set([hostOf(opts.sourceUrl), hostOf(pageUrl)].filter((h): h is string => !!h));
  const ownRegistrable = new Set([...ownHosts].map(registrableDomain));
  const siteHome = pathDepth(pageUrl) <= 1;
  const tokens = nameTokens(opts.entityName, name, firstString(entity?.["legalName"]));

  // ---- sameAs + links ----
  const sameAs: SameAsLink[] = [];
  const sameAsSeen = new Set<string>();
  const owned: OwnedCandidate[] = [];
  const ownedSeen = new Set<string>();
  let placeId: string | null = null;
  const addOwned = (url: string, reason: OwnedCandidate["reason"]) => {
    const h = hostOf(url);
    if (!h || ownHosts.has(h)) return;
    if (ownedSeen.has(h)) return;
    ownedSeen.add(h);
    owned.push({ url, reason });
  };
  const external = (url: string, via: SameAsLink["via"]) => {
    placeId ??= toPlaceId(url);
    const platform = platformOf(url);
    if (platform || via === "jsonld_sameAs") {
      if (!sameAsSeen.has(url)) {
        sameAsSeen.add(url);
        sameAs.push({ url, platform, via });
      }
    }
    if (platform) return;
    const h = hostOf(url);
    if (!h) return;
    if (via === "jsonld_sameAs") return addOwned(url, "jsonld_sameAs");
    // Sibling subdomains are the entity's own only when this page is a site home; on a profile
    // hosted deep inside a larger site (a brand/platform directory) they belong to the host.
    if (ownRegistrable.has(registrableDomain(h))) {
      if (siteHome) addOwned(url, "brand_domain_match");
      return;
    }
    const hostLabels = h.split(".").slice(0, -1).join(".");
    if (tokens.some((t) => hostLabels.includes(t))) addOwned(url, "name_domain_match");
  };

  for (const raw of collectAllSameAsUrls(blocks)) {
    const u = absoluteUrl(raw, pageUrl);
    if (u) external(u, "jsonld_sameAs");
  }
  const internal: string[] = [];
  const internalSeen = new Set<string>();
  if ($) {
    $("a[href]").each((_, el) => {
      const u = absoluteUrl($(el).attr("href") ?? "", pageUrl);
      if (!u) return;
      const h = hostOf(u);
      if (h && ownHosts.has(h)) {
        if (!internalSeen.has(u) && internal.length < LINK_CAP) {
          internalSeen.add(u);
          internal.push(u);
        }
      } else external(u, "page_link");
    });
  }

  return {
    source_url: opts.sourceUrl,
    resolved_url: opts.resolvedUrl ?? null,
    fetched_at: opts.fetchedAt ?? new Date().toISOString(),
    jsonld: objs,
    nap: {
      name,
      address,
      phone,
      source: { name: nameSrc, address: addrSrc, phone: phoneSrc },
    },
    place_id: placeId,
    sameAs,
    credentials: credentialCandidates($, objs),
    links: { internal, ownedCandidates: owned },
    text: $ ? textBlocks($) : [],
    blocked: looksBlocked(opts.statusCode ?? 200, html ?? null),
  };
}
