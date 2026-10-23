// ============================================================================
// State Farm agent page → deterministic deep-field extraction.
// The agent microsite is server-rendered and exposes JSON-LD (InsuranceAgency +
// Offer objects) plus stable class hooks for credentials, languages, hours,
// about-me bullets, photos and the "Our Team" roster. NO AI is used or needed.
// Pure functions only: safe to import from server routes and from scripts.
// ============================================================================

export type SfTeamMember = {
  name: string;
  role: string | null;
  license: string | null;
  description: string | null;
  photo_url: string | null;
  alias: string | null;
};

export type SfDeepFields = {
  detail_url: string;
  name: string | null;
  legal_name: string | null;
  short_bio: string | null;
  bio: string | null;
  about_me: string[];
  phone: string | null;
  toll_free: string | null;
  fax: string | null;
  website_url: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  logo: string | null;
  brand: string | null;
  area_served: string[];
  photo_url: string | null;
  cover_photo_url: string | null;
  products: { name: string; url: string | null; description: string | null }[];
  social: { platform: string; url: string }[];
  licenses: { raw: string; state: string | null; number: string; primary: boolean }[];
  languages: string[];
  office_hours: string[];
  office_hours_tz: string | null;
  gbp_place_id: string | null;
  team: SfTeamMember[];
  associate_id: string | null;
  field_count: number;
};

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/g, " ");

const clean = (s: string | null | undefined) =>
  s ? decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() || null : null;

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* skip malformed block — never guess */
    }
  }
  return out;
}

const typeList = (t: unknown): string[] =>
  Array.isArray(t) ? t.map(String) : typeof t === "string" ? [t] : [];

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  return null;
}

export function socialPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("facebook.")) return "Facebook";
  if (u.includes("instagram.")) return "Instagram";
  if (u.includes("linkedin.")) return "LinkedIn";
  if (u.includes("twitter.") || u.includes("x.com")) return "X";
  if (u.includes("yelp.")) return "Yelp";
  if (u.includes("youtube.")) return "YouTube";
  if (u.includes("tiktok.")) return "TikTok";
  if (u.includes("pinterest.")) return "Pinterest";
  if (u.includes("nextdoor.")) return "Nextdoor";
  if (u.includes("google.")) return "Google";
  return "Website";
}

function sectionSlice(html: string, startMarker: string, endMarkers: string[]): string {
  const i = html.indexOf(startMarker);
  if (i < 0) return "";
  let end = html.length;
  for (const em of endMarkers) {
    const j = html.indexOf(em, i + startMarker.length);
    if (j > -1 && j < end) end = j;
  }
  return html.slice(i, end);
}

function allMatches(re: RegExp, s: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = r.exec(s))) if (m[1] !== undefined) out.push(m[1]);
  return out;
}

function parseLicense(raw: string, primary: boolean) {
  const value = raw.trim();
  const m = /^([A-Z]{2})[-\s]?(.+)$/.exec(value);
  return {
    raw: value,
    state: m ? (m[1] as string) : null,
    number: m ? (m[2] as string).trim() : value,
    primary,
  };
}

export function parseStateFarmAgent(html: string, detailUrl: string): SfDeepFields {
  const ld = jsonLdBlocks(html);

  const agency = ld.find((o) => {
    const t = typeList((o as Record<string, unknown>)?.["@type"]);
    return t.some((x) => x === "InsuranceAgency" || x === "LocalBusiness" || x === "Organization");
  }) as Record<string, unknown> | undefined;

  const offers = ld.filter((o) =>
    typeList((o as Record<string, unknown>)?.["@type"]).includes("Offer"),
  ) as Record<string, unknown>[];

  const address = (agency?.["address"] ?? {}) as Record<string, unknown>;
  const geo = (agency?.["geo"] ?? {}) as Record<string, unknown>;
  const founder = (agency?.["founder"] ?? {}) as Record<string, unknown>;

  const sameAsRaw = Array.isArray(agency?.["sameAs"])
    ? (agency?.["sameAs"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
    : [];

  // --- credentials -----------------------------------------------------------
  const credSection = sectionSlice(html, 'id="credentials-section"', [
    'id="about-me-section"',
    'id="information-tabs-section"',
    "</section>\n</body>",
  ]);
  const licenses: SfDeepFields["licenses"] = [];
  const credRe =
    /<span class="credential-value"[^>]*data-credential-type="([^"]*)"[^>]*>([^<]*)<\/span>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = credRe.exec(credSection))) {
    const value = clean(cm[2] ?? "");
    if (!value) continue;
    licenses.push(parseLicense(value, (cm[1] ?? "") === "primary"));
  }

  // --- languages / hours / phones / website ---------------------------------
  const languages = Array.from(
    new Set(allMatches(/data-language-title="([^"]+)"/g, html).map((s) => clean(s) ?? "")),
  ).filter(Boolean);

  const hoursSection = sectionSlice(html, "-hours-section", ['-website-section', '-phone-section']);
  const officeHours = allMatches(/<span class="-oneX-body--primary"[^>]*>([\s\S]*?)<\/span>/g, hoursSection)
    .map((s) => clean(s) ?? "")
    .filter(Boolean);
  const tz = /data-abbr="([^"]+)"/.exec(hoursSection)?.[1] ?? null;

  const tollFree = clean(
    /data-phone-number-type="toll-free"[^>]*>([^<]*)</i.exec(html)?.[1] ?? null,
  );
  const fax =
    clean(/data-phone-number-type="fax"[^>]*>([^<]*)</i.exec(html)?.[1] ?? null) ??
    firstString(agency?.["faxNumber"]);
  const phone =
    firstString(agency?.["telephone"]) ??
    clean(/data-phone-number-type="primary"[^>]*>([^<]*)</i.exec(html)?.[1] ?? null);

  const redirect = /class="[^"]*redirect-url[^"]*"[^>]*>/.test(html)
    ? /<a[^>]*href="([^"]+)"[^>]*class="[^"]*redirect-url[^"]*"/i.exec(html)?.[1] ??
      /class="[^"]*redirect-url[^"]*"[^>]*href="([^"]+)"/i.exec(html)?.[1] ??
      null
    : null;
  const sameAsSite = sameAsRaw.find((u) => !/^https?:\/\//i.test(u));
  const websiteUrl =
    redirect ??
    (sameAsSite ? `https://${sameAsSite.replace(/^\/+/, "")}` : null) ??
    (typeof agency?.["url"] === "string" && !String(agency["url"]).includes("statefarm.com")
      ? String(agency["url"])
      : null);

  // --- about me -------------------------------------------------------------
  // The page renders the about-me list twice (desktop + mobile); dedupe by value.
  const aboutMe = Array.from(
    new Set(
      allMatches(/<ul class="about-me-list">([\s\S]*?)<\/ul>/g, html)
        .flatMap((block) => allMatches(/<li[^>]*>([\s\S]*?)<\/li>/g, block))
        .map((s) => clean(s) ?? "")
        .filter(Boolean),
    ),
  );

  // --- photos --------------------------------------------------------------
  const photo =
    firstString(founder["image"]) ??
    /https:\/\/[^"']*associate-photos\/[^"']*formalColorFull\.jpg/i.exec(html)?.[0] ??
    null;
  const cover =
    /https:\/\/[^"']*associate-photos\/[^"']*informalColorFull\.jpg/i.exec(html)?.[0] ?? null;
  const associateId =
    /associate-photos\/[^/]+\/([A-Z0-9]+)\//i.exec(photo ?? cover ?? "")?.[1] ?? null;

  // --- google place id -----------------------------------------------------
  const googleUrl = sameAsRaw.find((u) => u.toLowerCase().includes("google."));
  const placeId =
    (googleUrl && (/[?&](?:placeid|query_place_id)=([A-Za-z0-9_-]+)/i.exec(googleUrl)?.[1] ?? null)) ||
    /[?&](?:placeid|query_place_id)=([A-Za-z0-9_-]+)/i.exec(html)?.[1] ||
    null;

  // --- team roster ---------------------------------------------------------
  const teamSection = sectionSlice(html, 'id="our-team-section"', [
    'id="disclosures',
    'id="footer',
    '<footer',
  ]);
  const team: SfTeamMember[] = [];
  const cards = teamSection.split(/<div id="team-member-\d+"/).slice(1);
  const seenTeam = new Set<string>();
  for (const card of cards) {
    const name = clean(/class="[^"]*team-member__name[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(card)?.[1] ?? null);
    if (!name || seenTeam.has(name.toLowerCase())) continue;
    seenTeam.add(name.toLowerCase());
    team.push({
      name,
      role: clean(/class="[^"]*team-member__job-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(card)?.[1] ?? null),
      license: clean(/class="[^"]*team-member__credential[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(card)?.[1] ?? null),
      description: clean(
        /class="[^"]*team-member__description[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(card)?.[1] ?? null,
      ),
      photo_url: /<img[^>]*class="[^"]*team-member__photo[^"]*"[^>]*src="([^"]+)"/i.exec(card)?.[1] ?? null,
      alias: /^[^>]*data-alias="([^"]*)"/.exec(card)?.[1] ?? null,
    });
  }

  const areaServed = Array.isArray(agency?.["areaServed"])
    ? (agency?.["areaServed"] as unknown[]).map((x) =>
        typeof x === "string" ? x : String((x as Record<string, unknown>)?.["name"] ?? ""),
      ).filter(Boolean)
    : typeof agency?.["areaServed"] === "string"
      ? [agency["areaServed"] as string]
      : [];

  const fields: SfDeepFields = {
    detail_url: detailUrl,
    name: clean(/^(.*?)\s*-\s*State Farm/.exec(String(agency?.["name"] ?? ""))?.[1] ?? null) ??
      firstString(founder["name"]) ??
      clean(String(agency?.["name"] ?? "")),
    legal_name: clean(String(agency?.["name"] ?? "")),
    short_bio: clean(String(agency?.["description"] ?? "")),
    bio: aboutMe.length ? aboutMe.join(" · ") : clean(String(agency?.["description"] ?? "")),
    about_me: aboutMe,
    phone,
    toll_free: tollFree,
    fax,
    website_url: websiteUrl,
    street: clean(String(address["streetAddress"] ?? "")),
    city: clean(String(address["addressLocality"] ?? "")),
    state: clean(String(address["addressRegion"] ?? "")),
    postal_code: clean(String(address["postalCode"] ?? "")),
    latitude: typeof geo["latitude"] === "number" ? (geo["latitude"] as number) : null,
    longitude: typeof geo["longitude"] === "number" ? (geo["longitude"] as number) : null,
    logo: firstString(agency?.["logo"]),
    brand: firstString(agency?.["brand"]) ?? "State Farm",
    area_served: areaServed,
    photo_url: photo,
    cover_photo_url: cover,
    products: offers
      .map((o) => ({
        name: clean(String(o["name"] ?? "")) ?? "",
        url: firstString(o["url"]),
        description: clean(String(o["description"] ?? "")),
      }))
      .filter((p) => p.name),
    social: sameAsRaw
      .filter((u) => /^https?:\/\//i.test(u))
      .map((u) => ({ platform: socialPlatform(u), url: u })),
    licenses,
    languages,
    office_hours: officeHours,
    office_hours_tz: tz,
    gbp_place_id: placeId,
    team,
    associate_id: associateId,
    field_count: 0,
  };

  fields.field_count = countFields(fields);
  return fields;
}

const COUNTED_KEYS: (keyof SfDeepFields)[] = [
  "name",
  "short_bio",
  "bio",
  "about_me",
  "phone",
  "toll_free",
  "fax",
  "website_url",
  "street",
  "city",
  "state",
  "postal_code",
  "latitude",
  "longitude",
  "logo",
  "brand",
  "area_served",
  "photo_url",
  "cover_photo_url",
  "products",
  "social",
  "licenses",
  "languages",
  "office_hours",
  "office_hours_tz",
  "gbp_place_id",
  "team",
];

export function countFields(f: SfDeepFields): number {
  let n = 0;
  for (const k of COUNTED_KEYS) {
    const v = f[k];
    if (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "") n += 1;
  }
  return n;
}

export function parseOk(f: SfDeepFields): boolean {
  // A page parsed successfully when the JSON-LD agency object was found.
  return Boolean(f.name && f.city && f.state);
}
