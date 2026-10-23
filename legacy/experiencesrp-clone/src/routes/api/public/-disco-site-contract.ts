// ============================================================================
// disco site contract (v3) — universal keys + category taxonomy keys:
// learn (mapSite) + apply (harvest). Also the ONE JSON-LD reader used by the
// disco-ai-worker (extractJsonLdBlocks and the entity helpers below).
//
// The leading dash in the file name keeps it out of the file router.
//
// Pure functions: no DB access, no network. The SAME applySiteContract is used to
// validate rules while learning and to extract values during the harvest.
//
// cheerio is imported from 'cheerio/slim': the default entry pulls in undici
// (fromURL), which is Node-only network code. Parsing only needs `load`.
// ============================================================================
import { load } from 'cheerio/slim';
import { classifySameAs } from './sameas-domain-classifier';
import { classifyCredential } from './credential-name-classifier';

export type FieldType = 'text' | 'phone' | 'email' | 'url' | 'year' | 'number' | 'list' | 'address' | 'geo';
export type Subject = 'person' | 'location' | 'firm';
export type PrimarySubject = 'person' | 'location';

// Staging schema v1 (docs/ETL-Staging-Data-Schema.md, sections 3a-3d). These are
// the extraction types the mapper validates with; the staging write format of
// each static key is in STATIC_FORMATS below (section 4).
export const PERSON_KEYS = {
  name: 'text', first_name: 'text', last_name: 'text', job_title: 'text', headline: 'text',
  bio: 'text', photo_url: 'url', cover_photo_url: 'url', phone: 'phone', fax: 'phone', email: 'email',
  website: 'url', profile_url: 'url', street: 'text', city: 'text', state: 'text', postal_code: 'text',
  languages: 'list', license_number: 'text', license_type: 'text', license_state: 'text',
  credentials: 'list', services: 'list', specialties: 'list', service_areas: 'list',
  social_links: 'list', year_started: 'year', booking_url: 'url', team: 'list', education: 'list',
  awards: 'list', disclaimer: 'text', gbp_place_id: 'text', actions: 'list', videos: 'list', gallery: 'list',
  // Fix (work history, 2026-10-12): jobs the person has held, as the page lists them.
  work_history: 'list',
  // 3d helpers (mapper only, never written to staging).
  address_block: 'text', branch_name: 'text', registration_ids: 'list', licenses: 'list',
  years_experience: 'number',
} as const satisfies Record<string, FieldType>;

export const LOCATION_KEYS = {
  business_name: 'text', street: 'text', city: 'text', state: 'text', postal_code: 'text',
  latitude: 'number', longitude: 'number', phone: 'phone', fax: 'phone', email: 'email',
  website: 'url', description: 'text', logo_url: 'url', photo_url: 'url', hours: 'list',
  timezone: 'text', social_links: 'list', gbp_place_id: 'text', actions: 'list', videos: 'list', gallery: 'list',
  // 3d helper.
  address_block: 'text',
} as const satisfies Record<string, FieldType>;

export const FIRM_KEYS = {
  firm_name: 'text', legal_name: 'text', website: 'url', logo_url: 'url', phone_main: 'phone',
  fax: 'phone', email: 'email', street: 'text', city: 'text', state: 'text', postal_code: 'text',
  description: 'text', social_links: 'list',
  // 3d helper.
  address_block: 'text',
} as const satisfies Record<string, FieldType>;

/** Section 3d: helper ids used inside the mapper; never written to staging. */
export const HELPER_IDS = new Set<string>([
  'person.address_block', 'location.address_block', 'firm.address_block', 'person.branch_name',
  'person.registration_ids', 'person.licenses', 'person.years_experience',
]);

/** Section 4: staging write format of each static key. */
export type StaticFormat =
  | 'text' | 'phone' | 'email' | 'url' | 'state' | 'postal' | 'year' | 'number' | 'list'
  | 'credential_list' | 'link_list' | 'hours_list' | 'member_list' | 'place_id' | 'action_list'
  | 'award_list' | 'education_list' | 'video_list' | 'gallery_list';
const ADDRESS_FORMATS = { street: 'text', city: 'text', state: 'state', postal_code: 'postal' } as const;
export const STATIC_FORMATS: Record<string, StaticFormat> = (() => {
  const out: Record<string, StaticFormat> = {};
  for (const [subject, keys] of [['person', PERSON_KEYS], ['location', LOCATION_KEYS], ['firm', FIRM_KEYS]] as const) {
    for (const [k, t] of Object.entries(keys)) {
      const id = `${subject}.${k}`;
      if (HELPER_IDS.has(id)) continue;
      out[id] = (ADDRESS_FORMATS as Record<string, StaticFormat>)[k] ?? (t as StaticFormat);
    }
  }
  out['person.license_state'] = 'state';
  out['person.credentials'] = 'credential_list';
  out['person.team'] = 'member_list';
  out['location.hours'] = 'hours_list';
  out['person.gbp_place_id'] = 'place_id';
  out['location.gbp_place_id'] = 'place_id';
  out['person.actions'] = 'action_list';
  out['person.awards'] = 'award_list';
  for (const sj of ['person', 'location']) { out[`${sj}.videos`] = 'video_list'; out[`${sj}.gallery`] = 'gallery_list'; }
  out['person.education'] = 'education_list';
  out['location.actions'] = 'action_list';
  for (const s of ['person', 'location', 'firm']) out[`${s}.social_links`] = 'link_list';
  return out;
})();

/** Section 3: one-line meaning per id where the key name alone is ambiguous (locator prompt). */
export const FIELD_MEANINGS: Record<string, string> = {
  'person.name': 'full name only, without post-nominals (CFP, CEPA ...)',
  'person.first_name': 'only when the page shows it separately',
  'person.last_name': 'only when the page shows it separately',
  'person.job_title': 'one main title, the first one shown',
  'person.headline': 'tagline, when the page has one',
  'person.bio': "the person's own description",
  'person.photo_url': 'headshot',
  'person.cover_photo_url': 'banner image',
  'person.phone': "the person's line as shown on their page",
  'person.fax': 'personal fax (office fax is location.fax)',
  'person.website': "the person's own site, not the firm home page and not this profile page",
  'person.profile_url': 'this profile page',
  'person.license_number': 'main licence number',
  'person.license_type': 'main licence type',
  'person.license_state': 'main licence state',
  'person.credentials': 'designations, licences, registrations',
  'person.services': 'services / products / focus areas, as the site words them',
  'person.specialties': 'specialisations / audiences, when the site separates them from services',
  'person.service_areas': 'places served',
  'person.social_links': 'personal social profiles',
  'person.year_started': 'start year',
  'person.booking_url': 'appointment / contact link for this person',
  'person.team': "people on this person's team: their names (with role / licence / photo when shown); not services, tags or headings",
  'person.education': 'degrees / schools',
  'person.work_history': 'jobs the person has held, as the page lists them (title, employer, years); not services or skills',
  'person.awards': 'awards / recognitions',
  'person.disclaimer': 'compliance / disclosure line about this person',
  'person.years_experience': 'number of years of experience',
  'location.business_name': 'office / branch name',
  'location.website': 'office page',
  'location.photo_url': 'office photo',
  'location.hours': 'opening hours per day',
  'location.timezone': 'time zone as shown',
  'location.gbp_place_id': "the office's Google place id, from its Google Maps / Business Profile link (href)",
  'person.actions': "every call-to-action button / link for this person (get a quote, book, schedule, contact, call, text, demo …): one css rule selecting all of them, multi:true; not site navigation",
  'location.actions': "every call-to-action button / link for this office (get a quote, book, schedule, contact, call, text …): one css rule selecting all of them, multi:true; not site navigation",
  'person.videos': "videos of / by this person embedded or linked on the page (YouTube, Vimeo, Wistia … iframes, players, links): css selecting each video element, multi:true",
  'location.videos': "videos of / by this office embedded or linked on the page: css selecting each video element, multi:true",
  'person.gallery': "this person's photo gallery images (not the headshot, not logos or icons): css selecting each gallery image, multi:true",
  'location.gallery': "this office's photo gallery images (office, team, events; not logos or icons): css selecting each gallery image, multi:true",
  'person.gbp_place_id': "the person's own Google Business Profile place id, from a Google Maps / Business Profile link for this person (href), not the office's",
  'firm.firm_name': 'brand name',
  'firm.legal_name': 'registered company name',
  'firm.website': 'home page',
  'firm.phone_main': 'head-office line',
};

/** Person static keys (section 3a). Kept for disco-ai-worker. */
export const PERSON_IDENTITY_KEYS = Object.keys(PERSON_KEYS).filter((k) => !HELPER_IDS.has(`person.${k}`));

/** Staging schema v1 (replaces S4-0): identity ids = every section-3 static key. */
export function isIdentityId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATIC_FORMATS, id);
}

const KEYS_BY_SUBJECT: Record<Subject, Record<string, FieldType>> = {
  person: PERSON_KEYS, location: LOCATION_KEYS, firm: FIRM_KEYS,
};

export function fieldType(id: string): FieldType | null {
  const [s, k] = id.split('.');
  return (KEYS_BY_SUBJECT as Record<string, Record<string, FieldType>>)[s]?.[k] ?? null;
}

/** Every field id relevant to a primary subject (location primaries skip person ids). */
export function allFieldIds(primary: PrimarySubject): string[] {
  const subjects: Subject[] = primary === 'person' ? ['person', 'location', 'firm'] : ['location', 'firm'];
  return subjects.flatMap((s) => Object.keys(KEYS_BY_SUBJECT[s]).map((k) => `${s}.${k}`));
}

// ---------------------------------------------------------------------------
// Locators / contract shape
// ---------------------------------------------------------------------------
export type JsonLdLocator = {
  tier: 'jsonld';
  subject: Subject;
  types: string[];
  path: string[];
  /** Taxonomy keys: objects whose @type is listed here are tried first. */
  prefer?: string[];
  /** Fix 12c: shared multi-value property — keep only items containing one of these words. */
  item_words?: string[];
};
export type CssLocator = {
  tier: 'css';
  strategy: 'css' | 'label';
  css?: string;
  label?: string;
  attr?: 'content' | 'href' | 'src' | 'data-href' | 'action';
  multi?: boolean;
  item_words?: string[];
  /** C9: geo keys — one rule per coordinate, merged into one value. */
  pair?: { latitude: CssLocator; longitude: CssLocator };
  /** C14b: extras with multi — normalised nearest heading of the chosen container. */
  container_heading?: string;
  /** C14b: extras with multi — position of the chosen container among matched containers. */
  container_index?: number;
  /** Staging schema: decided at mapping — comma-separated parts in one element are separate entries. */
  split_commas?: boolean;
  /** Staging schema: structured entries — sub-key → css relative to each matched block (awards, education). */
  item_fields?: Record<string, string>;
};
/** Fix 8: a field computed from the same subject's address_block. */
export type AddressPart = 'city' | 'state' | 'postal_code' | 'street';
export type DerivedLocator = { tier: 'css'; derived_from: string; part: AddressPart };
/** Fix 12a/b: value decided by the sameAs / credential classifier. */
export type ClassifierLocator = {
  tier: 'classifier';
  classifier: 'sameas' | 'credential';
  label: string;
  /** Text handed to the classifier: `${node_slug} ${node_name}`. */
  match_text: string;
};
/** C1: a taxonomy key read from a universal field with the same schema.org meaning. */
export type AliasLocator = { tier: 'alias'; from: string };
export type Locator = JsonLdLocator | CssLocator | DerivedLocator | ClassifierLocator | AliasLocator;

export function isDerived(loc: Locator | undefined): loc is DerivedLocator {
  return !!loc && typeof (loc as DerivedLocator).derived_from === 'string';
}
export function isClassifier(loc: Locator | undefined): loc is ClassifierLocator {
  return !!loc && loc.tier === 'classifier';
}
export function isAlias(loc: Locator | undefined): loc is AliasLocator {
  return !!loc && loc.tier === 'alias';
}

/** C1: taxonomy role assigned by the locator call. */
export type TaxonomyRole = 'person' | 'branch' | 'firm' | 'own_page_url';

export type Rule = {
  id: string;
  strategy: 'css' | 'label';
  css?: string;
  label?: string;
  attr?: 'content' | 'href' | 'src' | 'data-href' | 'action';
  multi?: boolean;
  /** C9: geo keys — which coordinate this rule reads. */
  part?: 'latitude' | 'longitude';
  /** Staging schema: comma-separated parts in one element are separate entries (decided by the locator call). */
  split_commas?: boolean;
  /** Staging schema: structured entries — sub-key → css relative to each matched block. */
  item_fields?: Record<string, string>;
};

export type FieldSpec = {
  tier: 'jsonld' | 'css' | 'classifier' | 'alias';
  locator: Locator;
  type: FieldType;
  hits: number;
  samples: number;
  backup?: Locator;
  /** C10: rule carried over from the previous contract after re-validation. */
  kept_from_previous?: boolean;
  /** C11: firm rule accepted with note homepage_only (no sample has it; the value is read from the homepage). */
  homepage_only?: boolean;
};

export type UnmappedReason =
  | 'not_found_on_samples'
  | 'rule_failed_validation'
  | 'ambiguous_shared_property'
  | 'site_wide_value'
  | 'equals_person_name'
  | 'equals_address'
  | 'equals_person_photo';

export type TaxonomyFieldSpec = FieldSpec & {
  subject: Subject;
  /** Registry entity_scope the subject came from. */
  scope: string | null;
  /** C5: schema_property is potentialAction (tel:/mailto: accepted). */
  action?: boolean;
  /** C9: schema_property last segment is logo. */
  logo?: boolean;
};

/** C9: firm/brand profile learned once per site by the brand pass. */
export type FirmProfile = {
  values: Record<string, unknown>;
  sources: Record<string, 'jsonld' | 'chrome' | 'homepage'>;
  learned_at: string;
  /** C10: one entry per validated firm rule (cap 40). */
  diagnostics?: FirmDiagnostic[];
};

export type SiteContract = {
  version: 2 | 3;
  primary_subject: PrimarySubject;
  fields: Record<string, FieldSpec>;
  must_have: { required: string[]; ok: boolean; missing: string[] };
  /** Who owns the address: 'location' (harvest copies it to the person) or a distinct 'person' address. */
  address_owner: 'location' | 'person' | null;
  /**
   * Person contracts only: 'location' when the profile pages describe the person with a single
   * business-typed record (e.g. schema.org RealEstateAgent) and carry no Person record, so the
   * name must-have is met by location.business_name. Absent on all earlier contracts.
   */
  name_owner?: 'location' | null;
  /** Fix (rejected rules kept, 2026-10-22): a fixed field whose rule was rejected carries the rule, the samples where it
   *  found a value and why it was rejected. */
  unmapped: Array<{ id: string; reason: UnmappedReason; rule?: Omit<Rule, 'id'>; found?: number; samples?: number; why?: RejectedWhy }>;
  unkeyed: Array<{ label: string; sample: string }>;
  samples: string[];
  learned_at: string;
  taxonomy_fields?: Record<string, TaxonomyFieldSpec>;
  taxonomy_unmapped?: Array<{ slug: string; reason: UnmappedReason }>;
  taxonomy_duplicates?: string[][];
  taxonomy_candidates?: number;
  /** C1: roles assigned by the locator call ({ slug: role }), only where they differ from the default. */
  taxonomy_roles?: Record<string, TaxonomyRole>;
  /** C2: slug of the key meaning "this entity's own page URL on this site". */
  own_page_key?: string | null;
  /** Lowercased site/firm entity names from the homepage (saved for the harvest). */
  site_entity_names?: string[];
  /** Firm JSON-LD signatures (saved for the harvest, max 50). */
  firm_signatures?: string[];
  /** C9: brand pass result. */
  firm_profile?: FirmProfile;
  /** C14: extra fields (staging only), keyed by key without the 'extra.' prefix. */
  extra_fields?: Record<string, ExtraFieldSpec>;
  /** C14: extra candidates not kept (cap 40). */
  extra_dropped?: ExtraDropped[];
  /**
   * Staging schema step 2: static id → routes, in fill order. Single-value ids: the first route giving
   * a value is used when the page rule gives none. List ids: page values and every route are merged.
   */
  static_routes?: Record<string, StaticRoute[]>;
  /** Staging schema step 2: route candidates not kept, with the reason (cap 40). */
  static_routes_dropped?: StaticRouteDropped[];
  /** Staging schema step 3: text found identical on most sample pages (boilerplateKey), per static id. */
  boilerplate_values?: Record<string, string[]>;
  /** Staging schema: actions (actionKey) found on most sample pages — site navigation, not this entity's. */
  sitewide_actions?: Record<string, string[]>;
  /** Staging schema: video / image URLs found on most sample pages (site media, not this entity's). */
  sitewide_media?: Record<string, string[]>;
  /** Staging schema: harvest also scans the main content for embedded videos (set on new mappings). */
  media_scan?: boolean;
};

/**
 * Staging schema step 2 (section 5, fill order 2 and 3). Decided when the site is
 * mapped, applied by code at harvest:
 * - taxonomy: copy from 'tax.<slug>' keys with the same subject and schema.org
 *   property; for a single-value id the value is copied only when all non-empty
 *   values agree; list ids (and `merge`) take every value. `part` picks one part
 *   of a geo / address value.
 * - extra: copy from the extra 'key' (then removed from _extra).
 */
export type StaticRoute =
  | { kind: 'taxonomy'; from: string[]; part?: 'latitude' | 'longitude' | AddressPart; merge?: true }
  | { kind: 'extra'; from: string; source: 'name' | 'match' | 'sticky'; reason?: string; split_commas?: boolean };
export type StaticRouteDropped = { static_id: string; from: string; reason: string };

/** C14: an extra fact rule, with its label and where its key came from. */
export type ExtraFieldSpec = FieldSpec & {
  label: string;
  key_source: 'existing_extra' | 'registry_slug' | 'new';
  /** C14b: the AI's sample text (max 200 chars), used to re-check sticky extras. */
  sample?: string;
  /** C14c: up to 3 distinct example values from the samples (max 120 chars each). */
  examples?: string[];
  /** C14c: the matching call's one-sentence reason. */
  match_reason?: string;
  /** Extra key dictionary (2026-10-22): set on a key the mapper defined (key_source 'new'); saved once to
   *  exp_field_discovery (element_kind 'extra_key') and reused by every later map. */
  definition?: string;
  value_type?: ExtraValueType;
  subject?: ExtraSubject;
};
/** Extra key dictionary (2026-10-22): the staging schema's section-4 formats (same list as the DB check). */
export const EXTRA_VALUE_TYPES = ['text', 'phone', 'email', 'url', 'state', 'postal', 'year', 'number', 'place_id', 'list'] as const;
export type ExtraValueType = (typeof EXTRA_VALUE_TYPES)[number];
export const EXTRA_SUBJECTS = ['person', 'location', 'firm'] as const;
export type ExtraSubject = (typeof EXTRA_SUBJECTS)[number];
/** Fix (rejected rules kept, 2026-10-22): why a fixed-field rule was rejected in mergeCssRules. */
export type RejectedWhy =
  | 'incomplete_rule' | 'label_is_brand_name' | 'anchored_on_value' | 'site_chrome' | 'no_value_on_samples' | 'clashes_with_other_field';
export type RejectedRule = { rule?: Omit<Rule, 'id'>; found: number; samples: number; why: RejectedWhy };
export type ExtraDropReason =
  | 'static' | 'taxonomy' | 'duplicate_value' | 'site_wide_value' | 'chrome' | 'rule_failed_validation'
  | 'sample_mismatch' | 'low_support' | 'name_conflict';
export type ExtraDropped = {
  label: string;
  key?: string;
  reason: ExtraDropReason;
  match?: string;
  /** C14a: the proposed rule as validated (no id), for diagnosis of validation-type drops. */
  rule?: Omit<Rule, 'id'>;
  /** C14a: samples where the locator returned any non-empty value (before clash/chrome/site-wide checks). */
  found?: number;
  /** C14a: number of samples. */
  samples?: number;
};

export type Sample = { url: string; html: string; primary?: PrimarySubject };
export type ApplyOptions = {
  firmSignatures?: Set<string>;
  /** C1: learning-time subject per taxonomy id ('tax.<slug>'), role-adjusted. */
  taxSubjects?: Record<string, Subject>;
  /** C2: own-page key slug (exempt from the page's-own-URL rejection). */
  ownPageKey?: string | null;
  /** C5: taxonomy ids whose schema_property is potentialAction. */
  actionIds?: Set<string>;
  /** C9: taxonomy ids whose schema_property last segment is logo. */
  logoIds?: Set<string>;
  /** Fix (category-aware page check, 2026-10-06): person or place category; picks the page's own entity. */
  primary?: PrimarySubject;
};

// ---------------------------------------------------------------------------
// Parsing — each sample page is parsed ONCE per run (Fix 6, 2026-09-25).
// ---------------------------------------------------------------------------
let PARSE_CALLS = 0;
/** Number of cheerio parses performed so far (for tests / diagnostics). */
export function parseCallCount(): number { return PARSE_CALLS; }
function parseHtml(html: string): ReturnType<typeof load> {
  PARSE_CALLS++;
  return load(html ?? '');
}

/** A pre-parsed page: cheerio document + collected JSON-LD objects. */
export type ParsedDoc = { $: ReturnType<typeof load> | null; objs: Record<string, unknown>[] };

export function parseDocument(html: string, pageUrl = '', primary?: PrimarySubject): ParsedDoc {
  return {
    $: safe(() => parseHtml(html), null),
    // Fix (profile-page check, 2026-10-06): the page's own entity first (orderByPageTie).
    objs: safe(() => orderByPageTie(collectJsonLdObjects(html), html, pageUrl, primary), [] as Record<string, unknown>[]),
  };
}

const DOC_CACHE = new WeakMap<object, ParsedDoc>();
/** Parsed document for a sample, cached on the sample object. */
export function docOf(s: Sample): ParsedDoc {
  let d = DOC_CACHE.get(s);
  if (!d) { d = parseDocument(s.html, s.url, s.primary); DOC_CACHE.set(s, d); }
  return d;
}

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------
function normLines(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function cleanText(s: string, keepNewlines = false): string {
  const t = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
  return keepNewlines ? normLines(t) : t.replace(/\s+/g, ' ').trim();
}

function firstScalar(raw: unknown): string | number | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const v = firstScalar(r);
      if (v != null && String(v).trim() !== '') return v;
    }
    return null;
  }
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  return null;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

// Key-specific checks layered on top of the type check (Fix 2, 2026-09-25).
const US_STATES: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado',
  CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho',
  IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
  ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
  MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
  NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina',
  ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania',
  RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas',
  UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia',
  WI: 'wisconsin', WY: 'wyoming', DC: 'district of columbia', PR: 'puerto rico',
  GU: 'guam', VI: 'virgin islands', AS: 'american samoa', MP: 'northern mariana islands',
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([c, n]) => [n, c]));

function stateCode(s: string): string | null {
  const t = s.trim().replace(/\.$/, '');
  if (/^[a-z]{2}$/i.test(t) && US_STATES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_BY_NAME.get(t.toLowerCase().replace(/\s+/g, ' ')) ?? null;
}

const ZIP_RE = /\b(\d{5}(?:-\d{4})?)\b/;

function checkState(s: string): string | null {
  const whole = stateCode(s);
  if (whole) return whole;
  const parts = s.split(',').slice(1);
  const found = new Set<string>();
  for (const p of parts) {
    const seg = p.replace(ZIP_RE, '').replace(/\d+/g, '').trim();
    const c = stateCode(seg);
    if (c) found.add(c);
  }
  return found.size === 1 ? [...found][0] : null;
}

function plainCity(c: string): string | null {
  const t = c.trim().replace(/,$/, '').trim();
  return t.length >= 2 && t.length <= 40 && /^[A-Za-z .'\-]+$/.test(t) ? t : null;
}

function checkCity(s: string): string | null {
  const m = s.match(/^([^,\d]+),\s*([A-Za-z .]+?)\s+\d{5}(?:-\d{4})?\s*$/);
  if (m && stateCode(m[2])) return plainCity(m[1]);
  return plainCity(s);
}

// Fix 5 (2026-09-25): generic multi-line / comma-less address parsing.
const STATE_NAME_ALT = Object.values(US_STATES)
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/ /g, '\\s+'))
  .join('|');
const ST_GROUP = `([A-Za-z]{2}|${STATE_NAME_ALT})`;
const LINE_CITY_ST_ZIP = new RegExp(`^(.*?)[,\\s]+${ST_GROUP}[\\s,]+(\\d{5}(?:-\\d{4})?)$`, 'i');
const LINE_ST_ZIP = new RegExp(`^${ST_GROUP}[\\s,]+(\\d{5}(?:-\\d{4})?)$`, 'i');

type ParsedAddress = { city: string | null; state: string; zip: string };

/** Parse "City, ST 12345", "City ST 12345" or "City\nST 12345" (lines split on \n). */
export function parseAddress(s: string): ParsedAddress | null {
  const lines = String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const cityBefore = (i: number): string | null => {
    for (let j = i - 1; j >= 0; j--) { const c = plainCity(lines[j]); if (c) return c; }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_CITY_ST_ZIP);
    if (!m) continue;
    const st = stateCode(m[2]);
    if (!st) continue;
    const g1 = m[1].trim();
    const lastSeg = g1.split(',').map((x) => x.trim()).filter(Boolean).pop() ?? '';
    return { city: (g1 ? plainCity(lastSeg) : null) ?? cityBefore(i), state: st, zip: m[3] };
  }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_ST_ZIP);
    if (!m) continue;
    const st = stateCode(m[1]);
    if (!st) continue;
    return { city: cityBefore(i), state: st, zip: m[2] };
  }
  return null;
}

function checkByKey(key: string, s: string): string | null {
  switch (key) {
    case 'state': case 'city': case 'postal_code': {
      const p = parseAddress(s);
      const flat = s.replace(/\s*\n\s*/g, ' ').trim();
      if (key === 'state') return p?.state ?? checkState(flat);
      if (key === 'city') return p?.city ?? checkCity(flat);
      if (p?.zip) return p.zip;
      if (/^\d{5}(-\d{4})?$/.test(flat)) return flat;
      const m = flat.match(ZIP_RE);
      return m ? m[1] : null;
    }
    case 'license_state':
      return checkState(s.replace(/\s*\n\s*/g, ' ').trim());
    case 'name': case 'business_name': case 'firm_name': case 'branch_name':
    case 'first_name': case 'last_name': case 'legal_name':
      return s.length >= 2 && s.length <= 120 && !/\d/.test(s) ? s : null;
    case 'address_block':
      // Fix 8: the whole block must contain a US "ST ZIP" / "City, ST ZIP" line.
      return parseAddress(s) ? s : null;
    case 'job_title':
      return s.length >= 2 && s.length <= 120 && /[A-Za-z]/.test(s) ? s : null;
    default: return s;
  }
}

/** Key from a field id ('person.city' → 'city'); plain keys pass through. */
function keyOf(id?: string): string {
  if (!id) return '';
  const i = id.indexOf('.');
  return i >= 0 ? id.slice(i + 1) : id;
}

export const TAX_PREFIX = 'tax.';
export function isTaxId(id?: string): boolean {
  return !!id && id.startsWith(TAX_PREFIX);
}

/** C14: extra field ids are 'extra.<key>'. */
export const EXTRA_PREFIX = 'extra.';
export function isExtraId(id?: string): boolean {
  return !!id && id.startsWith(EXTRA_PREFIX);
}

const ADDRESS_KEYS = new Set(['city', 'state', 'postal_code', 'address_block']);

// Fix 8: derive one address part from an accepted address block.
const PHONE_LINE_RE = /^[+()\d\s.\-]+$/;
function streetFromBlock(block: string): string | null {
  const lines = String(block ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  let i = lines.findIndex((l) => { const m = l.match(LINE_CITY_ST_ZIP); return !!(m && stateCode(m[2])); });
  let cityIdx = -1;
  if (i >= 0) {
    const m = lines[i].match(LINE_CITY_ST_ZIP)!;
    const g1 = m[1].trim();
    const lastSeg = g1.split(',').map((x) => x.trim()).filter(Boolean).pop() ?? '';
    if (g1 && plainCity(lastSeg)) cityIdx = i;
  } else {
    i = lines.findIndex((l) => { const m = l.match(LINE_ST_ZIP); return !!(m && stateCode(m[1])); });
    if (i < 0) return null;
  }
  if (cityIdx < 0) {
    for (let j = i - 1; j >= 0; j--) if (plainCity(lines[j])) { cityIdx = j; break; }
    if (cityIdx < 0) return null;
  }
  const cand = lines[cityIdx - 1];
  if (!cand) return null;
  if (PHONE_LINE_RE.test(cand) || cand.replace(/\D/g, '').length >= 10) return null;
  return /\d+\s*[A-Za-z]/.test(cand) ? cand : null;
}

export function deriveAddressPart(block: unknown, part: AddressPart): string | null {
  if (typeof block !== 'string') return null;
  if (part === 'street') return streetFromBlock(block);
  const p = parseAddress(block);
  if (!p) return null;
  return part === 'city' ? p.city : part === 'state' ? p.state : p.zip;
}

/** C3: North American toll-free area codes. */
const TOLL_FREE_AREAS = new Set(['800', '833', '844', '855', '866', '877', '888']);
function slugSaysTollFree(fieldId: string): boolean {
  const t = ` ${fieldId.slice(TAX_PREFIX.length).toLowerCase().replace(/[_\-.]+/g, ' ')} `;
  return / toll ?free /.test(t) || / tollfree /.test(t);
}
export function isTollFreeNumber(v: string): boolean {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 && TOLL_FREE_AREAS.has(d.slice(0, 3));
}

export type ValidateFlags = { action?: boolean };

export function validateValue(
  type: FieldType,
  raw: unknown,
  pageUrl: string,
  fieldId?: string,
  flags: ValidateFlags = {},
): unknown {
  // C5: taxonomy URLs — fragment-only and javascript: are not values; actions accept tel:/mailto:.
  if (type === 'url' && isTaxId(fieldId)) {
    const s0 = firstScalar(raw);
    const s = s0 == null ? '' : cleanText(String(s0));
    if (!s || s.startsWith('#') || /^javascript:/i.test(s)) return null;
    // C8: URL-shaped only — no whitespace or | < > " { } in the raw value, no bare words.
    const rawT = String(s0).trim();
    if (/[\s|<>"{}]/.test(rawT)) return null;
    if (/^(tel|mailto):/i.test(rawT)) return flags.action ? rawT : null;
    if (!/^(https?:\/\/|\/\/|\/|\.\/|\.\.\/|\?)/i.test(rawT)) return null;
  }
  const v0 = validateByType(type, raw, pageUrl);
  if (v0 == null || typeof v0 !== 'string') return v0;
  // C3: a toll-free phone key must hold a toll-free number.
  if (type === 'phone' && isTaxId(fieldId) && slugSaysTollFree(fieldId!) && !isTollFreeNumber(v0)) return null;
  const key = isTaxId(fieldId) ? '' : keyOf(fieldId);
  // Newlines survive only until key validation; address keys parse them.
  const flat = v0.includes('\n') ? v0.replace(/\s*\n\s*/g, ' ').trim() : v0;
  if (!key) return flat;
  try { return checkByKey(key, ADDRESS_KEYS.has(key) ? v0 : flat); } catch { return null; }
}

export type StructuredAddress = {
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
  text: string;
};

/** Street from a single-line address: the segments before the city segment. */
function singleLineStreet(flat: string, city: string | null): string | null {
  if (!city) return null;
  const segs = flat.split(',').map((x) => x.trim()).filter(Boolean);
  const i = segs.findIndex((s) => s.toLowerCase() === city.toLowerCase() || s.toLowerCase().startsWith(city.toLowerCase() + ' '));
  if (i <= 0) return null;
  const st = segs.slice(0, i).join(', ');
  return /\d+\s*[A-Za-z]/.test(st) && !PHONE_LINE_RE.test(st) ? st : null;
}

/** C9: remove a trailing phone number (a phone-shaped run that validates as a phone). */
const TRAILING_PHONE_RE = /(^|[\s,;|•·])(?:(?:phone|tel|ph|p|t)\.?:?\s*)?(\+?1?[\s.\-]?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})\s*$/i;
export function stripTrailingPhone(s: string): string {
  const m = s.match(TRAILING_PHONE_RE);
  if (!m) return s;
  let d = m[2].replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return s;
  return s.slice(0, m.index! + m[1].length).replace(/[\s,;|•·\-]+$/, '').trim();
}

/**
 * Fix (office block, 2026-10-12): one text that reads "[branch name] house-number street [suite] city ST ZIP phone"
 * (e.g. a "Branch information" block kept as an extra) -> its parts. Exactly one phone, at the end; the street starts
 * with a house number; the city is the branch name repeated at the end, the part after the last comma, or the words
 * after the first street-type word (+ suite). Anything else -> null (no guessing).
 */
const OFFICE_TAIL_RE = new RegExp(`^(.*?)[,\\s]+${ST_GROUP}[\\s,]+(\\d{5}(?:-\\d{4})?)$`, 'i');
const STREET_END_RE = /\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|way|parkway|pkwy|plaza|plz|lane|ln|court|ct|place|pl|highway|hwy|circle|cir|terrace|ter|pike|trail|trl|square|sq|crossing|expressway|expy|freeway|fwy|turnpike|tpke)\.?(?:\s+(?:n|s|e|w|ne|nw|se|sw)\.?)?(?:\s*,?\s*(?:suite|ste|unit|apt|bldg|building|floor|fl|rm|room|#)\.?\s*#?\s*[\w-]+)*(?=\s|,|$)/i;
export function parseOfficeBlock(raw: string): { street: string; city: string; state: string; postal_code: string; phone: string } | null {
  const text = cleanText(String(raw ?? '')).replace(/\s+/g, ' ').trim();
  if (!text || text.length > 300) return null;
  const m = text.match(TRAILING_PHONE_RE);
  if (!m) return null;
  let d = m[2].replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  const rest = text.slice(0, m.index! + m[1].length).replace(/[\s,;|•·\-]+$/, '').trim();
  if (/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/.test(rest)) return null; // a second number: not one office block
  const t = rest.match(OFFICE_TAIL_RE);
  if (!t) return null;
  const state = stateCode(t[2]);
  if (!state) return null;
  let body = t[1].replace(/[,\s]+$/, '').trim();
  const firstNum = body.search(/\d/);
  if (firstNum < 0) return null;
  const lead = body.slice(0, firstNum).replace(/[\s,\-–—:|]+$/, '').trim();
  body = body.slice(firstNum);
  if (!/^\d+[A-Za-z]?\s+[A-Za-z]/.test(body)) return null;
  const leadCity = (lead.split(/\s[-–—|:]\s/).pop() ?? '').trim();
  let street = '';
  let city = '';
  if (leadCity && body.toLowerCase().endsWith(' ' + leadCity.toLowerCase())) {
    city = leadCity;
    street = body.slice(0, body.length - leadCity.length);
  } else if (body.includes(',')) {
    const i = body.lastIndexOf(',');
    street = body.slice(0, i);
    city = body.slice(i + 1);
  } else {
    const e = body.match(STREET_END_RE);
    if (!e || e.index == null) return null;
    street = body.slice(0, e.index + e[0].length);
    city = body.slice(e.index + e[0].length);
  }
  street = street.replace(/[,\s]+$/, '').trim();
  const c = plainCity(city);
  if (!c || street.length < 5) return null;
  return { street, city: c, state, postal_code: t[3], phone: d };
}

/** C6: normalise a PostalAddress object or an address string into a structured address. */
export function normalizeAddress(raw: unknown): StructuredAddress | null {
  try {
    let v: unknown = raw;
    if (Array.isArray(v)) v = v.find((x) => x != null && (typeof x === 'object' || String(x).trim() !== ''));
    if (v == null) return null;
    const out: StructuredAddress = { text: '' };
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const str = (k: string): string => {
        const x = o[k];
        if (typeof x === 'string' || typeof x === 'number') return cleanText(String(x));
        if (x && typeof x === 'object' && typeof (x as LdObj)['name'] === 'string') return cleanText(String((x as LdObj)['name']));
        return '';
      };
      const street = str('streetAddress');
      const city = str('addressLocality');
      const region = str('addressRegion');
      const zip = str('postalCode');
      const country = str('addressCountry');
      if (street) out.streetAddress = street;
      const c = city ? checkCity(city) : null;
      if (c) out.addressLocality = c;
      const r = region ? checkState(region) : null;
      if (r) out.addressRegion = r;
      const z = zip.match(ZIP_RE);
      if (z) out.postalCode = z[1];
      if (country) out.addressCountry = country;
      const tail = [region, zip].filter(Boolean).join(' ');
      out.text = [street, city, tail, country].filter(Boolean).join(', ');
      if (!out.text && typeof o['name'] === 'string') out.text = cleanText(String(o['name']));
    } else if (typeof v === 'string' || typeof v === 'number') {
      const block = stripTrailingPhone(cleanText(String(v), true));
      const flat = stripTrailingPhone(block.replace(/\s*\n\s*/g, ', ').replace(/,\s*,/g, ',').trim());
      out.text = flat;
      const p = parseAddress(block) ?? parseAddress(flat);
      if (p) {
        const street = streetFromBlock(block) ?? singleLineStreet(flat, p.city);
        if (street) out.streetAddress = street;
        if (p.city) out.addressLocality = p.city;
        if (p.state) out.addressRegion = p.state;
        if (p.zip) out.postalCode = p.zip;
      }
    } else return null;
    if (out.text.length < 5) return null;
    return out;
  } catch {
    return null;
  }
}

/** C9: a { latitude, longitude } pair; one coordinate alone is rejected. */
export function normalizeGeo(raw: unknown): { latitude: number; longitude: number } | null {
  try {
    let v: unknown = raw;
    if (Array.isArray(v)) v = v.find((x) => x != null);
    if (v == null) return null;
    let lat: unknown; let lng: unknown;
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      lat = o['latitude'] ?? o['lat'];
      lng = o['longitude'] ?? o['lng'] ?? o['lon'];
    } else {
      const nums = String(v).match(/-?\d+(?:\.\d+)?/g) ?? [];
      if (nums.length !== 2) return null;
      [lat, lng] = nums;
    }
    const num = (x: unknown): number | null => {
      if (typeof x === 'number') return Number.isFinite(x) ? x : null;
      if (typeof x !== 'string') return null;
      const m = x.trim().match(/^-?\d+(?:\.\d+)?$/);
      return m ? Number(m[0]) : null;
    };
    const la = num(firstScalar(lat) ?? lat);
    const lo = num(firstScalar(lng) ?? lng);
    if (la == null || lo == null) return null;
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
    return { latitude: la, longitude: lo };
  } catch {
    return null;
  }
}

/** C11/C12: separator characters that can trail a multi-part text value. */
const SEP_CLASS = ',;:\\-\\u2013\\u2014/|&';
/** C12: one or more trailing separators (+ surrounding whitespace). */
const TRAILING_SEP_RE = new RegExp(`[${SEP_CLASS}]+\\s*$`);
/** C12: a separator at the very end of a text part (join continues past it). */
const PART_SEP_RE = new RegExp(`[${SEP_CLASS}]\\s*$`);
/** C12: strip trailing separator(s) and surrounding whitespace from a text value. */
export function stripTrailingSeparator(s: string): string {
  return String(s ?? '').replace(TRAILING_SEP_RE, '').trim();
}
/**
 * C12: join the texts of several matched elements (document order) with a
 * single space while each part ends with a separator; the first part without
 * a trailing separator is included as the last part. Cap: 10 parts, 2000 chars.
 */
export function joinParts(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (out.length >= 10) break;
    const t = p.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    out.push(t);
    if (!PART_SEP_RE.test(t)) break;
  }
  return out.join(' ').slice(0, 2000);
}
/** C11/C12: a text value ending with an opening bracket, or only punctuation, is cut off. */
const CUT_OFF_END_RE = /[(\[{<]$/;
const ONLY_PUNCT_RE = /^[\p{P}\p{S}\s]+$/u;
export function isCutOffText(s: string): boolean {
  const t = String(s ?? '').trim();
  if (!t) return false;
  return CUT_OFF_END_RE.test(t) || ONLY_PUNCT_RE.test(t);
}

// ---------------------------------------------------------------------------
// Station 5: not-found pages
// ---------------------------------------------------------------------------

/** Phrases a "page not found" answer uses (apostrophes straight or curly). */
const NOT_FOUND_PHRASE_RE = new RegExp(
  [
    'page not found',
    'page cannot be found',
    "(?:can['’]t|cannot|could['’]n['’]?t|could not) find the page",
    'could not be found',
    'no longer available',
    'no longer exists',
    'page you requested does not exist',
    "does(?:['’]?n['’]?t| not) exist",
    'error\\s*404',
  ].join('|'),
  'i',
);
/** A bare "404" counts only as a standalone word, and only in title / first h1. */
const STANDALONE_404_RE = /(?:^|[\s\p{P}])404(?:$|[\s\p{P}])/u;

function collectNotFoundStrings(v: unknown, out: string[]): void {
  if (v == null) return;
  if (typeof v === 'string' || typeof v === 'number') { out.push(String(v)); return; }
  if (Array.isArray(v)) { for (const x of v) collectNotFoundStrings(x, out); return; }
  if (typeof v === 'object' && typeof (v as Record<string, unknown>)['text'] === 'string') {
    out.push((v as Record<string, unknown>)['text'] as string);
  }
}

/**
 * Station 5: true when a normal 200 page reads as a "not found" message —
 * the page title, the first heading, or the harvested entity name matches a
 * not-found phrase. Such pages must not be staged as records.
 */
export function looksNotFound(html: string, values: Record<string, unknown>): boolean {
  let title = '';
  let firstH1 = '';
  try {
    const $ = load(html);
    title = (($('head title').first().text() || $('title').first().text() || '')).replace(/\s+/g, ' ').trim();
    firstH1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  } catch {
    return false;
  }
  for (const t of [title, firstH1]) {
    if (!t) continue;
    if (NOT_FOUND_PHRASE_RE.test(t) || STANDALONE_404_RE.test(t)) return true;
  }
  for (const id of ['person.name', 'location.business_name']) {
    const strs: string[] = [];
    collectNotFoundStrings(values[id], strs);
    if (strs.some((s) => NOT_FOUND_PHRASE_RE.test(s))) return true;
  }
  return false;
}

/** C11: selectors that select by text content. */
const TEXT_PSEUDO_RE = /:(?:-soup-)?contains\(|:has-text\(/i;
const anchorNorm = (x: string) => x.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
function anchorStrings(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(anchorStrings);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['text'] === 'string') return [o['text'] as string];
    return Object.values(o).flatMap(anchorStrings);
  }
  return [];
}
function locatorSelectorTexts(loc: CssLocator): string[] {
  if (loc.pair) return [...locatorSelectorTexts(loc.pair.latitude), ...locatorSelectorTexts(loc.pair.longitude)];
  return [loc.css, loc.label].filter((x): x is string => typeof x === 'string' && x !== '');
}
/** C11: a rule selecting by text (:contains etc.), or whose selector/label contains the value it extracts (6+ chars). */
export function isValueAnchored(loc: CssLocator, vals: unknown[] = []): boolean {
  const texts = locatorSelectorTexts(loc);
  if (texts.some((t) => TEXT_PSEUDO_RE.test(t))) return true;
  const norms = texts.map(anchorNorm).filter(Boolean);
  if (!norms.length) return false;
  for (const v of vals) {
    for (const str of anchorStrings(v)) {
      const n = anchorNorm(str);
      if (n.length >= 6 && norms.some((t) => t.includes(n))) return true;
    }
  }
  return false;
}

function validateByType(type: FieldType, raw: unknown, pageUrl: string): unknown {
  try {
    if (type === 'address') return normalizeAddress(raw);
    if (type === 'geo') return normalizeGeo(raw);
    if (type === 'list') {
      const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of arr) {
        if (out.length >= 50) break;
        if (typeof item !== 'string' && typeof item !== 'number') continue;
        // C12: a trailing separator is stripped and the item kept; punctuation-only items drop.
        const t = stripTrailingSeparator(cleanText(String(item)));
        if (!t || t.length > 300 || isCutOffText(t)) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
      }
      return out.length >= 1 ? out : null;
    }
    const v = firstScalar(raw);
    if (v == null) return null;
    if (type === 'number' || type === 'year') {
      let n: number;
      if (typeof v === 'number') n = v;
      else {
        const m = cleanText(v).match(/\d+(?:\.\d+)?/);
        if (!m) return null;
        n = Number(m[0]);
      }
      if (!Number.isFinite(n)) return null;
      if (type === 'year' && (!Number.isInteger(n) || n < 1800 || n > 2100)) return null;
      return n;
    }
    const s = cleanText(String(v), type === 'text');
    if (type === 'phone') {
      const t = s.replace(/^tel:/i, '').trim();
      return t.replace(/\D/g, '').length >= 10 ? t : null;
    }
    if (type === 'email') {
      const t = s.replace(/^mailto:/i, '').split('?')[0].trim();
      return EMAIL_RE.test(t) ? t : null;
    }
    if (type === 'url') {
      if (!s) return null;
      const u = new URL(s, pageUrl);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    }
    // text
    // C12: a trailing separator is stripped and the value kept; an opening
    // bracket or punctuation-only value is still rejected.
    const t0 = stripTrailingSeparator(s);
    if (isCutOffText(t0)) return null;
    return t0.length >= 2 && t0.length <= 2000 ? t0 : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSON-LD tier
// ---------------------------------------------------------------------------
type LdObj = Record<string, unknown>;

// Extract every application/ld+json block on a page as parsed JSON (skips ones
// that fail to parse). This is the only JSON-LD parser in the codebase.
export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  // Fix 15: type with optional quotes / whitespace; body trimmed before parse.
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? ''))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* skip malformed block */
    }
  }
  return out;
}

// Recursively search a parsed JSON value for a key matching `target` (exact match).
// Returns the first match's value and the path (array of string/number keys) to reach it, or null.
export function deepFindKey(
  obj: unknown,
  target: string,
  path: (string | number)[] = [],
): { value: unknown; path: (string | number)[] } | null {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const found = deepFindKey(obj[i], target, [...path, i]);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === target) return { value: v, path: [...path, k] };
      const found = deepFindKey(v, target, [...path, k]);
      if (found) return found;
    }
  }
  return null;
}

// Entity-like schema.org @type. Deliberately broad regex so it works for any
// vertical's schema.org type.
export const ENTITY_TYPE_RE =
  /person|organization|localbusiness|professionalservice|financialservice|attorney|medicalbusiness|store|corporation/i;

export function jsonLdTypes(obj: Record<string, unknown>): string[] {
  const t = obj['@type'];
  return typeof t === 'string' ? [t] : Array.isArray(t) ? (t.filter((x) => typeof x === 'string') as string[]) : [];
}

// Lowercased, trimmed names of every entity-typed JSON-LD node on a page.
// Called on the homepage to learn the site's own brand/firm names.
export function collectSiteEntityNames(html: string): Set<string> {
  const out = new Set<string>();
  const stack: unknown[] = [...extractJsonLdBlocks(html)];
  let guard = 0;
  while (stack.length && guard++ < 5000) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const name = obj['name'];
    if (typeof name === 'string' && name.trim() && jsonLdTypes(obj).some((x) => ENTITY_TYPE_RE.test(x))) {
      out.add(name.trim().toLowerCase());
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return out;
}

export const JSONLD_SKIP_KEYS = new Set([
  'author', 'publisher', 'creator', 'contributor', 'editor', 'provider', 'brand',
  'parentOrganization', 'worksFor', 'memberOf', 'sponsor', 'funder', 'seller',
  'copyrightHolder', 'isPartOf', 'about',
]);

// Entity-typed JSON-LD node with a name, ignoring the site's own entities
// (names seen on the homepage) and doesn't descend into attribution/relationship keys.
export function hasPageSpecificEntityJsonLd(html: string, siteEntityNames: Set<string>): boolean {
  const stack: unknown[] = [...extractJsonLdBlocks(html)];
  let guard = 0;
  while (stack.length && guard++ < 5000) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const name = obj['name'];
    if (
      typeof name === 'string' &&
      name.trim() &&
      jsonLdTypes(obj).some((x) => ENTITY_TYPE_RE.test(x)) &&
      !siteEntityNames.has(name.trim().toLowerCase())
    ) {
      return true;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (JSONLD_SKIP_KEYS.has(k)) continue;
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fix (profile-page check, 2026-10-06): which entity on a page belongs to the page.
// A page is evidence of one profile only when exactly one entity is tied to it (its url/@id
// is the page or canonical URL, it is a page wrapper's mainEntity, or its name is in the main
// heading). Several entities with none tied = a listing page. Other entities on a profile
// page (sponsored agents, "similar advisors", listings, the brokerage) are not the page's own.
// ---------------------------------------------------------------------------
const PAGE_NONPROFILE_TYPE_RE = /residence|house|apartment|accommodation|^place$|city|^state$|country|administrativearea|neighborhood|attraction|landform|vehicle|movie|book|recipe|course|brand/i;

export type PageEntityEvidence = {
  kind: 'profile' | 'listing' | 'single_untied' | 'ambiguous' | 'none';
  entities: number; // distinct entity names on the page (site's own excluded)
  tied: number; // distinct names tied to the page
  tie?: 'url' | 'main_entity' | 'heading';
  name?: string;
};

function normPageUrl(u: unknown, base?: string): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const x = new URL(u.trim(), base);
    if (!/^https?:$/.test(x.protocol)) return null;
    return `${x.host.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch { return null; }
}

function normName(s: string): string {
  return s.toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
}

function pageHeadingText(html: string): string {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html ?? '');
  const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html ?? '');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html ?? '');
  return normName([h1?.[1], og?.[1], title?.[1]].filter(Boolean).join(' ').replace(/<[^>]+>/g, ' '));
}

type TieCand = { o: LdObj; name: string; mainEntity: boolean };

function pageEntityCandidates(html: string, siteEntityNames: Set<string>): TieCand[] {
  const out: TieCand[] = [];
  let guard = 0;
  const visit = (v: unknown, depth: number, mainEntity: boolean) => {
    if (depth > 8 || v == null || guard++ > 5000) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1, mainEntity); return; }
    if (typeof v !== 'object') return;
    const o = v as LdObj;
    const types = typesOf(o);
    const name = typeof o['name'] === 'string' ? (o['name'] as string).trim() : '';
    if (
      name && types.length && isEntityTyped(o) && !types.some((t) => PAGE_NONPROFILE_TYPE_RE.test(t)) &&
      !siteEntityNames.has(name.toLowerCase())
    ) {
      out.push({ o, name: normName(name), mainEntity });
    }
    const wrapper = types.some((t) => /page$/i.test(t));
    for (const [k, val] of Object.entries(o)) {
      if (JSONLD_SKIP_KEYS.has(k) || !val || typeof val !== 'object') continue;
      visit(val, depth + 1, k === 'mainEntity' && wrapper ? true : k === '@graph' ? mainEntity : false);
    }
  };
  for (const b of extractJsonLdBlocks(html)) visit(b, 0, false);
  if (!out.length) {
    for (const e of safe(() => collectEmbeddedEntities(html), [] as LdObj[])) {
      const name = typeof e['name'] === 'string' ? (e['name'] as string).trim() : '';
      if (name && !siteEntityNames.has(name.toLowerCase())) out.push({ o: e, name: normName(name), mainEntity: false });
    }
  }
  return out.filter((c) => c.name.length >= 2);
}

function tieOf(c: TieCand, pageKeys: Set<string>, heading: string, pageUrl: string): PageEntityEvidence['tie'] | null {
  for (const k of ['url', '@id']) {
    const n = normPageUrl(c.o[k], pageUrl);
    if (n && pageKeys.has(n)) return 'url';
  }
  if (c.mainEntity) return 'main_entity';
  if (c.name.length >= 4 && heading && (` ${heading} `).includes(` ${c.name} `)) return 'heading';
  return null;
}

function pageKeysOf(html: string, pageUrl: string): Set<string> {
  const keys = new Set<string>();
  const own = normPageUrl(pageUrl);
  if (own) keys.add(own);
  const canon = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html ?? '')
    ?? /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html ?? '');
  const c = canon ? normPageUrl(canon[1], pageUrl) : null;
  if (c) keys.add(c);
  return keys;
}

/** What the page's entities say about it: one profile, a listing, or nothing decisive. */
export function pageEntityEvidence(
  html: string,
  pageUrl: string,
  siteEntityNames: Set<string>,
  primary?: PrimarySubject,
): PageEntityEvidence {
  const all = safe(() => pageEntityCandidates(html, siteEntityNames), [] as TieCand[]);
  // Fix (category-aware page check, 2026-10-06): only entities of the category's own kind count.
  // Person category: Person entities (offices, branches, brokerages are related only); a page with
  // no Person uses its business-typed entities (agents marked up as RealEstateAgent). Place
  // category: business/place entities; people on the page (chef, owner, staff) are related only.
  const isPerson = (c: TieCand) => typesOf(c.o).includes('Person');
  const persons = all.filter(isPerson);
  const cands = primary === 'person' ? (persons.length ? persons : all)
    : primary === 'location' ? all.filter((c) => !isPerson(c))
    : all;
  const names = new Set(cands.map((c) => c.name));
  if (!names.size) return { kind: 'none', entities: 0, tied: 0 };
  const keys = pageKeysOf(html, pageUrl);
  const heading = pageHeadingText(html);
  const tied = new Map<string, NonNullable<PageEntityEvidence['tie']>>();
  for (const c of cands) {
    const t = tieOf(c, keys, heading, pageUrl);
    if (t && !tied.has(c.name)) tied.set(c.name, t);
  }
  if (tied.size === 1) {
    const [name, tie] = [...tied.entries()][0];
    return { kind: 'profile', entities: names.size, tied: 1, tie, name };
  }
  if (tied.size > 1) return { kind: 'ambiguous', entities: names.size, tied: tied.size };
  if (names.size >= 2) return { kind: 'listing', entities: names.size, tied: 0 };
  return { kind: 'single_untied', entities: 1, tied: 0, name: [...names][0] };
}

/**
 * The page's own entity first: when exactly one entity name is tied to the page and other
 * entities are present, its objects move to the front so first-match extraction reads it,
 * not a sponsored or related entity. Nothing is dropped; pages without a tie are unchanged.
 */
export function orderByPageTie(objs: LdObj[], html: string, pageUrl: string, primary?: PrimarySubject): LdObj[] {
  if (objs.length < 2 || !pageUrl) return objs;
  const ev = safe(() => pageEntityEvidence(html, pageUrl, new Set<string>(), primary), { kind: 'none', entities: 0, tied: 0 } as PageEntityEvidence);
  if (ev.kind !== 'profile' || !ev.name) return objs;
  const own = (o: LdObj) => typeof o['name'] === 'string' && normName(o['name'] as string) === ev.name;
  return [...objs.filter(own), ...objs.filter((o) => !own(o))];
}

/** Every @type-carrying object on a page (@graph flattened, mainEntity followed). */
export function collectJsonLdObjects(html: string): LdObj[] {
  const out: LdObj[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    if (typeof v !== 'object') return;
    const o = v as LdObj;
    if (o['@type'] != null) out.push(o);
    if (o['@graph'] != null) visit(o['@graph'], depth + 1);
    // ProfilePage / WebPage wrappers carry the entity in mainEntity.
    if (o['mainEntity'] != null && typeof o['mainEntity'] === 'object') visit(o['mainEntity'], depth + 1);
  };
  for (const b of extractJsonLdBlocks(html)) visit(b, 0);
  // Fix (P1 embedded data, 2026-10-05): a page with no entity-typed JSON-LD may still carry
  // its records as application state inside the HTML (__NEXT_DATA__, __APOLLO_STATE__,
  // window.__INITIAL_STATE__, <script type="application/json">). Entity-like objects from
  // that state are normalised to schema.org form and read by the same JSON-LD tier, so the
  // mapper learns them and the harvest reads them with no other change. Pages that already
  // have entity JSON-LD are unchanged.
  if (!out.some(isEntityTyped)) {
    for (const e of safe(() => collectEmbeddedEntities(html), [] as LdObj[])) out.push(e);
  }
  return out;
}

function isEntityTyped(o: LdObj): boolean {
  return typesOf(o).some((t) => !NON_ENTITY_TYPES.has(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// P1 — data embedded in the page (no browser)
// ---------------------------------------------------------------------------
const EMBEDDED_MAX_CHARS = 4_000_000; // per state blob
const EMBEDDED_MAX_NODES = 60_000; // objects visited per page
const EMBEDDED_MAX_ENTITIES = 50; // normalised entities kept per page

/** Parsed application-state blobs embedded in the HTML (JSON only; JS that is not JSON is skipped). */
export function extractEmbeddedState(html: string): unknown[] {
  const out: unknown[] = [];
  const src = html ?? '';
  const tryParse = (txt: string) => {
    const t = txt.trim();
    if (!t || t.length > EMBEDDED_MAX_CHARS) return;
    try { out.push(JSON.parse(t)); } catch { /* not JSON */ }
  };
  // <script type="application/json"> blocks (includes Next.js __NEXT_DATA__).
  const jsonRe = /<script[^>]*type\s*=\s*["']?application\/json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonRe.exec(src))) tryParse(m[1]);
  // window.__X__ = {...}; assignments (Redux / Apollo / Nuxt-style state).
  const assignRe = /(?:window\.)?(__[A-Z0-9_]+__|__[A-Z0-9_]*STATE[A-Z0-9_]*)\s*=\s*(\{|\[)/g;
  while ((m = assignRe.exec(src))) {
    const start = m.index + m[0].length - 1;
    const end = matchBracket(src, start);
    if (end > start) tryParse(src.slice(start, end + 1));
  }
  return out;
}

/** Index of the bracket closing the one at `start` (string-aware), or -1. */
function matchBracket(s: string, start: number): number {
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr: string | null = null;
  const limit = Math.min(s.length, start + EMBEDDED_MAX_CHARS);
  for (let i = start; i < limit; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const nk = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const EK = {
  name: ['name', 'fullname', 'displayname', 'agentname', 'advisorname', 'profilename', 'businessname', 'locationname', 'officename', 'storename'],
  first: ['firstname', 'givenname', 'fname'],
  last: ['lastname', 'familyname', 'surname', 'lname'],
  phone: ['phone', 'phonenumber', 'telephone', 'tel', 'mobile', 'mobilephone', 'mobilenumber', 'cellphone', 'cell', 'officephone', 'workphone', 'directphone', 'primaryphone', 'businessphone', 'contactphone'],
  phones: ['phones', 'phonenumbers', 'telephones'],
  email: ['email', 'emailaddress', 'mail', 'contactemail', 'primaryemail'],
  url: ['url', 'profileurl', 'profilelink', 'canonicalurl', 'permalink', 'detailurl', 'pageurl', 'link', 'href', 'path', 'uri'],
  website: ['website', 'websiteurl', 'homepage'],
  image: ['image', 'imageurl', 'photo', 'photourl', 'avatar', 'avatarurl', 'headshot', 'headshoturl', 'profileimage', 'profilephoto', 'picture', 'thumbnail'],
  title: ['jobtitle', 'title', 'position', 'designation', 'role', 'headline'],
  bio: ['bio', 'biography', 'description', 'about', 'aboutme', 'summary'],
  address: ['address', 'officeaddress', 'location', 'primaryaddress', 'mailingaddress', 'businessaddress', 'streetaddress', 'office', 'primaryoffice', 'branch', 'officelocation'],
  street: ['street', 'streetaddress', 'address1', 'addressline1', 'line1', 'street1'],
  city: ['city', 'locality', 'addresslocality', 'town'],
  state: ['state', 'statecode', 'region', 'addressregion', 'province', 'stateabbr', 'stateabbreviation'],
  zip: ['zip', 'zipcode', 'postalcode', 'postcode', 'zip5'],
  hours: ['hours', 'openinghours', 'businesshours', 'officehours'],
  personHint: ['firstname', 'lastname', 'jobtitle', 'designation', 'licensenumber', 'license', 'nmls', 'nmlsid', 'headshot', 'agentid', 'advisorid'],
  placeHint: ['businessname', 'storename', 'locationname', 'storenumber', 'hours', 'openinghours', 'businesshours', 'cuisine', 'menu'],
};
const EKS = Object.fromEntries(Object.entries(EK).map(([k, v]) => [k, new Set(v)])) as Record<keyof typeof EK, Set<string>>;

function pickStr(o: Record<string, unknown>, keys: Set<string>): string | null {
  for (const [k, v] of Object.entries(o)) {
    if (!keys.has(nk(k))) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = (v as Record<string, unknown>)['url'] ?? (v as Record<string, unknown>)['href'] ?? (v as Record<string, unknown>)['number'] ?? (v as Record<string, unknown>)['value'];
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  }
  return null;
}

function pickPhone(o: Record<string, unknown>): string | null {
  const direct = pickStr(o, EKS.phone);
  if (direct) return direct;
  for (const [k, v] of Object.entries(o)) {
    if (!EKS.phones.has(nk(k)) || !Array.isArray(v)) continue;
    for (const x of v) {
      if (typeof x === 'string' && x.trim()) return x.trim();
      if (x && typeof x === 'object') {
        const n = pickStr(x as Record<string, unknown>, new Set(['number', 'phone', 'phonenumber', 'value', 'display']));
        if (n) return n;
      }
    }
  }
  return null;
}

function pickAddress(o: Record<string, unknown>): Record<string, string> | string | null {
  const flat: Record<string, string> = {};
  const street = pickStr(o, EKS.street); const city = pickStr(o, EKS.city);
  const state = pickStr(o, EKS.state); const zip = pickStr(o, EKS.zip);
  if (street) flat.streetAddress = street;
  if (city) flat.addressLocality = city;
  if (state) flat.addressRegion = state;
  if (zip) flat.postalCode = zip;
  if (city || zip) return flat;
  for (const [k, v] of Object.entries(o)) {
    if (!EKS.address.has(nk(k))) continue;
    if (typeof v === 'string' && v.trim().length > 6) return v.trim();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = pickAddress(v as Record<string, unknown>);
      if (inner) return inner;
    }
  }
  return Object.keys(flat).length ? flat : null;
}

// Two to four capitalised words with no business word: "Jane Doe", "Mary-Ann O'Neil Jr."
const PERSON_NAME_RE = /^(?!.*\b(?:llc|inc|corp|co|company|group|realty|properties|associates|partners|team|office|bank|services|financial|insurance|agency|restaurant|cafe|bar|grill|the)\b)[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]*,?){1,3}$/i;

/** schema.org-shaped object from an entity-like state object, or null. */
function normaliseEmbedded(o: Record<string, unknown>): LdObj | null {
  const keys = new Set(Object.keys(o).map(nk));
  let name = pickStr(o, EKS.name);
  const first = pickStr(o, EKS.first); const last = pickStr(o, EKS.last);
  if (!name && (first || last)) name = [first, last].filter(Boolean).join(' ');
  if (!name || name.length > 120 || /^https?:/i.test(name)) return null;
  const phone = pickPhone(o);
  const email = pickStr(o, EKS.email);
  const address = pickAddress(o);
  const url = pickStr(o, EKS.url);
  const image = pickStr(o, EKS.image);
  const validEmail = email && /@/.test(email) ? email : null;
  // At least one contact signal (phone, email or address) and two signals in all,
  // so navigation items like {name, url, image} are not taken for records.
  if (!(phone || validEmail || address)) return null;
  const signals = [phone, validEmail, address, url, image].filter(Boolean).length;
  if (signals < 2) return null;
  const isPerson =
    [...keys].some((k) => EKS.personHint.has(k)) ||
    !!(first || last) ||
    (![...keys].some((k) => EKS.placeHint.has(k)) && (!!validEmail || PERSON_NAME_RE.test(name)));
  const out: LdObj = { '@type': isPerson ? 'Person' : 'LocalBusiness', '@embedded': true, name };
  if (phone) out.telephone = phone;
  if (validEmail) out.email = validEmail;
  if (address) out.address = address;
  if (url) out.url = url;
  const website = pickStr(o, EKS.website);
  if (website && !out.url) out.url = website;
  if (image) out.image = image;
  const title = pickStr(o, EKS.title);
  if (isPerson && title && title.length < 120) out.jobTitle = title;
  const bio = pickStr(o, EKS.bio);
  if (bio && bio.length > 40) out.description = bio;
  const hours = pickStr(o, EKS.hours);
  if (!isPerson && hours) out.openingHours = hours;
  return out;
}

/**
 * Entity-like objects (a name plus at least two of phone, email, address, URL, photo)
 * found in the page's embedded application state, normalised to schema.org form.
 * Objects outside arrays (usually the page's own record) come first, then the rest
 * by number of fields; duplicates are dropped.
 */
export function collectEmbeddedEntities(html: string): LdObj[] {
  if (!/application\/json|__[A-Z0-9_]+__\s*=|STATE[A-Z0-9_]*\s*=/.test(html ?? '')) return [];
  const found: Array<{ o: LdObj; inArray: boolean; n: number; i: number }> = [];
  const seen = new Set<string>();
  let nodes = 0;
  const visit = (v: unknown, inArray: boolean, depth: number) => {
    if (v == null || depth > 14 || nodes > EMBEDDED_MAX_NODES) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, true, depth + 1); return; }
    if (typeof v !== 'object') return;
    nodes++;
    const obj = v as Record<string, unknown>;
    const e = normaliseEmbedded(obj);
    if (e) {
      const sig = `${String(e.name).toLowerCase()}|${e.telephone ?? ''}|${e.url ?? ''}`;
      if (!seen.has(sig)) { seen.add(sig); found.push({ o: e, inArray, n: Object.keys(e).length, i: found.length }); }
    }
    for (const x of Object.values(obj)) if (x && typeof x === 'object') visit(x, inArray, depth + 1);
  };
  for (const blob of extractEmbeddedState(html)) visit(blob, false, 0);
  return found
    .sort((a, b) => Number(a.inArray) - Number(b.inArray) || b.n - a.n || a.i - b.i)
    .slice(0, EMBEDDED_MAX_ENTITIES)
    .map((f) => f.o);
}

/** Same-site URLs of the entities found in embedded state (absolute; for the mapper's candidates). */
export function embeddedEntityUrls(html: string, base: string): string[] {
  const out: string[] = [];
  let host = '';
  try { host = new URL(base).host.replace(/^www\./, ''); } catch { return out; }
  for (const e of safe(() => collectEmbeddedEntities(html), [] as LdObj[])) {
    const u = typeof e.url === 'string' ? e.url : null;
    if (!u) continue;
    try {
      const abs = new URL(u, base);
      const h = abs.host.replace(/^www\./, '');
      if (!/^https?:$/.test(abs.protocol) || (h !== host && !h.endsWith('.' + host))) continue;
      abs.hash = '';
      if (!out.includes(abs.toString())) out.push(abs.toString());
    } catch { /* not a URL */ }
  }
  return out;
}

function typesOf(o: LdObj): string[] {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

const NON_ENTITY_TYPES = new Set([
  'webpage', 'website', 'profilepage', 'aboutpage', 'contactpage', 'collectionpage', 'searchresultspage',
  'breadcrumblist', 'itemlist', 'listitem', 'searchaction', 'imageobject', 'videoobject', 'faqpage',
  'question', 'answer', 'article', 'blogposting', 'newsarticle', 'product', 'offer', 'review',
  'aggregaterating', 'rating', 'postaladdress', 'geocoordinates', 'contactpoint', 'sitenavigationelement',
  'wpheader', 'wpfooter', 'event', 'howto', 'creativework', 'thing', 'readaction', 'entrypoint',
]);

/** FNV-1a 64-bit hex of a string. */
export function fnv1a64(str: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

/** Compact stable signature: FNV-1a 64-bit hash of the object's JSON string. */
export function jsonLdSignature(o: LdObj): string {
  let json: string;
  try { json = JSON.stringify(o); } catch { return ''; }
  return json ? fnv1a64(json) : '';
}

export function classifySubject(
  o: LdObj,
  siteEntityNames: Set<string>,
  opts: ApplyOptions = {},
): Subject | null {
  const name = typeof o['name'] === 'string' ? (o['name'] as string).trim().toLowerCase() : '';
  if (name && siteEntityNames.has(name)) return 'firm';
  if (opts.firmSignatures?.has(jsonLdSignature(o))) return 'firm';
  const types = typesOf(o);
  if (types.some((t) => t === 'Person')) return 'person';
  if (types.length && types.some((t) => !NON_ENTITY_TYPES.has(t.toLowerCase()))) return 'location';
  return null;
}

const HOURS_PATH = '@hours';
const JSONLD_PATHS: Record<Subject, Record<string, string[][]>> = {
  person: {
    name: [['name']], job_title: [['jobTitle']], phone: [['telephone']], email: [['email']],
    bio: [['description']], photo_url: [['image']], street: [['address', 'streetAddress']],
    city: [['address', 'addressLocality']], state: [['address', 'addressRegion']],
    postal_code: [['address', 'postalCode']], credentials: [['hasCredential', 'name']],
    languages: [['knowsLanguage']], education: [['alumniOf', 'name']], social_links: [['sameAs']],
    profile_url: [['url']], fax: [['faxNumber']],
    first_name: [['givenName']], last_name: [['familyName']], awards: [['award']],
    service_areas: [['areaServed', 'name'], ['areaServed']],
  },
  location: {
    business_name: [['name']], phone: [['telephone']], email: [['email']],
    street: [['address', 'streetAddress']], city: [['address', 'addressLocality']],
    state: [['address', 'addressRegion']], postal_code: [['address', 'postalCode']],
    website: [['url']], hours: [[HOURS_PATH]], description: [['description']],
    logo_url: [['logo'], ['image']], social_links: [['sameAs']], fax: [['faxNumber']],
    latitude: [['geo', 'latitude']], longitude: [['geo', 'longitude']],
  },
  firm: {
    firm_name: [['name']], logo_url: [['logo']], phone_main: [['telephone']], website: [['url']],
    social_links: [['sameAs']], fax: [['faxNumber']], email: [['email']],
    legal_name: [['legalName']], description: [['description']],
    street: [['address', 'streetAddress']], city: [['address', 'addressLocality']],
    state: [['address', 'addressRegion']], postal_code: [['address', 'postalCode']],
  },
};

function leafValues(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(leafValues);
  if (typeof v === 'string') return [v];
  if (typeof v === 'number') return [String(v)];
  if (typeof v === 'object') {
    const o = v as LdObj;
    const pick = o['url'] ?? o['name'] ?? o['@id'];
    return typeof pick === 'string' ? [pick] : [];
  }
  return [];
}

function walkPath(v: unknown, path: string[]): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => walkPath(x, path));
  if (path.length === 0) return leafValues(v);
  if (typeof v !== 'object') return [];
  const [head, ...rest] = path;
  if (head === '*') return walkPath(v, rest);
  return walkPath((v as LdObj)[head], rest);
}

function dayName(d: unknown): string {
  return typeof d === 'string' ? d.replace(/^https?:\/\/schema\.org\//i, '') : '';
}

function renderHours(o: LdObj): string[] {
  const out: string[] = [];
  const oh = o['openingHours'];
  for (const h of Array.isArray(oh) ? oh : oh != null ? [oh] : []) if (typeof h === 'string') out.push(h);
  const spec = o['openingHoursSpecification'];
  for (const s of Array.isArray(spec) ? spec : spec != null ? [spec] : []) {
    if (!s || typeof s !== 'object') continue;
    const so = s as LdObj;
    const days = (Array.isArray(so['dayOfWeek']) ? so['dayOfWeek'] : [so['dayOfWeek']]).map(dayName).filter(Boolean);
    const span = `${so['opens'] ?? ''}–${so['closes'] ?? ''}`;
    for (const d of days.length ? days : ['']) out.push(`${d} ${span}`.trim());
  }
  return out;
}

function extractJsonLd(o: LdObj, path: string[]): string[] {
  if (path.length === 1 && path[0] === HOURS_PATH) return renderHours(o);
  return walkPath(o, path);
}

function toRaw(type: FieldType, vals: string[]): unknown {
  if (vals.length === 0) return null;
  return type === 'list' ? vals : vals[0];
}

// ---------------------------------------------------------------------------
// CSS / label tier
// ---------------------------------------------------------------------------
type $T = ReturnType<typeof load>;

function stripPrefix(s: string): string {
  return s.replace(/^\s*(tel:|mailto:)/i, '').trim();
}

function splitMulti(s: string): string[] {
  return s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

// Fix 5: <br> and block boundaries inside the matched element become newlines.
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'dd', 'td', 'tr']);
function blockText(el: any): string {
  let out = '';
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === 'text') { out += n.data ?? ''; return; }
    if (n.type !== 'tag' && n.type !== 'root') return;
    const name = String(n.name ?? '').toLowerCase();
    if (name === 'br') { out += '\n'; return; }
    const block = BLOCK_TAGS.has(name);
    if (block) out += '\n';
    for (const c of n.children ?? []) walk(c);
    if (block) out += '\n';
  };
  walk(el);
  return normLines(out);
}

// C14b: extra text ignores superscripts, hidden and screen-reader-only elements.
const SR_ONLY_RE = /sr-only|visually-hidden|visuallyhidden|screen-reader/i;
function isNoiseEl(n: any): boolean {
  const name = String(n?.name ?? '').toLowerCase();
  if (name === 'sup') return true;
  const a = n?.attribs ?? {};
  if (a.hidden !== undefined) return true;
  if (String(a['aria-hidden'] ?? '').toLowerCase() === 'true') return true;
  return SR_ONLY_RE.test(String(a.class ?? '')) || SR_ONLY_RE.test(String(a.id ?? ''));
}
function extraText(el: any): string {
  let out = '';
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === 'text') { out += n.data ?? ''; return; }
    if (n.type !== 'tag' && n.type !== 'root') return;
    if (n.type === 'tag' && isNoiseEl(n)) return;
    const name = String(n.name ?? '').toLowerCase();
    if (name === 'br') { out += '\n'; return; }
    const block = BLOCK_TAGS.has(name);
    if (block) out += '\n';
    for (const c of n.children ?? []) walk(c);
    if (block) out += '\n';
  };
  walk(el);
  return normLines(out);
}
/** C14b: strip leading separators (spaces , ; : | • · - – —). */
function stripLeadingSeparator(s: string): string {
  return String(s ?? '').replace(/^[\s,;:|•·\-\u2013\u2014]+/, '').trim();
}

/** C14b: matched elements grouped by their parent element (document order). */
function groupByParent(list: any[]): { parents: any[]; groups: any[][] } {
  const parents: any[] = [];
  const groups: any[][] = [];
  for (const el of list) {
    const p = el?.parent ?? null;
    const i = parents.indexOf(p);
    if (i < 0) { parents.push(p); groups.push([el]); } else groups[i].push(el);
  }
  return { parents, groups };
}
const HEADING_TAG_RE = /^h[1-6]$/;
function isHeadingEl(n: any): boolean {
  return n?.type === 'tag' && (HEADING_TAG_RE.test(String(n.name ?? '').toLowerCase()) || String(n.attribs?.role ?? '') === 'heading');
}
function normHeading(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** C14b: normalised text of a container's nearest heading ('' when none). */
function nearestHeading($: $T, el: any): string {
  const lbl = String(el?.attribs?.['aria-labelledby'] ?? '').trim();
  if (lbl) {
    for (const id of lbl.split(/\s+/)) {
      const t = normHeading($(`[id="${id.replace(/"/g, '')}"]`).first().text());
      if (t) return t;
    }
  }
  let cur = el;
  for (let depth = 0; cur && depth < 10; depth++) {
    for (let sib = cur.prev; sib; sib = sib.prev) {
      if (isHeadingEl(sib)) { const t = normHeading($(sib).text()); if (t) return t; }
      if (sib.type === 'tag') {
        const inner = $(sib).find('h1,h2,h3,h4,h5,h6,[role=heading]').last();
        if (inner.length) { const t = normHeading(inner.text()); if (t) return t; }
      }
    }
    cur = cur.parent;
    if (cur?.type !== 'tag') break;
  }
  return '';
}
/** C14b: keep only one container's matches (by stored heading, else index). */
function selectExtraContainer($: $T, list: any[], loc: CssLocator): any[] | null {
  const { parents, groups } = groupByParent(list);
  if (groups.length <= 1) return list;
  if (loc.container_heading) {
    const i = parents.findIndex((p) => p && nearestHeading($, p) === loc.container_heading);
    return i < 0 ? null : groups[i];
  }
  if (typeof loc.container_index === 'number') return groups[loc.container_index] ?? null;
  return list;
}

const LABEL_SEL = 'h1,h2,h3,h4,h5,h6,dt,th,strong,b,span,p,div,label';

function normLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Fix 3 (2026-09-25): fax numbers must never be read as phone numbers.
function hasFaxHint(el: any): boolean {
  const a = el?.attribs ?? {};
  return ['id', 'class', 'aria-label', 'title'].some((k) => /fax/i.test(String(a[k] ?? '')));
}

function isFaxContext($: $T, el: any): boolean {
  let cur = el;
  for (let i = 0; i <= 2 && cur && cur.type === 'tag'; i++) {
    if (hasFaxHint(cur)) return true;
    cur = cur.parent;
  }
  // A "Fax:" label inside the matched element itself.
  if (/\bfax\b/i.test($(el).text())) return true;
  // Text immediately preceding the value inside the same parent.
  let prev = el?.prev;
  let text = '';
  while (prev && text.length < 40) {
    text = (prev.type === 'text' ? prev.data ?? '' : $(prev).text()) + text;
    prev = prev.prev;
  }
  return /fax/i.test(text.slice(-40));
}

/** C8: attributes read (in order) for url-typed taxonomy rules without attr. */
const URL_ATTRS = ['href', 'src', 'content'] as const;
function readUrlAttr($: $T, el: any): string {
  if (!el) return '';
  for (const a of URL_ATTRS) { const v = $(el).attr(a); if (v && v.trim()) return v.trim(); }
  const inner = $(el).find('[href],[src],[content]').first();
  if (inner.length) for (const a of URL_ATTRS) { const v = inner.attr(a); if (v && v.trim()) return v.trim(); }
  return '';
}

/** C13: explicit list breaks inside one text (never a bare comma). */
const LIST_BREAK_RE = /[\n•·;|]/;
/** C13: trimmed texts of the sibling nodes following el inside the same parent. */
function siblingTexts($: $T, el: any): string[] {
  const out: string[] = [];
  let n = el?.next;
  while (n && out.length < 10) {
    const t = (n.type === 'text' ? String(n.data ?? '') : $(n).text()).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
    n = n.next;
  }
  return out;
}
/** C13: the first part ends with a separator → continue with following sibling parts (cap 10). */
function continueParts(first: string, sibs: string[]): string[] {
  const parts = [first];
  for (const s of sibs) {
    if (parts.length >= 10) break;
    parts.push(s);
    if (!PART_SEP_RE.test(s)) break;
  }
  return parts;
}

function applyCss($: $T, loc: CssLocator, faxGuard = false, urlOnly = false, textJoin = false, listMode = false, extraMode = false): unknown {
  if (loc.pair) {
    // C9: geo — one rule per coordinate.
    const one = (l: CssLocator) => { const x = applyCss($, l); return Array.isArray(x) ? x[0] : x; };
    const la = one(loc.pair.latitude);
    const lo = one(loc.pair.longitude);
    return la == null || lo == null ? null : { latitude: String(la).trim(), longitude: String(lo).trim() };
  }
  if (loc.strategy === 'css') {
    if (!loc.css) return null;
    const els = $(loc.css);
    if (els.length === 0) return null;
    const read = (el: any) => {
      if (faxGuard && isFaxContext($, el)) return '';
      if (urlOnly) return loc.attr ? String($(el).attr(loc.attr) ?? '').trim() : readUrlAttr($, el);
      // C14b: extras ignore superscripts and hidden / screen-reader-only text.
      // Lists (like extras) ignore superscripts / footnote markers and hidden / screen-reader-only text.
      const v = loc.attr ? String($(el).attr(loc.attr) ?? '').replace(/\s+/g, ' ') : extraMode || listMode ? extraText(el) : blockText(el);
      return stripPrefix(v);
    };
    if (loc.multi) {
      let list: any[] = els.toArray();
      if (extraMode) {
        // C14b: one list = one container.
        const sel = selectExtraContainer($, list, loc);
        if (!sel) return null;
        list = sel;
      }
      const vals: string[] = [];
      for (const el of list) { const v = read(el); if (v) vals.push(v); }
      return vals.length ? vals : null;
    }
    // C13: a list-typed key collects one item per matched element, or — from a
    // single element — sibling parts after a trailing separator, or explicit
    // list breaks. A single text is never split on commas alone.
    if (listMode && !loc.attr) {
      if (els.length > 1) {
        const vals: string[] = [];
        els.each((_, el) => { const v = read(el); if (v) vals.push(v); });
        return vals.length ? vals : null;
      }
      const v = read(els.get(0));
      if (!v) return null;
      if (PART_SEP_RE.test(v)) {
        const sibs = siblingTexts($, els.get(0));
        if (sibs.length) return continueParts(v, sibs);
      }
      const split = v.split(LIST_BREAK_RE).map((x) => x.trim()).filter(Boolean);
      return split.length > 1 ? split : v;
    }
    // C12: a text rule matching several elements whose first text ends with a
    // separator is one value split across elements — join the parts.
    if (textJoin && !loc.attr) {
      if (els.length > 1) {
        const parts: string[] = [];
        els.each((_, el) => { const v = read(el); if (v) parts.push(v); });
        if (parts.length > 1 && PART_SEP_RE.test(parts[0])) return joinParts(parts);
      }
      // C13: one element whose text ends with a separator continues with the
      // sibling parts in the same parent; the value is the full joined text.
      const v0 = read(els.get(0));
      if (v0 && PART_SEP_RE.test(v0)) {
        const sibs = siblingTexts($, els.get(0));
        if (sibs.length) {
          const parts = continueParts(v0, sibs).map(stripTrailingSeparator).filter(Boolean);
          if (parts.length > 1) return parts.join(', ');
        }
      }
    }
    const v = read(els.get(0));
    return v || null;
  }
  // label strategy
  const label = normLabel(loc.label ?? '').replace(/:$/, '');
  if (!label) return null;
  if (faxGuard && label.includes('fax')) return null;
  let found: any = null;
  let own = '';
  $(LABEL_SEL).each((_, el) => {
    const text = $(el)
      .contents()
      .filter((__, n: any) => n.type === 'text')
      .text();
    const t = normLabel(text || ($(el).children().length === 0 ? $(el).text() : ''));
    const tl = t.replace(/:$/, '');
    if (tl && (tl === label || tl.startsWith(label))) {
      found = el;
      own = text.replace(/\s+/g, ' ').trim();
      return false;
    }
    return undefined;
  });
  if (!found) return null;
  if (urlOnly) {
    // C8: url keys take the value from an attribute, never element text.
    const tagU = String(found.tagName ?? found.name ?? '').toLowerCase();
    const tgt = tagU === 'dt' ? $(found).nextAll('dd').first() : tagU === 'th' ? $(found).nextAll('td').first() : $(found).next();
    for (const el of [found, tgt?.get(0)]) {
      if (!el) continue;
      const v = loc.attr ? String($(el).attr(loc.attr) ?? '').trim() : readUrlAttr($, el);
      if (v) return loc.multi ? [v] : v;
    }
    return null;
  }
  const remainder = own.slice(label.length).replace(/^\s*[:\-–]\s*/, '').trim();
  if (remainder) {
    if (faxGuard && isFaxContext($, found)) return null;
    if (loc.multi) return splitMulti(remainder);
    // C13: list keys split one text on explicit list breaks only.
    if (listMode) {
      const split = remainder.split(LIST_BREAK_RE).map((x) => x.trim()).filter(Boolean);
      return split.length > 1 ? split : remainder;
    }
    return remainder;
  }
  const tag = String(found.tagName ?? found.name ?? '').toLowerCase();
  let target;
  if (tag === 'dt') target = $(found).nextAll('dd').first();
  else if (tag === 'th') target = $(found).nextAll('td').first();
  else target = $(found).next();
  if (!target || target.length === 0) return null;
  if (faxGuard && isFaxContext($, target.get(0))) return null;
  const lis = target.find('li');
  if (lis.length > 0) {
    const vals: string[] = [];
    lis.each((_, li) => { const v = $(li).text().replace(/\s+/g, ' ').trim(); if (v) vals.push(v); });
    return vals.length ? vals : null;
  }
  const v = blockText(target.get(0));
  if (!v) return null;
  if (loc.multi) return splitMulti(v);
  if (listMode) {
    const split = v.split(LIST_BREAK_RE).map((x) => x.trim()).filter(Boolean);
    return split.length > 1 ? split : v;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
/** Fix 14: compare URLs with lowercased host, no query/fragment/trailing slash. */
function urlKey(u: unknown, base?: string): string | null {
  if (typeof u !== 'string' || !u) return null;
  try {
    const x = new URL(u, base);
    return `${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Fix 12c: normalised text used for distinctive-word matching. */
function wordText(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}
function filterItems(raw: unknown, words: string[]): string[] {
  const items = (Array.isArray(raw) ? raw : [raw]).flatMap((x) =>
    typeof x === 'string' ? splitMulti(x) : typeof x === 'number' ? [String(x)] : [],
  );
  return [...new Set(items)].filter((t) => { const n = wordText(t); return words.some((w) => n.includes(w)); });
}

// ---- Fix 12a/b: candidate collectors (same behaviour as the worker's former helpers) ----
/** Every sameAs URL anywhere across a page's JSON-LD. */
export function collectAllSameAsUrls(blocks: unknown[]): string[] {
  const urls = new Set<string>();
  const walk = (obj: unknown): void => {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (k === 'sameAs') {
          if (typeof v === 'string') urls.add(v);
          else if (Array.isArray(v)) for (const item of v) if (typeof item === 'string') urls.add(item);
        }
        walk(v);
      }
    }
  };
  blocks.forEach(walk);
  return Array.from(urls);
}

/** Every credential text anywhere under a hasCredential key (strings, .name, .credentialCategory, .description). */
export function collectAllCredentialTexts(blocks: unknown[]): string[] {
  const texts = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v === 'string') texts.add(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.name === 'string') texts.add(o.name);
      if (typeof o.credentialCategory === 'string') texts.add(o.credentialCategory);
      if (typeof o.description === 'string') texts.add(o.description);
    }
  };
  const walk = (obj: unknown): void => {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (k === 'hasCredential') add(v);
        walk(v);
      }
    }
  };
  blocks.forEach(walk);
  return Array.from(texts);
}

function strings(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(strings);
  return typeof v === 'string' || typeof v === 'number' ? [String(v)] : [];
}

function classifierValue(loc: ClassifierLocator, ctx: Ctx): string | null {
  const objs = ctx.objs();
  const vals = ctx.values ?? {};
  if (loc.classifier === 'sameas') {
    const social = Object.entries(vals)
      .filter(([id]) => !isTaxId(id) && keyOf(id) === 'social_links')
      .flatMap(([, v]) => strings(v));
    const r = classifySameAs(loc.match_text, [...new Set([...collectAllSameAsUrls(objs), ...social])]);
    return r.recognized ? r.url : null;
  }
  const base = [...collectAllCredentialTexts(objs), ...strings(vals['person.credentials']), ...strings(vals['person.licenses'])];
  const cands = [...new Set(base.flatMap((t) => [t.trim(), ...splitMulti(t)]).filter(Boolean))];
  return classifyCredential(loc.match_text, cands).value;
}

// ---------------------------------------------------------------------------
// Staging schema: call-to-action buttons / links ("label␟url" inside the mapper)
// ---------------------------------------------------------------------------
export const ACTION_SEP = '\u241F';
export function encodeAction(label: string, url: string): string {
  return `${cleanText(label).replace(new RegExp(ACTION_SEP, 'g'), ' ')}${ACTION_SEP}${String(url).trim()}`;
}
export function decodeAction(s: string): { label: string; url: string } | null {
  const i = String(s ?? '').indexOf(ACTION_SEP);
  if (i <= 0) return null;
  const label = s.slice(0, i).trim();
  const url = s.slice(i + 1).trim();
  return label && url ? { label, url } : null;
}
/** A usable action link: http(s) made absolute, or tel: / mailto: / sms:. */
function actionUrl(raw: string, pageUrl: string): string | null {
  const t = String(raw ?? '').trim();
  if (!t || t.startsWith('#') || /^javascript:/i.test(t)) return null;
  if (/^(tel|mailto|sms):/i.test(t)) return t.replace(/^(tel|mailto|sms):/i, (m) => m.toLowerCase());
  try {
    const u = new URL(t, pageUrl);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
function readActions($: $T, loc: CssLocator, pageUrl: string): string[] | null {
  if (loc.strategy !== 'css' || !loc.css) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  $(loc.css).each((_, el) => {
    if (out.length >= 20) return false;
    const $el = $(el);
    const linkEl = $el.is('a,button,input,[data-href],[formaction]') ? $el : $el.find('a[href],[data-href],button[formaction]').first();
    if (!linkEl.length) return undefined;
    const rawUrl = linkEl.attr('href') ?? linkEl.attr('data-href') ?? linkEl.attr('formaction') ?? linkEl.closest('form').attr('action') ?? '';
    const url = actionUrl(rawUrl, pageUrl);
    const label = cleanText(linkEl.attr('aria-label') ?? '') || cleanText(linkEl.text()) || cleanText(linkEl.attr('title') ?? '') || cleanText(linkEl.attr('value') ?? '');
    if (!url || !label || label.length > 80) return undefined;
    const k = `${label.toLowerCase()}|${url}`;
    if (seen.has(k)) return undefined;
    seen.add(k);
    out.push(encodeAction(label, url));
    return undefined;
  });
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Staging schema: videos and gallery images
// ---------------------------------------------------------------------------
export type Video = { url: string; platform: string; title?: string };
/** A known video link → canonical URL and platform; direct video files keep their URL. */
export function videoFromUrl(raw: string, pageUrl: string): Video | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  let u: URL;
  try { u = new URL(t.startsWith('//') ? `https:${t}` : t, pageUrl); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;
  let m: RegExpMatchArray | null;
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    const id = u.searchParams.get('v') ?? (m = path.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/)) ?.[1];
    if (id) return { url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube' };
    return null;
  }
  if (host === 'youtu.be' && (m = path.match(/^\/([\w-]{6,})/))) return { url: `https://www.youtube.com/watch?v=${m[1]}`, platform: 'youtube' };
  if (/(^|\.)vimeo\.com$/.test(host) && (m = path.match(/(?:^|\/)(\d{5,})(?:\/|$)/))) return { url: `https://vimeo.com/${m[1]}`, platform: 'vimeo' };
  if (/(^|\.)(wistia\.(com|net)|wi\.st)$/.test(host) && (m = path.match(/\/(?:medias|iframe|embed\/iframe)\/([\w]{6,})/))) return { url: `https://fast.wistia.net/embed/iframe/${m[1]}`, platform: 'wistia' };
  if (/(^|\.)vidyard\.com$/.test(host) && (m = path.match(/\/(?:watch\/)?([\w-]{10,})/))) return { url: `https://play.vidyard.com/${m[1]}`, platform: 'vidyard' };
  if (/(^|\.)loom\.com$/.test(host) && (m = path.match(/\/(?:share|embed)\/([\w]{10,})/))) return { url: `https://www.loom.com/share/${m[1]}`, platform: 'loom' };
  if (/\.(mp4|webm|mov|m3u8)$/i.test(path) && (u.protocol === 'https:' || u.protocol === 'http:')) return { url: u.href.replace(/^http:/, 'https:'), platform: 'file' };
  return null;
}
const VIDEO_EL_SEL = 'iframe, video, video source, lite-youtube, lite-vimeo, [data-video-id], [data-youtube-id], a[href]';
function videosIn($: $T, els: any[], pageUrl: string): Video[] {
  const out: Video[] = [];
  const seen = new Set<string>();
  const take = (el: any) => {
    const $el = $(el);
    const tag = (el.tagName ?? el.name ?? '').toLowerCase();
    const cands: string[] = [];
    for (const a of ['src', 'data-src', 'data-lazy-src', 'href', 'data-url', 'data-video-url']) { const v = $el.attr(a); if (v) cands.push(v); }
    const yid = $el.attr('videoid') ?? $el.attr('data-youtube-id') ?? (tag === 'lite-youtube' ? $el.attr('data-id') : undefined);
    if (yid) cands.push(`https://www.youtube.com/watch?v=${yid}`);
    if (tag === 'lite-vimeo' && $el.attr('videoid')) cands.push(`https://vimeo.com/${$el.attr('videoid')}`);
    for (const c of cands) {
      const v = videoFromUrl(c, pageUrl);
      if (!v || seen.has(v.url)) continue;
      seen.add(v.url);
      const title = cleanText($el.attr('title') ?? $el.attr('aria-label') ?? (tag === 'a' ? $el.text() : '') ?? '');
      out.push(title && title.length <= 200 ? { ...v, title } : v);
      break;
    }
  };
  for (const el of els) {
    if (out.length >= 30) break;
    take(el);
    $(el).find(VIDEO_EL_SEL).each((_, x) => { if (out.length < 30) take(x); });
  }
  return out;
}
function readVideos($: $T, loc: CssLocator, pageUrl: string): Video[] | null {
  if (loc.strategy !== 'css' || !loc.css) return null;
  const v = videosIn($, $(loc.css).toArray(), pageUrl);
  return v.length ? v : null;
}
/** Generic scan of the page's main content (outside header / nav / footer / aside) for embedded videos. */
function scanVideos($: $T, pageUrl: string): Video[] | null {
  const root = $('main,[role=main]').first().get(0) ?? $('body').get(0);
  if (!root) return null;
  const els = $(root).find('iframe, video, lite-youtube, lite-vimeo, [data-youtube-id]').toArray()
    .filter((el: any) => $(el).closest('header,nav,footer,aside,[role=banner],[role=navigation],[role=contentinfo]').length === 0);
  const v = videosIn($, els, pageUrl);
  return v.length ? v : null;
}
/** Gallery images: img src / lazy src / largest srcset entry, or links to image files. */
function readImages($: $T, loc: CssLocator, pageUrl: string): string[] | null {
  if (loc.strategy !== 'css' || !loc.css) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const u = new URL(raw.trim(), pageUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
      const href = u.href.replace(/^http:/, 'https:');
      if (seen.has(href) || href.length > 300) return;
      seen.add(href);
      out.push(href);
    } catch { /* not a URL */ }
  };
  const fromImg = (el: any) => {
    const $el = $(el);
    const srcset = $el.attr('srcset') ?? $el.attr('data-srcset');
    if (srcset) {
      const best = srcset.split(',').map((x: string) => x.trim().split(/\s+/)).sort((a: string[], b: string[]) => parseFloat(b[1] ?? '0') - parseFloat(a[1] ?? '0'))[0]?.[0];
      if (best) { add(best); return; }
    }
    add($el.attr('data-src') ?? $el.attr('data-lazy-src') ?? $el.attr('src'));
  };
  $(loc.css).each((_, el) => {
    if (out.length >= 50) return false;
    const $el = $(el);
    if ($el.is('img')) fromImg(el);
    else if ($el.is('a[href]') && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test($el.attr('href') ?? '')) add($el.attr('href'));
    else $el.find('img').each((__, im) => { if (out.length < 50) fromImg(im); });
    return undefined;
  });
  return out.length ? out : null;
}

/** Structured entries: each matched block → { sub-key: value } (text, or href for url / an inner link). */
function readItems($: $T, loc: CssLocator, pageUrl: string): Array<Record<string, string>> | null {
  if (loc.strategy !== 'css' || !loc.css || !loc.item_fields) return null;
  const out: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  $(loc.css).each((_, el) => {
    if (out.length >= 50) return false;
    const item: Record<string, string> = {};
    for (const [k, sel] of Object.entries(loc.item_fields!)) {
      let sub: any;
      try { sub = $(el).find(sel).first(); } catch { continue; }
      if (!sub?.length) continue;
      if (k === 'url') {
        const href = sub.attr('href') ?? sub.find('a[href]').first().attr('href') ?? '';
        const u = actionUrl(href, pageUrl);
        if (u && /^https?:/.test(u)) item.url = u;
      } else {
        const t = cleanText(sub.text());
        if (t && t.length <= (k === 'description' ? 2000 : 300)) item[k] = t;
      }
    }
    if (!Object.keys(item).some((k) => k !== 'url')) return undefined;
    const sig = JSON.stringify(item).toLowerCase();
    if (seen.has(sig)) return undefined;
    seen.add(sig);
    out.push(item);
    return undefined;
  });
  return out.length ? out : null;
}

function applyLocator(
  loc: Locator,
  type: FieldType,
  id: string,
  ctx: { pageUrl: string; objs: () => LdObj[]; $: () => $T | null; siteEntityNames: Set<string>; opts: ApplyOptions; values?: Record<string, unknown> },
): unknown {
  const v = applyLocatorRaw(loc, type, id, ctx);
  // Fix 14: a taxonomy url equal to the page's own URL is not a value.
  // C2: the own-page key is exempt.
  if (v != null && type === 'url' && isTaxId(id) && !(ctx.opts.ownPageKey && id === TAX_PREFIX + ctx.opts.ownPageKey)) {
    const own = urlKey(ctx.pageUrl);
    if (own && urlKey(v, ctx.pageUrl) === own) return null;
  }
  return v;
}

/** C6: first raw (non-flattened) value at a JSON-LD path. */
function walkRaw(v: unknown, path: string[]): unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => walkRaw(x, path));
  if (path.length === 0) return [v];
  if (typeof v !== 'object') return [];
  const [head, ...rest] = path;
  if (head === '*') return walkRaw(v, rest);
  return walkRaw((v as LdObj)[head], rest);
}

function applyLocatorRaw(
  loc: Locator,
  type: FieldType,
  id: string,
  ctx: { pageUrl: string; objs: () => LdObj[]; $: () => $T | null; siteEntityNames: Set<string>; opts: ApplyOptions; values?: Record<string, unknown> },
): unknown {
  const flags: ValidateFlags = { action: !!ctx.opts.actionIds?.has(id) };
  try {
    if (isAlias(loc)) {
      return validateValue(type, ctx.values?.[loc.from], ctx.pageUrl, id, flags);
    }
    if (isClassifier(loc)) {
      return validateValue(type, classifierValue(loc, ctx as Ctx), ctx.pageUrl, id, flags);
    }
    if (isDerived(loc)) {
      const src = ctx.values?.[loc.derived_from];
      return validateValue(type, deriveAddressPart(src, loc.part), ctx.pageUrl, id, flags);
    }
    if (loc.tier === 'jsonld') {
      let objs = ctx.objs();
      if (loc.prefer?.length) {
        const pref = new Set(loc.prefer.map((t) => t.toLowerCase()));
        const hit = (o: LdObj) => typesOf(o).some((t) => pref.has(t.toLowerCase()));
        objs = [...objs.filter(hit), ...objs.filter((o) => !hit(o))];
      }
      for (const o of objs) {
        if (classifySubject(o, ctx.siteEntityNames, ctx.opts) !== loc.subject) continue;
        if (type === 'address' || type === 'geo') {
          for (const r of walkRaw(o, loc.path)) {
            const v = validateValue(type, r, ctx.pageUrl, id, flags);
            if (v != null) return v;
          }
          continue;
        }
        let vals = extractJsonLd(o, loc.path);
        // Fix (shared-property item filter on single values, 2026-10-22): one value holding a separated list
        // ("Asian, Chinese, Sushi") is matched item by item too, so keys sharing a property never all take the whole string.
        const oneSeparated = vals.length === 1 && typeof vals[0] === 'string' && /[,;|]/.test(vals[0] as string);
        if (loc.item_words && (type === 'list' || vals.length > 1 || oneSeparated)) {
          vals = loc.item_words.length ? filterItems(vals, loc.item_words) : [];
        }
        const v = validateValue(type, toRaw(type, vals), ctx.pageUrl, id, flags);
        if (v != null) return v;
      }
      return null;
    }
    const $ = ctx.$();
    if (!$) return null;
    // Staging schema: actions read every matched button / link as "label␟url".
    if (!isTaxId(id) && !isExtraId(id) && keyOf(id) === 'actions' && loc.tier === 'css' && !isDerived(loc)) {
      return validateValue(type, readActions($, loc as CssLocator, ctx.pageUrl), ctx.pageUrl, id, flags);
    }
    // Staging schema: videos (objects) and gallery images (URLs).
    if (!isTaxId(id) && !isExtraId(id) && keyOf(id) === 'videos' && loc.tier === 'css' && !isDerived(loc)) {
      return readVideos($, loc as CssLocator, ctx.pageUrl);
    }
    if (!isTaxId(id) && !isExtraId(id) && keyOf(id) === 'gallery' && loc.tier === 'css' && !isDerived(loc)) {
      return readImages($, loc as CssLocator, ctx.pageUrl);
    }
    // Staging schema: structured entries (awards, education) read as objects, one per matched block.
    if (!isTaxId(id) && !isExtraId(id) && type === 'list' && (loc as CssLocator).item_fields) {
      return readItems($, loc as CssLocator, ctx.pageUrl);
    }
    const faxGuard = type === 'phone' && (isTaxId(id) ? !/fax/i.test(id) : keyOf(id) !== 'fax');
    const extraMode = isExtraId(id);
    let raw = applyCss($, loc, faxGuard, type === 'url' && isTaxId(id), type === 'text' && !loc.multi, type === 'list', extraMode);
    if (loc.item_words && raw != null) {
      const items = loc.item_words.length ? filterItems(raw, loc.item_words) : [];
      raw = items.length ? (type === 'list' ? items : items[0]) : null;
    }
    // Staging schema: the locator call decided that comma-separated parts are separate entries.
    if ((loc as CssLocator).split_commas && raw != null && (type === 'list' || extraMode)) {
      const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((x) => (typeof x === 'string' ? x.split(',') : [x]))
        .map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '' && x != null);
      raw = parts.length ? parts : null;
    }
    if (extraMode && raw != null) {
      // C14b: extras strip leading separators.
      raw = Array.isArray(raw)
        ? raw.map((x) => (typeof x === 'string' ? stripLeadingSeparator(x) : x)).filter((x) => x !== '')
        : typeof raw === 'string' ? stripLeadingSeparator(raw) : raw;
      if ((Array.isArray(raw) && raw.length === 0) || raw === '') raw = null;
    }
    return validateValue(type, raw, ctx.pageUrl, id, flags);
  } catch {
    return null;
  }
}

type Ctx = Parameters<typeof applyLocator>[3];

function ctxFor(input: string | ParsedDoc, pageUrl: string, siteEntityNames: Set<string>, opts: ApplyOptions): Ctx {
  if (typeof input !== 'string') {
    const d = input ?? { $: null, objs: [] };
    return { pageUrl, siteEntityNames, opts, objs: () => d.objs ?? [], $: () => d.$ ?? null };
  }
  const html = input;
  let objs: LdObj[] | null = null;
  let $c: $T | null | undefined;
  return {
    pageUrl,
    siteEntityNames,
    opts,
    objs: () => (objs ??= safe(() => orderByPageTie(collectJsonLdObjects(html), html, pageUrl, opts.primary), [] as LdObj[])),
    $: () => {
      if ($c === undefined) $c = safe(() => parseHtml(html ?? ''), null);
      return $c;
    },
  };
}

/** Subject of a taxonomy field: saved subject, else JSON-LD locator subject, else learning-time subject. */
function taxSubjectOf(id: string, f: FieldSpec, opts: ApplyOptions): Subject | null {
  const saved = (f as Partial<TaxonomyFieldSpec>).subject;
  if (saved) return saved;
  if (f.locator?.tier === 'jsonld') return (f.locator as JsonLdLocator).subject;
  return opts.taxSubjects?.[id] ?? null;
}

/** Apply a contract to one page. `input` is raw HTML or a pre-parsed document. */
export function applySiteContract(
  input: string | ParsedDoc,
  pageUrl: string,
  contract: Pick<SiteContract, 'fields'> & Partial<Pick<SiteContract, 'taxonomy_fields' | 'own_page_key' | 'firm_profile' | 'media_scan' | 'primary_subject'>>,
  siteEntityNames: Set<string>,
  opts0: ApplyOptions = {},
): {
  values: Record<string, unknown>; missing: string[]; rejected: string[]; rejectedAddress: string[];
  rejectedPhoto: string[]; firmRelabelled: string[];
} {
  const actionIds = new Set(opts0.actionIds ?? []);
  const logoIds = new Set(opts0.logoIds ?? []);
  for (const [slug, f] of Object.entries(contract?.taxonomy_fields ?? {})) {
    if (f.action) actionIds.add(TAX_PREFIX + slug);
    if (f.logo) logoIds.add(TAX_PREFIX + slug);
  }
  const opts: ApplyOptions = {
    ...opts0, ownPageKey: opts0.ownPageKey ?? contract?.own_page_key ?? null, actionIds, logoIds,
    primary: opts0.primary ?? (contract as Partial<Pick<SiteContract, 'primary_subject'>>)?.primary_subject,
  };
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  const rejected: string[] = [];
  const ctx = { ...ctxFor(input, pageUrl, siteEntityNames, opts), values };
  const entries: Array<[string, FieldSpec]> = [
    // C14: extra ids are never part of the contract values.
    ...Object.entries(contract?.fields ?? {}).filter(([id]) => !isExtraId(id)),
    ...Object.entries(contract?.taxonomy_fields ?? {}).map(
      ([slug, f]) => [TAX_PREFIX + slug, f] as [string, FieldSpec],
    ),
  ];
  // Pass 1: direct locators. Pass 2 (Fix 8): locators derived from address_block.
  // Pass 3 (C1): aliases of universal fields. Pass 4 (Fix 12): classifier fields.
  const pending: Array<[string, FieldSpec]> = [];
  const aliases: Array<[string, FieldSpec]> = [];
  const classified: Array<[string, FieldSpec]> = [];
  for (const [id, f] of entries) {
    if (isClassifier(f.locator)) { classified.push([id, f]); continue; }
    if (isAlias(f.locator)) { aliases.push([id, f]); continue; }
    if (isDerived(f.locator)) { pending.push([id, f]); continue; }
    let v = applyLocator(f.locator, f.type, id, ctx);
    if (v == null && f.backup) {
      if (isDerived(f.backup)) { pending.push([id, f]); continue; }
      v = applyLocator(f.backup, f.type, id, ctx);
    }
    if (v != null) values[id] = v;
  }
  for (const [id, f] of pending) {
    const loc = isDerived(f.locator) ? f.locator : f.backup!;
    const v = applyLocator(loc, f.type, id, ctx);
    if (v != null) values[id] = v;
  }
  for (const [id, f] of aliases) {
    const v = applyLocator(f.locator, f.type, id, ctx);
    if (v != null) values[id] = v;
  }
  for (const [id, f] of classified) {
    const v = applyLocator(f.locator, f.type, id, ctx);
    if (v != null) values[id] = v;
  }
  // Fix (business name checked against page heading, 2026-10-22): when the page's main heading sits at the start or
  // end of the business name and covers most of it (the name has extra words such as "About P.F.Chang's Birmingham"
  // against the heading "P.F. Chang's Birmingham"), the heading is the name; copies of the old value (category keys
  // read from the same source) take it too. Decided from the page itself, no word list.
  const bizName = values['location.business_name'];
  if (typeof bizName === 'string' && bizName.trim()) {
    const $h = ctx.$();
    const h1 = $h ? cleanText($h('h1').first().text()).replace(/\s+/g, ' ').trim() : '';
    const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const kh = h1 ? squash(h1) : '';
    const kb = squash(bizName);
    if (kh.length >= 3 && kh !== kb && (kb.startsWith(kh) || kb.endsWith(kh)) && kh.length >= 0.6 * kb.length) {
      for (const [id, v] of Object.entries(values)) if (v === bizName) values[id] = h1;
    }
  }
  // Staging schema: embedded videos in the main content when no rule gave any (new mappings only).
  if (contract?.media_scan && contract.primary_subject) {
    const vid = `${contract.primary_subject}.videos`;
    if (values[vid] == null) {
      const $ = ctx.$();
      const v = $ ? scanVideos($, pageUrl) : null;
      if (v) values[vid] = v;
    }
  }
  // C1 safety net: a non-person taxonomy value equal to the page's person name is not a value.
  const pn = values['person.name'] != null ? normVal(values['person.name']) : '';
  if (pn) {
    for (const [id, f] of entries) {
      if (!isTaxId(id) || values[id] == null) continue;
      const subj = taxSubjectOf(id, f, opts);
      if (subj && subj !== 'person' && normVal(values[id]) === pn) { delete values[id]; rejected.push(id); }
    }
  }
  // C8 address safety net: a non-address taxonomy value equal to / containing the page address.
  const rejectedAddress: string[] = [];
  const addr = pageAddressLines(values);
  if (addr.length) {
    for (const [id, f] of entries) {
      if (!isTaxId(id) || values[id] == null || f.type === 'address') continue;
      const nv = normVal(values[id]);
      if (nv && addr.some((a) => nv === a || nv.includes(a))) {
        delete values[id]; rejected.push(id); rejectedAddress.push(id);
      }
    }
  }
  // C9 logo net: a logo value equal to the page's person photo is not a logo.
  const rejectedPhoto: string[] = [];
  const photo = urlKey(values['person.photo_url'], pageUrl);
  if (photo) {
    for (const [id] of entries) {
      if (values[id] == null) continue;
      const isLogo = isTaxId(id) ? logoIds.has(id) : keyOf(id) === 'logo_url';
      if (!isLogo || urlKey(values[id], pageUrl) !== photo) continue;
      delete values[id];
      if (isTaxId(id)) { rejected.push(id); rejectedPhoto.push(id); }
    }
  }
  // C9: fill missing address parts from the universal parts when consistent.
  for (const [id, f] of entries) {
    if (!isTaxId(id) || f.type !== 'address') continue;
    const v = values[id];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const subj = taxSubjectOf(id, f, opts);
    if (subj !== 'location' && subj !== 'person') continue;
    const prefixes = subj === 'person' ? ['person', 'location'] : ['location'];
    const prefix = prefixes.find((p) => ['street', 'city', 'state', 'postal_code'].some((k) => values[`${p}.${k}`] != null));
    if (!prefix) continue;
    values[id] = fillAddressParts(v as StructuredAddress, {
      street: values[`${prefix}.street`], city: values[`${prefix}.city`],
      state: values[`${prefix}.state`], postal_code: values[`${prefix}.postal_code`],
    });
  }
  // C9: a person/branch taxonomy value equal to a firm_profile value belongs to the firm.
  const firmRelabelled: string[] = [];
  const firmVals = new Set(
    Object.values(contract?.firm_profile?.values ?? {}).map((x) => (x == null ? '' : normVal(x))).filter(Boolean),
  );
  if (firmVals.size) {
    for (const [id, f] of entries) {
      if (!isTaxId(id) || values[id] == null) continue;
      const subj = taxSubjectOf(id, f, opts);
      if (subj === 'firm') continue;
      if (firmVals.has(normVal(values[id]))) firmRelabelled.push(id);
    }
  }
  for (const [id] of entries) if (values[id] == null) missing.push(id);
  return { values, missing, rejected, rejectedAddress, rejectedPhoto, firmRelabelled };
}

function samePostal(a: unknown, b: unknown): boolean {
  const z = (x: unknown) => String(x ?? '').match(/\d{5}/)?.[0] ?? '';
  return !!z(a) && z(a) === z(b);
}

/** C9: fill missing parts only when the object agrees with the universal parts; never overwrite. */
export function fillAddressParts(
  a: StructuredAddress,
  u: { street?: unknown; city?: unknown; state?: unknown; postal_code?: unknown },
): StructuredAddress {
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : typeof x === 'number' ? String(x) : '');
  if (a.postalCode && str(u.postal_code) && !samePostal(a.postalCode, u.postal_code)) return a;
  const zipOk = !!a.postalCode && samePostal(a.postalCode, u.postal_code);
  const cityOk = !!a.addressLocality && !!str(u.city) && a.addressLocality.toLowerCase() === str(u.city).toLowerCase();
  if (!zipOk && !cityOk) return a;
  const out = { ...a };
  if (!out.streetAddress && str(u.street)) out.streetAddress = str(u.street);
  if (!out.addressLocality && str(u.city)) out.addressLocality = str(u.city);
  if (!out.addressRegion && str(u.state)) out.addressRegion = str(u.state);
  if (!out.postalCode && str(u.postal_code)) out.postalCode = str(u.postal_code);
  return out;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Learning helpers (used by mapSite)
// ---------------------------------------------------------------------------

/** JSON-LD objects identical on >= 2 sample pages are site-wide (firm). */
export function firmSignaturesAcross(samples: Sample[]): Set<string> {
  const count = new Map<string, number>();
  for (const s of samples) {
    const seen = new Set<string>();
    for (const o of docOf(s).objs) {
      const sig = jsonLdSignature(o);
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);
      count.set(sig, (count.get(sig) ?? 0) + 1);
    }
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([k]) => k));
}

export function buildJsonLdFields(
  samples: Sample[],
  primary: PrimarySubject,
  siteEntityNames: Set<string>,
): { fields: Record<string, FieldSpec>; firmSignatures: Set<string> } {
  const firmSignatures = samples.length >= 2 ? firmSignaturesAcross(samples) : new Set<string>();
  const opts = { firmSignatures };
  const perSample = samples.map((s) => docOf(s).objs);
  const fields: Record<string, FieldSpec> = {};
  const subjects: Subject[] = primary === 'person' ? ['person', 'location', 'firm'] : ['location', 'firm'];
  for (const subject of subjects) {
    const keys = KEYS_BY_SUBJECT[subject];
    for (const [key, paths] of Object.entries(JSONLD_PATHS[subject])) {
      const type = keys[key];
      let best: { path: string[]; hits: number; types: Set<string> } | null = null;
      for (const path of paths) {
        let hits = 0;
        const types = new Set<string>();
        samples.forEach((s, i) => {
          for (const o of perSample[i]) {
            if (classifySubject(o, siteEntityNames, opts) !== subject) continue;
            const v = validateValue(type, toRaw(type, extractJsonLd(o, path)), s.url, `${subject}.${key}`);
            if (v != null) { hits++; typesOf(o).forEach((t) => types.add(t)); break; }
          }
        });
        if (hits > 0 && (!best || hits > best.hits)) best = { path, hits, types };
      }
      if (best) {
        fields[`${subject}.${key}`] = {
          tier: 'jsonld',
          locator: { tier: 'jsonld', subject, types: [...best.types], path: best.path },
          type,
          hits: best.hits,
          samples: samples.length,
        };
      }
    }
  }
  return { fields, firmSignatures };
}

/** C9: merge per-coordinate rules on a geo key into one pair locator. */
function groupGeoRules(rules: Rule[], taxTypes: Record<string, FieldType>): Array<{ r: Rule; pair?: CssLocator }> {
  const out: Array<{ r: Rule; pair?: CssLocator }> = [];
  const parts = new Map<string, Partial<Record<'latitude' | 'longitude', Rule>>>();
  for (const r of rules) {
    if (r && typeof r.id === 'string' && taxTypes[r.id] === 'geo' && (r.part === 'latitude' || r.part === 'longitude')) {
      const g = parts.get(r.id) ?? {};
      if (!g[r.part]) g[r.part] = r;
      parts.set(r.id, g);
      continue;
    }
    out.push({ r });
  }
  for (const [, g] of parts) {
    if (!g.latitude || !g.longitude) { out.push({ r: (g.latitude ?? g.longitude)! }); continue; }
    const ok = (x: Rule) => (x.strategy === 'css' && !!x.css) || (x.strategy === 'label' && !!x.label);
    if (!ok(g.latitude) || !ok(g.longitude)) { out.push({ r: g.latitude }); continue; }
    out.push({
      r: g.latitude,
      pair: { tier: 'css', strategy: 'css', pair: { latitude: ruleToLocator(g.latitude), longitude: ruleToLocator(g.longitude) } },
    });
  }
  return out;
}

const CHROME_TAGS = new Set(['header', 'nav', 'footer', 'aside']);
const CHROME_ROLES = new Set(['banner', 'navigation', 'contentinfo', 'search']);
/** C9: element sits inside site chrome (and that chrome does not hold the page h1). */
function inChrome($: $T, el: any): boolean {
  const h1 = $('h1').first().get(0) as any;
  for (let cur = el; cur && cur.type === 'tag'; cur = cur.parent) {
    const tag = String(cur.tagName ?? cur.name ?? '').toLowerCase();
    const role = String(cur.attribs?.role ?? '').toLowerCase();
    if (CHROME_TAGS.has(tag) || CHROME_ROLES.has(role) || isChromeByName(cur)) {
      if (h1 && (cur === h1 || $(cur).find(h1).length > 0)) continue;
      return true;
    }
  }
  return false;
}

function findLabelEl($: $T, rawLabel: string): any {
  const label = normLabel(rawLabel ?? '').replace(/:$/, '');
  if (!label) return null;
  let found: any = null;
  $(LABEL_SEL).each((_, el) => {
    const text = $(el).contents().filter((__, n: any) => n.type === 'text').text();
    const tl = normLabel(text || ($(el).children().length === 0 ? $(el).text() : '')).replace(/:$/, '');
    if (tl && (tl === label || tl.startsWith(label))) { found = el; return false; }
    return undefined;
  });
  return found;
}

/** C9: the element(s) a CSS/label locator reads all sit in site chrome. */
export function locatorTargetsChrome($: $T, loc: CssLocator): boolean {
  try {
    if (loc.pair) return locatorTargetsChrome($, loc.pair.latitude) || locatorTargetsChrome($, loc.pair.longitude);
    if (loc.strategy === 'css') {
      if (!loc.css) return false;
      const els = $(loc.css).toArray();
      return els.length > 0 && els.every((el) => inChrome($, el));
    }
    const el = findLabelEl($, loc.label ?? '');
    return !!el && inChrome($, el);
  } catch {
    return false;
  }
}

function ruleToLocator(r: Rule): CssLocator {
  const loc: CssLocator = { tier: 'css', strategy: r.strategy };
  if (r.css) loc.css = r.css;
  if (r.label) loc.label = r.label;
  if (r.attr) loc.attr = r.attr;
  if (r.multi) loc.multi = true;
  if (r.split_commas) loc.split_commas = true;
  const itf = cleanItemFields(r.item_fields);
  if (itf) loc.item_fields = itf;
  return loc;
}

/** Sub-keys a structured entry rule may read (sanitised; css strings only). */
const ITEM_FIELD_KEYS = new Set(['title', 'year', 'issuer', 'description', 'url', 'school', 'degree']);
function cleanItemFields(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, css] of Object.entries(v as Record<string, unknown>)) {
    if (ITEM_FIELD_KEYS.has(k) && typeof css === 'string' && css.trim()) out[k] = css.trim().slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
}

function normVal(v: unknown): string {
  // C9: geo pairs compare by their coordinates.
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { latitude?: unknown }).latitude === 'number') {
    const g = v as { latitude: number; longitude: number };
    return `${g.latitude}_${g.longitude}`;
  }
  // C6: structured addresses compare by their text.
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { text?: unknown }).text === 'string') {
    return String((v as { text: string }).text).toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  const itemText = (x: unknown): string => {
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return String(o.url ?? o.title ?? o.name ?? o.school ?? o.text ?? JSON.stringify(o));
    }
    return String(x ?? '');
  };
  const s = Array.isArray(v) ? v.map(itemText).join('|') : String(v ?? '');
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * S4-1: distinct non-empty values over the ids that reach staging (identity ids
 * and 'tax.*'); helper ids, extras and metadata are ignored. The same value
 * under several keys counts once.
 */
export function countDistinctFields(values: Record<string, unknown>): number {
  const seen = new Set<string>();
  for (const [id, v] of Object.entries(values)) {
    if (isExtraId(id) || !(isTaxId(id) || isIdentityId(id))) continue;
    if (isEmptyValue(v)) continue;
    const nv = normVal(v);
    if (nv !== '') seen.add(nv);
  }
  return seen.size;
}

/**
 * Cross-field rule (Fix 2, 2026-09-25): a value identical to a DIFFERENT
 * field's value on the same page (e.g. city == phone) counts as a miss. Fields
 * sharing the same key across subjects (person.phone vs location.phone) are not
 * treated as different fields.
 */
function clashes(id: string, v: unknown, accepted: Record<string, unknown>): boolean {
  const nv = normVal(v);
  if (nv === '') return false;
  const key = keyOf(id);
  return Object.entries(accepted).some(
    ([oid, ov]) => oid !== id && !isTaxId(oid) && keyOf(oid) !== key && ov != null && normVal(ov) === nv,
  );
}

/**
 * Taxonomy variant: a taxonomy value clashes with a universal field of a
 * DIFFERENT value type (e.g. a text key equal to the phone). Taxonomy keys may
 * legitimately equal each other or a same-type universal field — those are
 * reported as taxonomy_duplicates instead.
 */
function clashesTax(
  type: FieldType,
  v: unknown,
  accepted: Record<string, unknown>,
  fields: Record<string, FieldSpec>,
): boolean {
  const nv = normVal(v);
  if (nv === '') return false;
  return Object.entries(accepted).some(
    ([oid, ov]) =>
      !isTaxId(oid) && ov != null && (fields[oid]?.type ?? fieldType(oid)) !== type &&
      !(type === 'address' && ADDRESS_FAMILY.has(keyOf(oid))) && normVal(ov) === nv,
  );
}

/** C8: universal keys that belong to the address type group for taxonomy clash checks. */
const ADDRESS_FAMILY = new Set(['address_block', 'street', 'city', 'state', 'postal_code']);

/** C8: normalised address lines of the page (address_block text, and street+city+state+postal_code). */
function pageAddressLines(values: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const subj of ['person', 'location']) {
    const b = values[`${subj}.address_block`];
    if (b != null) { const n = normVal(b); if (n) out.add(n); }
    const parts = ['street', 'city', 'state', 'postal_code'].map((k) => values[`${subj}.${k}`]);
    if (parts.every((p) => p != null)) { const n = parts.map(normVal).join(''); if (n) out.add(n); }
  }
  return [...out].filter((n) => n.length >= 8);
}

/**
 * Validate AI rules on every sample. Rules with hits >= 1 are added (as primary
 * when the id is new, as `backup` when JSON-LD already produced it). Returns the
 * ids whose rules all failed. Each sample is parsed once (docOf) and the
 * accepted fields' values are computed once, then updated incrementally.
 */
export function mergeCssRules(
  fields: Record<string, FieldSpec>,
  rules: Rule[],
  samples: Sample[],
  primary: PrimarySubject,
  siteEntityNames: Set<string>,
  opts: ApplyOptions = {},
  /** Taxonomy ids ('tax.<slug>') and C14 extra ids ('extra.<key>') accepted in the same call, with their value types. */
  taxTypes: Record<string, FieldType> = {},
  /** Fix 12c: distinctive words for shared multi-value taxonomy keys (see taxonomyItemWords). */
  taxItemWords: Record<string, string[]> = {},
): { fields: Record<string, FieldSpec>; failed: string[]; extraReasons: Record<string, ExtraDropReason>; extraFound: Record<string, number>; rejected: Record<string, RejectedRule> } {
  const allowed = new Set([...allFieldIds(primary), ...Object.keys(taxTypes)]);
  const rejected: Record<string, RejectedRule> = {};
  const out = { ...fields };
  const failed = new Set<string>();
  const passed = new Set<string>();
  const extraReasons: Record<string, ExtraDropReason> = {};
  // C14a: per-extra-id count of samples where the locator returned any value.
  const extraFound: Record<string, number> = {};
  const ctxs = samples.map((s) => ctxFor(docOf(s), s.url, siteEntityNames, opts));
  const accepted = samples.map((s) => applySiteContract(docOf(s), s.url, { fields: out }, siteEntityNames, opts).values);
  for (const { r, pair } of groupGeoRules(Array.isArray(rules) ? rules : [], taxTypes)) {
    if (!r || typeof r.id !== 'string' || !allowed.has(r.id)) continue;
    const extra = isExtraId(r.id);
    const fail = (reason: ExtraDropReason = 'rule_failed_validation', why: RejectedWhy = 'incomplete_rule', found = 0) => {
      failed.add(r.id);
      if (extra && !extraReasons[r.id]) extraReasons[r.id] = reason;
      // Fix (rejected rules kept, 2026-10-22): fixed fields keep the rejected rule and the reason (extras have extra_dropped).
      if (!extra && !isTaxId(r.id)) {
        const { id: _omit, ...diag } = r;
        rejected[r.id] = { rule: diag, found, samples: samples.length, why };
      }
    };
    if (r.strategy !== 'css' && r.strategy !== 'label') { fail(); continue; }
    if (r.strategy === 'css' && !r.css) { fail(); continue; }
    if (r.strategy === 'label' && !r.label) { fail(); continue; }
    // Fix 19: a label rule anchored on the site's own brand name is rejected.
    if (
      r.strategy === 'label' &&
      siteEntityNames.has(r.label!.trim().toLowerCase().replace(/:+\s*$/, ''))
    ) { fail(undefined, 'label_is_brand_name'); continue; }
    const tax = isTaxId(r.id) || extra;
    const type = tax ? taxTypes[r.id] : fieldType(r.id)!;
    const locator = pair ?? ruleToLocator(r);
    // C11: selecting by the text itself is not a structural rule.
    if (isValueAnchored(locator)) { fail(undefined, 'anchored_on_value'); continue; }
    if (tax && taxItemWords[r.id]) locator.item_words = taxItemWords[r.id];
    // C9: advisor-page rules never read site chrome (header/footer/nav).
    // Fix (page-specific footer values, 2026-10-22): a rule into the header / footer / navigation is kept when its value
    // differs between the sample pages (page-specific data the site places there, such as a branch address in the
    // footer); identical on every sample it is site chrome and rejected as before.
    let chrome = false;
    const inChromeAt: boolean[] = [];
    let vals = ctxs.map((c) => {
      const $ = c.$();
      inChromeAt.push(!!$ && locatorTargetsChrome($, locator));
      return applyLocator(locator, type, r.id, c);
    });
    if (inChromeAt.some(Boolean)) {
      const chromeVals = vals.filter((v, i) => inChromeAt[i] && v != null).map((v) => normVal(v));
      if (new Set(chromeVals).size < 2) {
        chrome = true;
        vals = vals.map((v, i) => (inChromeAt[i] ? null : v));
      }
    }
    // C14 / S4-0: an extra value equal to an identity or taxonomy value on the same sample is a duplicate (helper ids ignored).
    const extraClash = (v: unknown, acc: Record<string, unknown>) => {
      const nv = normVal(v);
      return nv !== '' && Object.entries(acc).some(([oid, ov]) =>
        !isExtraId(oid) && (isTaxId(oid) || isIdentityId(oid)) && ov != null && normVal(ov) === nv);
    };
    const found = vals.filter((v) => v != null).length;
    if (extra) extraFound[r.id] = found;
    const hits = vals.filter(
      (v, i) => v != null && !(extra ? extraClash(v, accepted[i]) : tax ? clashesTax(type, v, accepted[i], out) : clashes(r.id, v, accepted[i])),
    ).length;
    if (hits < 1 || isValueAnchored(locator, vals)) {
      fail(
        chrome && found === 0 ? 'chrome' : found > 0 && hits < 1 && extra ? 'duplicate_value' : 'rule_failed_validation',
        chrome && found === 0 ? 'site_chrome' : hits >= 1 ? 'anchored_on_value' : found > 0 ? 'clashes_with_other_field' : 'no_value_on_samples',
        found,
      );
      continue;
    }
    passed.add(r.id);
    if (extra) {
      // Extras never enter `accepted` (they do not take part in other fields' clash checks).
      if (!out[r.id]) out[r.id] = { tier: 'css', locator, type, hits, samples: samples.length };
      continue;
    }
    const existing = out[r.id];
    if (existing && isDerived(existing.locator)) {
      // Fix 8: a direct rule wins over a derived one; the derived one becomes backup.
      out[r.id] = { tier: 'css', locator, type, hits, samples: samples.length, backup: existing.locator };
      vals.forEach((v, i) => { if (v != null) accepted[i][r.id] = v; });
      continue;
    }
    if (existing) {
      if ((existing.tier === 'jsonld' || existing.kept_from_previous) && !existing.backup) {
        // C10: a rule kept from the previous contract stays primary; the new one becomes backup.
        out[r.id] = { ...existing, backup: locator };
        vals.forEach((v, i) => { if (v != null && accepted[i][r.id] == null) accepted[i][r.id] = v; });
      }
      continue;
    }
    out[r.id] = { tier: 'css', locator, type, hits, samples: samples.length };
    vals.forEach((v, i) => { if (v != null) accepted[i][r.id] = v; });
  }
  addDerivedAddressFields(out, samples, siteEntityNames, opts);
  for (const id of passed) { delete extraReasons[id]; delete rejected[id]; }
  return { fields: out, failed: [...failed].filter((id) => !passed.has(id)), extraReasons, extraFound, rejected };
}

// ---------------------------------------------------------------------------
// C14: extra fields (staging only; ids 'extra.<key>')
// ---------------------------------------------------------------------------

export const EXTRA_FIELDS_CAP = 20;
export const EXTRA_DROPPED_CAP = 40;

/** Lowercase, non-alphanumerics → '_', collapse/trim underscores, max 60 chars. */
export function normalizeExtraKey(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/g, '');
}

/** C14c: a key is static when it is a universal name or `<person|location|firm>_<universal name>`. */
export function isStaticExtraKey(key: string, universalNames: Set<string>): boolean {
  if (universalNames.has(key)) return true;
  const m = /^(person|location|firm)_(.+)$/.exec(key);
  return !!m && universalNames.has(m[2]);
}

/** Words of a key (trailing 's' removed on words longer than 3 letters), sorted and deduped, joined by '_'. */
export function extraKeyWords(key: string): string {
  const words = normalizeExtraKey(key)
    .split('_')
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  return [...new Set(words)].sort().join('_');
}

/** C14b: generic filler words that do not make two extra keys the same concept. */
const EXTRA_FILLER_WORDS = new Set(['list', 'item', 'items', 'info', 'information', 'detail', 'details', 'text', 'section', 'page', 'value', 'data', 'other']);
/** C14b: meaningful words (4+ letters, trailing 's' removed, filler words skipped). */
export function meaningfulWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of String(s ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (w.length < 4 || EXTRA_FILLER_WORDS.has(w)) continue;
    const b = w.endsWith('s') ? w.slice(0, -1) : w;
    if (EXTRA_FILLER_WORDS.has(b)) continue;
    out.add(b);
  }
  return out;
}
/** C14b: true when the two texts share at least one meaningful word. */
export function sharesMeaningfulWord(a: string, b: string): boolean {
  const wb = meaningfulWords(b);
  for (const w of meaningfulWords(a)) if (wb.has(w)) return true;
  return false;
}

/** C14b: lowercase, punctuation → space, collapse whitespace. */
function normAgree(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** C14b: items of the AI sample used for the agreement check. */
export function extraSampleItems(sample: string): string[] {
  const raw = String(sample ?? '').replace(/(\.\.\.|…)\s*$/, '');
  const items = raw.split(/[,\n•·;|]/).map(normAgree).filter((x) => x.length >= 3);
  if (items.length === 1) return [items[0].slice(0, 40).trim()];
  return items;
}
/** C14b: the rule agrees when one sample item is contained in the value of sample 1 or 2. */
export function extraSampleAgrees(sample: string | undefined, values: unknown[]): boolean {
  const items = extraSampleItems(sample ?? '');
  if (!items.length) return false;
  const texts = values
    .filter((v) => v != null)
    .map((v) => normAgree(Array.isArray(v) ? v.map(String).join(' \n ') : typeof v === 'object' ? JSON.stringify(v) : String(v)));
  return texts.some((t) => t && items.some((it) => t.includes(it)));
}

/**
 * C14b: for a multi extra rule whose matches sit in several parent containers,
 * choose the container whose text contains an AI sample item and store how to
 * find it again (nearest heading, else index). Unchanged when not needed.
 */
export function chooseExtraContainer(loc: CssLocator, inputs: Array<string | ParsedDoc>, sample: string | undefined): CssLocator {
  if (!loc || loc.strategy !== 'css' || !loc.css || !loc.multi) return loc;
  const items = extraSampleItems(sample ?? '');
  if (!items.length) return loc;
  for (const input of inputs) {
    const $ = ctxFor(input, '', new Set(), {}).$();
    if (!$) continue;
    let list: any[];
    try { list = $(loc.css).toArray(); } catch { continue; }
    const { parents } = groupByParent(list);
    if (parents.length < 1) continue;
    for (let i = 0; i < parents.length; i++) {
      const t = normAgree(extraText(parents[i]));
      if (!items.some((it) => t.includes(it))) continue;
      const { container_heading: _h, container_index: _i, ...base } = loc;
      // C14c: always record the heading, also when the samples show one container.
      const heading = nearestHeading($, parents[i]);
      if (heading) return { ...base, container_heading: heading };
      if (parents.length > 1) return { ...base, container_index: i };
      break;
    }
  }
  return loc;
}

/**
 * Move accepted 'extra.*' specs out of `fields` into `extra_fields`.
 * C14b: a value on fewer than 2 samples is low_support; when ≥3 samples have a
 * value and the most common value (longer than 30 chars) is on ≥60% of them,
 * it is site_wide_value; cap 20.
 */
export function finalizeExtraFields(
  fields: Record<string, FieldSpec>,
  extraMeta: Record<string, { label: string; key_source: ExtraFieldSpec['key_source']; sample?: string }>,
  perSampleValues: Array<Record<string, unknown>>,
  sampleCount: number,
): { fields: Record<string, FieldSpec>; extra_fields: Record<string, ExtraFieldSpec>; dropped: ExtraDropped[] } {
  const rest: Record<string, FieldSpec> = {};
  const extra_fields: Record<string, ExtraFieldSpec> = {};
  const dropped: ExtraDropped[] = [];
  // C14a: the validated rule (no id) from a spec's css/label locator, for diagnostics.
  const ruleOf = (f: FieldSpec): Omit<Rule, 'id'> | undefined => {
    const l = f.locator as CssLocator;
    if (!l || l.tier !== 'css' || (l.strategy !== 'css' && l.strategy !== 'label')) return undefined;
    const r: Omit<Rule, 'id'> = { strategy: l.strategy };
    if (l.css) r.css = l.css;
    if (l.label) r.label = l.label;
    if (l.attr) r.attr = l.attr;
    if (l.multi) r.multi = true;
    return r;
  };
  const textLen = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'string' ? v : JSON.stringify(v)).trim().length;
  for (const [id, f] of Object.entries(fields)) {
    if (!isExtraId(id)) { rest[id] = f; continue; }
    const key = id.slice(EXTRA_PREFIX.length);
    const meta = extraMeta[key] ?? { label: key, key_source: 'new' as const };
    const vals = perSampleValues.map((v) => v[key]).filter((v) => v != null);
    const diag = { rule: ruleOf(f), found: vals.length, samples: sampleCount };
    if (vals.length >= 3) {
      const counts = new Map<string, { n: number; v: unknown }>();
      for (const v of vals) {
        const k = normVal(v);
        const c = counts.get(k);
        if (c) c.n++; else counts.set(k, { n: 1, v });
      }
      const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
      if (top && top.n / vals.length >= 0.6 && textLen(top.v) > 30) {
        dropped.push({ label: meta.label, key, reason: 'site_wide_value', ...diag });
        continue;
      }
    }
    if (vals.length < 2) { dropped.push({ label: meta.label, key, reason: 'low_support', ...diag }); continue; }
    if (Object.keys(extra_fields).length >= EXTRA_FIELDS_CAP) continue;
    const spec: ExtraFieldSpec = { ...f, hits: vals.length, samples: sampleCount, label: meta.label, key_source: meta.key_source };
    if (meta.sample) spec.sample = String(meta.sample).slice(0, 200);
    // C14c: up to 3 distinct example values (lists joined with "; "), max 120 chars each.
    const examples: string[] = [];
    for (const v of vals) {
      const t = (Array.isArray(v) ? v.map(String).join('; ') : typeof v === 'string' ? v : JSON.stringify(v)).trim().slice(0, 120);
      if (t && !examples.includes(t)) examples.push(t);
      if (examples.length >= 3) break;
    }
    spec.examples = examples;
    extra_fields[key] = spec;
  }
  return { fields: rest, extra_fields, dropped };
}

/** Apply `contract.extra_fields` to one page; returns { key: value } for non-empty values. */
/* Fix (taxonomy copies on profile-API records, 2026-10-15): a record built from the site's profile API (or merged
   from the API and the page) never ran the value-only rules of the contract, because those run inside
   applySiteContract while the page is read. applyValueRules runs them on a finished value map, with no page:
   derived rules (parts of an address block) fill ids that are still empty, and alias rules (a taxonomy key that
   copies a universal field, e.g. full_legal_name <- person.name) are set from the merged value so the copy always
   follows the record. The person-name safety net of applySiteContract (C1) applies to the ids it sets. Generic:
   driven only by the contract's own rules. */
export function applyValueRules(
  values: Record<string, unknown>,
  contract: Pick<SiteContract, 'fields'> & Partial<Pick<SiteContract, 'taxonomy_fields' | 'own_page_key' | 'primary_subject'>>,
  pageUrl: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  const actionIds = new Set<string>();
  for (const [slug, f] of Object.entries(contract?.taxonomy_fields ?? {})) if (f.action) actionIds.add(TAX_PREFIX + slug);
  const opts: ApplyOptions = { ownPageKey: contract?.own_page_key ?? null, actionIds, primary: contract?.primary_subject };
  const ctx = { ...ctxFor({ $: null, objs: [] }, pageUrl, new Set<string>(), opts), values: out };
  const entries: Array<[string, FieldSpec]> = [
    ...Object.entries(contract?.fields ?? {}).filter(([id]) => !isExtraId(id)),
    ...Object.entries(contract?.taxonomy_fields ?? {}).map(([slug, f]) => [TAX_PREFIX + slug, f] as [string, FieldSpec]),
  ];
  const set: string[] = [];
  for (const [id, f] of entries) {
    const loc = isDerived(f.locator) ? f.locator : f.backup && isDerived(f.backup) ? f.backup : null;
    if (!loc || !isEmptyValue(out[id])) continue;
    const v = applyLocator(loc, f.type, id, ctx);
    if (v != null) { out[id] = v; set.push(id); }
  }
  for (const [id, f] of entries) {
    if (!isAlias(f.locator) || isEmptyValue(out[f.locator.from])) continue;
    const v = applyLocator(f.locator, f.type, id, ctx);
    if (v != null) { out[id] = v; set.push(id); }
  }
  const pn = out['person.name'] != null ? normVal(out['person.name']) : '';
  if (pn) {
    const byId = new Map(entries);
    for (const id of set) {
      const f = byId.get(id);
      if (!f || !isTaxId(id)) continue;
      const subj = taxSubjectOf(id, f, opts);
      if (subj && subj !== 'person' && normVal(out[id]) === pn) delete out[id];
    }
  }
  return out;
}

export function applyExtraFields(
  input: string | ParsedDoc,
  pageUrl: string,
  contract: Partial<Pick<SiteContract, 'extra_fields'>>,
  siteEntityNames: Set<string>,
  opts: ApplyOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const specs = Object.entries(contract?.extra_fields ?? {});
  if (!specs.length) return out;
  const ctx = ctxFor(input, pageUrl, siteEntityNames, opts);
  for (const [key, f] of specs) {
    if (!f?.locator) continue;
    let v = applyLocator(f.locator, f.type, EXTRA_PREFIX + key, ctx);
    if (v == null && f.backup) v = applyLocator(f.backup, f.type, EXTRA_PREFIX + key, ctx);
    if (v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)) continue;
    out[key] = v;
  }
  return out;
}

const ADDRESS_PARTS: AddressPart[] = ['street', 'city', 'state', 'postal_code'];

/**
 * Fix 8: when <subject>.address_block is mapped, add city/state/postal_code/street
 * for the same subject derived from it. A directly mapped field keeps its
 * locator and gets the derived one as backup (if it has none).
 */
export function addDerivedAddressFields(
  fields: Record<string, FieldSpec>,
  samples: Sample[],
  siteEntityNames: Set<string>,
  opts: ApplyOptions = {},
): void {
  for (const subject of ['location', 'person', 'firm'] as const) {
    const src = `${subject}.address_block`;
    if (!fields[src]) continue;
    for (const part of ADDRESS_PARTS) {
      const id = `${subject}.${part}`;
      const derived: DerivedLocator = { tier: 'css', derived_from: src, part };
      const existing = fields[id];
      if (existing) {
        if (!isDerived(existing.locator) && !existing.backup) fields[id] = { ...existing, backup: derived };
        continue;
      }
      fields[id] = { tier: 'css', locator: derived, type: fieldType(id)!, hits: 0, samples: samples.length };
    }
  }
  const per = samples.map((s) => applySiteContract(docOf(s), s.url, { fields }, siteEntityNames, opts).values);
  for (const [id, f] of Object.entries(fields)) {
    if (!isDerived(f.locator)) continue;
    const hits = per.filter((v) => v[id] != null).length;
    if (hits < 1) delete fields[id];
    else fields[id] = { ...f, hits };
  }
}

// Fix 7 (2026-09-25, replaces Fix 4): the address is learned once, on the
// location. When ANY location address field was found by any tier, the person
// address ids are not asked for and not reported as unmapped.
const PERSON_ADDRESS_IDS = ['person.street', 'person.city', 'person.state', 'person.postal_code', 'person.address_block'];
const LOCATION_ADDRESS_IDS = ['location.street', 'location.city', 'location.state', 'location.postal_code'];

function hasLocationAddress(fields: Record<string, FieldSpec>): boolean {
  return LOCATION_ADDRESS_IDS.some((id) => (fields[id]?.hits ?? 0) >= 1);
}

export function suppressedIds(fields: Record<string, FieldSpec>, primary: PrimarySubject): Set<string> {
  return primary === 'person' && hasLocationAddress(fields) ? new Set(PERSON_ADDRESS_IDS) : new Set();
}

/** Field ids the locator should be asked for after the JSON-LD tier. */
export function locatorTargetIds(jsonldFields: Record<string, FieldSpec>, primary: PrimarySubject): string[] {
  const skip = suppressedIds(jsonldFields, primary);
  // C9: firm ids are asked for in the brand-pass section (site chrome / homepage).
  return allFieldIds(primary).filter((id) => !jsonldFields[id] && !skip.has(id) && !id.startsWith('firm.'));
}

const FIRM_EQUIVALENT: Record<string, string> = {
  phone: 'firm.phone_main', logo_url: 'firm.logo_url', website: 'firm.website',
  social_links: 'firm.social_links', business_name: 'firm.firm_name',
};

export const MUST_HAVE_REQUIRED = ['name', 'phone|email', 'city', 'state'];

export function mustHaveIds(label: string, primary: PrimarySubject, nameOwner?: 'location' | null): string[] {
  switch (label) {
    case 'name':
      if (primary === 'person' && nameOwner === 'location') return ['person.name', 'location.business_name'];
      return [primary === 'person' ? 'person.name' : 'location.business_name'];
    case 'phone|email': return ['person.phone', 'person.email', 'location.phone', 'location.email'];
    case 'city': return ['person.city', 'location.city'];
    case 'state': return ['person.state', 'location.state'];
    default: return [];
  }
}

export function computeMustHave(
  fields: Record<string, FieldSpec>,
  primary: PrimarySubject,
  nameOwner?: 'location' | null,
): SiteContract['must_have'] {
  const missing = MUST_HAVE_REQUIRED.filter(
    (label) => !mustHaveIds(label, primary, nameOwner).some((id) => (fields[id]?.hits ?? 0) >= 1),
  );
  return { required: [...MUST_HAVE_REQUIRED], ok: missing.length === 0, missing };
}

/** Recompute hits, apply the firm-reclassification safeguard, and assemble the contract. */
export function finalizeSiteContract(args: {
  fields: Record<string, FieldSpec>;
  failed: string[];
  samples: Sample[];
  primary: PrimarySubject;
  siteEntityNames: Set<string>;
  unkeyed: Array<{ label: string; sample: string }>;
  opts?: ApplyOptions;
  /** Resolved taxonomy keys tried this run (see resolveTaxonomyKeys). */
  taxonomy?: TaxonomyKey[];
  /** Fix (rejected rules kept, 2026-10-22): rejected fixed-field rules from mergeCssRules, by field id. */
  rejectedRules?: Record<string, RejectedRule>;
}): SiteContract {
  const { samples, primary, siteEntityNames } = args;
  const opts = args.opts ?? {};
  const unmapped: SiteContract['unmapped'] = [];
  const applied = samples.map((s) => applySiteContract(docOf(s), s.url, { fields: args.fields }, siteEntityNames, opts));
  const perSample = applied.map((a) => a.values);
  const rejectedPerSample = applied.map((a) => a.rejected);
  const rejectedAddressPerSample = applied.map((a) => a.rejectedAddress);
  const rejectedPhotoPerSample = applied.map((a) => a.rejectedPhoto);
  const fields: Record<string, FieldSpec> = {};
  const dropped = new Set<string>();

  for (const [id, f] of Object.entries(args.fields)) {
    if (isTaxId(id)) continue; // taxonomy keys are finalised below
    if (isExtraId(id)) continue; // C14: extras are finalised by finalizeExtraFields
    const vals = perSample.map((v) => v[id]).filter((v) => v != null);
    const hits = vals.length;
    const [subject, key] = id.split('.');
    // Fix (state from one region, 2026-10-06): samples drawn from one area share their state or
    // country; that is not a site-wide value when the street or postal code differs between them.
    const regionKey = key === 'state' || key === 'country';
    const addressVaries = regionKey && ['street', 'postal_code'].some((k) => {
      const av = perSample.map((v) => v[`${subject}.${k}`]).filter((v) => v != null).map((v) => JSON.stringify(v));
      return new Set(av).size > 1;
    });
    const siteWide =
      subject !== 'firm' &&
      !addressVaries &&
      hits >= 3 &&
      hits === samples.length &&
      vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0]));
    // Fix (site-wide location fields kept, 2026-10-22): in a location-first contract a location field identical on every
    // sample (a chain's opening hours, for example) is still each location's own fact and stays on the location.
    // Brand-level keys (FIRM_EQUIVALENT: phone, logo, website, social links, name) and the other contact keys (email,
    // fax: a central line) keep the rule below. A dropped value is recorded as site_wide_value (it said
    // rule_failed_validation before).
    const keepOnLocation = siteWide && primary === 'location' && subject === 'location'
      && !FIRM_EQUIVALENT[key] && key !== 'email' && key !== 'fax';
    if (siteWide && !keepOnLocation) {
      const firmId = FIRM_EQUIVALENT[key];
      if (firmId) {
        if (!args.fields[firmId] && !fields[firmId]) {
          fields[firmId] = { ...f, type: fieldType(firmId)!, hits, samples: samples.length };
        }
      } else {
        dropped.add(id);
        unmapped.push({ id, reason: 'site_wide_value' });
      }
      continue;
    }
    if (hits >= 1) fields[id] = { ...f, hits, samples: samples.length };
    // C11: a homepage-only firm value has no sample hits but stays for the firm profile.
    else if (subject === 'firm' && f.homepage_only) fields[id] = { ...f, hits: 0, samples: samples.length };
  }

  // Fix 7: person address rules are kept only where they differ from the
  // location address on the samples; otherwise the location owns the address.
  let addressOwner: SiteContract['address_owner'] = null;
  if (hasLocationAddress(fields)) addressOwner = 'location';
  if (primary === 'person' && hasLocationAddress(fields)) {
    for (const pid of PERSON_ADDRESS_IDS) {
      if (!fields[pid]) continue;
      const lid = 'location.' + keyOf(pid);
      const distinct = perSample.some((v) => v[pid] != null && normVal(v[pid]) !== normVal(v[lid]));
      if (!distinct) delete fields[pid];
    }
  }
  // Fix 8: derived locators whose address_block source was dropped go too.
  for (const [id, f] of Object.entries(fields)) {
    if (isDerived(f.locator) && !fields[f.locator.derived_from]) delete fields[id];
    else if (isDerived(f.backup) && !fields[f.backup.derived_from]) { const { backup: _b, ...rest } = f; fields[id] = rest; }
  }
  if (primary === 'person' && PERSON_ADDRESS_IDS.some((id) => fields[id])) addressOwner = 'person';

  const failed = new Set(args.failed);
  const skip = suppressedIds(fields, primary);
  for (const id of allFieldIds(primary)) {
    if (fields[id] || dropped.has(id) || skip.has(id)) continue;
    const rr = failed.has(id) ? args.rejectedRules?.[id] : undefined;
    unmapped.push({ id, reason: failed.has(id) ? 'rule_failed_validation' : 'not_found_on_samples', ...(rr ?? {}) });
  }

  const tax = finalizeTaxonomy(args.fields, failed, perSample, args.taxonomy ?? [], samples.length, fields, rejectedPerSample, rejectedAddressPerSample, rejectedPhotoPerSample, primary);

  // Fix (name owner, 2026-10-05): some sites describe one professional with a single
  // business-typed JSON-LD record (zillow.com: RealEstateAgent) and no Person record. When a
  // person contract has no person.name rule, no sample page has a Person record and the
  // business name was found, the name must-have is met by location.business_name (the harvest
  // already uses it as the identity name). Contracts with a person.name rule are unchanged.
  const anyPersonRecord = samples.some((s) =>
    docOf(s).objs.some((o) => classifySubject(o, siteEntityNames, opts) === 'person'));
  const nameOwner: SiteContract['name_owner'] =
    primary === 'person' && !fields['person.name'] && !anyPersonRecord &&
    (fields['location.business_name']?.hits ?? 0) >= 1 ? 'location' : null;

  return {
    version: 3,
    primary_subject: primary,
    fields,
    must_have: computeMustHave(fields, primary, nameOwner),
    address_owner: addressOwner,
    ...(nameOwner ? { name_owner: nameOwner } : {}),
    unmapped,
    unkeyed: (args.unkeyed ?? []).slice(0, 20),
    samples: samples.map((s) => s.url),
    learned_at: new Date().toISOString(),
    ...tax,
  };
}

// ---------------------------------------------------------------------------
// Taxonomy layer (category registry keys, ids 'tax.<node_slug>')
// ---------------------------------------------------------------------------
export type TaxonomyRow = {
  node_slug: string;
  node_name?: string | null;
  node_description?: string | null;
  schema_type?: string | null;
  schema_property?: string | null;
  entity_scope?: string | null;
  owns_lane?: string | null;
};

export type TaxonomyKey = {
  slug: string;
  id: string;
  type: FieldType;
  /** Subjects to try, in order (Fix 11: schema_type first, then entity_scope). */
  subjects: Subject[];
  scope: string | null;
  path: string[] | null;
  schema_type: string | null;
  node_name: string;
  node_description: string;
  /** Fix 12a/b: recognized by the sameAs / credential classifier. */
  classifier?: { kind: 'sameas' | 'credential'; label: string; match_text: string };
  /** Fix 12c: shared multi-value property → distinctive words ([] = none remain). */
  item_words?: string[];
  /** Fix 12c: set when a shared-property read found items but none matched. */
  ambiguous_seen?: boolean;
  /** Lowercased last segment of schema_property (C1 alias meaning). */
  prop_last?: string;
  /** C5: potentialAction key. */
  action?: boolean;
};

/** Keys a firm's own profile page could show: website-lane or unowned, never Question. */
export function filterTaxonomyRows<T extends TaxonomyRow>(rows: T[]): T[] {
  return (rows ?? []).filter(
    (r) => r && typeof r.node_slug === 'string' && r.node_slug &&
      !(r.owns_lane && r.owns_lane !== 'website') && r.schema_type !== 'Question',
  );
}

const TAX_TYPE_BY_PROP: Record<string, FieldType> = {
  telephone: 'phone', faxnumber: 'phone', email: 'email',
  url: 'url', sameas: 'url', image: 'url', logo: 'url', photo: 'url', potentialaction: 'url',
  address: 'address', geo: 'geo',
  hascredential: 'list', knowsabout: 'list', knowslanguage: 'list', award: 'list', memberof: 'list',
  alumniof: 'list', areaserved: 'list', hasoffercatalog: 'list', makesoffer: 'list', review: 'list',
  // C13: multi-valued by schema_property last segment.
  jobtitle: 'list', affiliation: 'list', availablelanguage: 'list', servicetype: 'list',
  employee: 'list', openinghours: 'list', openinghoursspecification: 'list',
  ratingvalue: 'number', reviewcount: 'number', numberofemployees: 'number', foundingdate: 'year',
};

export function taxonomyType(schemaProperty: string | null | undefined): FieldType {
  if (!schemaProperty) return 'text';
  const last = schemaProperty.split('.').filter(Boolean).pop() ?? '';
  return TAX_TYPE_BY_PROP[last.toLowerCase()] ?? 'text';
}

export const ORGANIZATION_TYPES = new Set([
  'organization', 'corporation', 'ngo', 'governmentorganization', 'educationalorganization',
]);
function isOrgType(t: string | null | undefined): boolean {
  return !!t && ORGANIZATION_TYPES.has(t.trim().toLowerCase());
}

/** Fix 11: subject from schema_type first; entity_scope only when schema_type is null. */
export function taxonomySubjects(
  scope: string | null | undefined,
  primary: PrimarySubject,
  schemaType?: string | null,
): Subject[] {
  const st = schemaType?.trim() || null;
  if (st) {
    if (st.toLowerCase() === 'person') return [primary === 'location' ? 'location' : 'person'];
    if (isOrgType(st)) return ['firm'];
    // Fix 18: a location-typed key reads location objects only — no firm fallback.
    return ['location'];
  }
  switch (scope) {
    case 'professional': return [primary === 'location' ? 'location' : 'person'];
    case 'location': return ['location'];
    case 'brand': return ['firm'];
    default: return primary === 'person' ? ['person', 'location', 'firm'] : ['location', 'firm'];
  }
}

/** Fix 12c: properties that hold one value — never item-filtered. */
const SCALAR_PROPS = new Set([
  'name', 'jobtitle', 'telephone', 'faxnumber', 'email', 'address', 'streetaddress', 'addresslocality',
  'addressregion', 'postalcode', 'addresscountry', 'url', 'image', 'logo', 'photo', 'description',
  'legalname', 'alternatename', 'foundingdate', 'ratingvalue', 'reviewcount', 'numberofemployees',
  'pricerange', 'latitude', 'longitude', 'geo', 'birthdate', 'gender', 'givenname', 'familyname',
]);
const ITEM_STOPWORDS = new Set([
  'advisor', 'professional', 'firm', 'company', 'business', 'profile', 'page', 'url', 'link', 'name',
  'listing', 'list', 'award', 'recognition', 'ranking', 'certification', 'credential', 'license',
  'designation', 'number', 'status', 'service', 'info', 'details', 'the', 'and', 'for', 'with',
]);
function propTokens(prop: string): string[] {
  return prop.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .concat(prop.toLowerCase());
}
export function distinctiveWords(slug: string, name: string, prop: string): string[] {
  const stop = new Set([...ITEM_STOPWORDS, ...propTokens(prop)]);
  const toks = `${slug} ${name}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !stop.has(t));
  return [...new Set(toks)];
}

export function resolveTaxonomyKeys(rows: TaxonomyRow[], primary: PrimarySubject): TaxonomyKey[] {
  const rowsF = filterTaxonomyRows(rows);
  const lastOf = (p: string | null | undefined) => (p?.split('.').filter(Boolean).pop() ?? '').trim();
  const propUse = new Map<string, Set<string>>();
  for (const r of rowsF) {
    const last = lastOf(r.schema_property).toLowerCase();
    if (!last) continue;
    propUse.set(last, (propUse.get(last) ?? new Set()).add(r.node_slug));
  }
  const seen = new Set<string>();
  const out: TaxonomyKey[] = [];
  for (const r of rowsF) {
    if (seen.has(r.node_slug)) continue;
    seen.add(r.node_slug);
    const prop = r.schema_property?.trim() || null;
    const last = lastOf(prop);
    const lastL = last.toLowerCase();
    const nodeName = String(r.node_name ?? r.node_slug);
    const k: TaxonomyKey = {
      slug: r.node_slug,
      id: TAX_PREFIX + r.node_slug,
      type: taxonomyType(prop),
      subjects: taxonomySubjects(r.entity_scope ?? null, primary, r.schema_type ?? null),
      scope: r.entity_scope ?? null,
      path: prop ? prop.split('.').filter(Boolean) : null,
      schema_type: r.schema_type?.trim() || null,
      node_name: nodeName,
      node_description: String(r.node_description ?? ''),
      prop_last: lastL,
      ...(lastL === 'potentialaction' ? { action: true } : {}),
    };
    const matchText = `${r.node_slug} ${nodeName}`;
    if (lastL === 'sameas' || lastL === 'hascredential') {
      // Fix 12a/b: recognized → classifier; unrecognized → no JSON-LD path read (CSS locator only).
      const kind = lastL === 'sameas' ? 'sameas' : 'credential';
      const r0 = kind === 'sameas' ? classifySameAs(matchText, []) : classifyCredential(matchText, []);
      if (r0.recognized) {
        const label = kind === 'sameas' ? (r0 as { platform: string }).platform : (r0 as { label?: string }).label ?? '';
        k.classifier = { kind, label, match_text: matchText };
        k.type = kind === 'sameas' ? 'url' : 'text';
      }
      k.path = null;
    } else if (lastL && !SCALAR_PROPS.has(lastL) && (propUse.get(lastL)?.size ?? 0) >= 2) {
      k.item_words = distinctiveWords(r.node_slug, nodeName, last);
    }
    out.push(k);
  }
  return out;
}

/** Map of 'tax.<slug>' → value type, for mergeCssRules. */
export function taxonomyTypes(keys: TaxonomyKey[]): Record<string, FieldType> {
  return Object.fromEntries(keys.map((k) => [k.id, k.type]));
}

/** Map of 'tax.<slug>' → distinctive words for shared multi-value keys, for mergeCssRules. */
export function taxonomyItemWords(keys: TaxonomyKey[]): Record<string, string[]> {
  return Object.fromEntries(keys.filter((k) => k.item_words).map((k) => [k.id, k.item_words!]));
}

/** Prompt lines: `tax.<slug> (type) — <node_name>: <description, 120 chars>`. */
/** C1: default subject label for the prompt (location shown as branch). */
export function defaultRoleOf(k: TaxonomyKey): 'person' | 'branch' | 'firm' {
  const s = k.subjects[0] ?? 'location';
  return s === 'location' ? 'branch' : s;
}

/** C1: compact list of ALL candidate keys with their default subject. */
export function taxonomyRoleLines(keys: TaxonomyKey[]): string {
  return keys.map((k) => `${k.id} [default: ${defaultRoleOf(k)}] ${k.node_name}`).join('\n');
}

/**
 * C1: apply locator-assigned roles. Returns role-adjusted keys, the saved roles
 * map, the own-page key (C2) and the ids whose subject changed. Unknown ids are ignored.
 */
export function applyTaxonomyRoles(
  keys: TaxonomyKey[],
  rawRoles: unknown,
  primary: PrimarySubject,
): { keys: TaxonomyKey[]; roles: Record<string, TaxonomyRole>; ownPageKey: string | null; changed: string[] } {
  const byId = new Map(keys.map((k) => [k.id, k]));
  const roles: Record<string, TaxonomyRole> = {};
  const changed: string[] = [];
  const next = new Map(keys.map((k) => [k.id, k]));
  let ownPageKey: string | null = null;
  const toSubject = (r: string): Subject | null =>
    r === 'person' ? (primary === 'location' ? 'location' : 'person') : r === 'branch' ? 'location' : r === 'firm' ? 'firm' : null;
  const list = Array.isArray(rawRoles) ? rawRoles : [];
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const role = typeof item?.role === 'string' ? item.role.trim() : '';
    const k = byId.get(id);
    if (!k) continue;
    if (role === 'own_page_url') continue; // decided after subject changes
    const s = toSubject(role);
    if (!s) continue;
    if (k.subjects.length === 1 && k.subjects[0] === s) continue;
    next.set(id, { ...k, subjects: [s] });
    roles[k.slug] = role as TaxonomyRole;
    changed.push(id);
  }
  for (const item of list) {
    if (ownPageKey) break;
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (item?.role !== 'own_page_url') continue;
    const k = next.get(id);
    if (!k || k.type !== 'url' || k.subjects[0] === 'firm') continue;
    ownPageKey = k.slug;
    roles[k.slug] = 'own_page_url';
  }
  return { keys: keys.map((k) => next.get(k.id)!), roles, ownPageKey, changed };
}

/** Learning-time subject per taxonomy id (first subject). */
export function taxonomySubjectMap(keys: TaxonomyKey[]): Record<string, Subject> {
  return Object.fromEntries(keys.map((k) => [k.id, k.subjects[0]]));
}

/** C9: ids of logo keys (schema_property last segment logo). */
export function taxonomyLogoIds(keys: TaxonomyKey[]): Set<string> {
  return new Set(keys.filter((k) => k.prop_last === 'logo').map((k) => k.id));
}

/** C5: ids of potentialAction keys. */
export function taxonomyActionIds(keys: TaxonomyKey[]): Set<string> {
  return new Set(keys.filter((k) => k.action).map((k) => k.id));
}

/** C1: universal field id carrying the same schema.org meaning for a subject. */
const ALIAS_BY_PROP: Record<string, Partial<Record<Subject, string>>> = {
  name: { person: 'person.name', location: 'location.business_name', firm: 'firm.firm_name' },
  telephone: { person: 'person.phone', location: 'location.phone', firm: 'firm.phone_main' },
  email: { person: 'person.email', location: 'location.email' },
  url: { location: 'location.website', firm: 'firm.website' },
  logo: { location: 'location.logo_url', firm: 'firm.logo_url' },
  image: { person: 'person.photo_url' },
};

/** C10: contact meanings that may fall back between the person and branch fields. */
const CONTACT_FALLBACK_PROPS = new Set(['telephone', 'email']);

/**
 * C1: give taxonomy keys without a locator an alias to a matching universal field.
 * C10: telephone/email keys of a branch (person) subject fall back to the person
 * (branch) field when their own universal field has no values. Firm keys excluded.
 */
export function addTaxonomyAliases(fields: Record<string, FieldSpec>, keys: TaxonomyKey[]): Record<string, FieldSpec> {
  const out = { ...fields };
  const has = (id: string | undefined) => !!id && !!out[id] && out[id].hits >= 1;
  for (const k of keys) {
    if (out[k.id]) continue;
    const last = (k.path?.[k.path.length - 1] ?? k.prop_last ?? '').toLowerCase();
    const subj = k.subjects[0];
    let from = ALIAS_BY_PROP[last]?.[subj];
    if (!has(from) && CONTACT_FALLBACK_PROPS.has(last) && (subj === 'location' || subj === 'person')) {
      const other = ALIAS_BY_PROP[last]?.[subj === 'location' ? 'person' : 'location'];
      if (has(other)) from = other;
    }
    if (!from || !has(from)) continue;
    const src = out[from];
    out[k.id] = { tier: 'alias', locator: { tier: 'alias', from }, type: k.type, hits: src.hits, samples: src.samples };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Staging schema step 2: contract routes (taxonomy → static, extra → static)
// ---------------------------------------------------------------------------

/** Helper ids an extra may feed (converted at harvest: years → year_started, licences / registrations → credentials). */
const ROUTE_HELPER_TARGETS = new Set(['person.years_experience', 'person.licenses', 'person.registration_ids']);
export function isRouteTarget(id: string): boolean {
  return isIdentityId(id) || ROUTE_HELPER_TARGETS.has(id);
}

/** List ids merge every source (page rule, category keys, extras); actions have their own merge. */
export function isMergeableId(id: string): boolean {
  return fieldType(id) === 'list' && keyOf(id) !== 'actions' && isRouteTarget(id);
}

/** Static id → schema.org properties (lower-case dotted path) with the same meaning. */
const ADDRESS_PROPS: Record<AddressPart, string[]> = {
  street: ['address.streetaddress', 'streetaddress'],
  city: ['address.addresslocality', 'addresslocality'],
  state: ['address.addressregion', 'addressregion'],
  postal_code: ['address.postalcode', 'postalcode'],
};
const STATIC_ROUTE_PROPS: Record<Subject, Record<string, string[]>> = {
  person: {
    name: ['name'], first_name: ['givenname'], last_name: ['familyname'], job_title: ['jobtitle'],
    bio: ['description'], photo_url: ['image', 'photo'], gallery: ['image', 'photo'], phone: ['telephone'], fax: ['faxnumber'],
    email: ['email'], languages: ['knowslanguage'], services: ['makesoffer', 'hasoffercatalog', 'servicetype'],
    specialties: ['knowsabout'], service_areas: ['areaserved'], awards: ['award'], education: ['alumniof'],
    ...ADDRESS_PROPS,
  },
  location: {
    business_name: ['name'], phone: ['telephone'], fax: ['faxnumber'], email: ['email'], website: ['url'],
    description: ['description'], logo_url: ['logo'], photo_url: ['image', 'photo'], gallery: ['image', 'photo'],
    hours: ['openinghours', 'openinghoursspecification'], latitude: ['geo.latitude', 'latitude'],
    longitude: ['geo.longitude', 'longitude'], ...ADDRESS_PROPS,
  },
  firm: {
    firm_name: ['name'], legal_name: ['legalname'], website: ['url'], logo_url: ['logo'],
    phone_main: ['telephone'], fax: ['faxnumber'], email: ['email'], description: ['description'],
    ...ADDRESS_PROPS,
  },
};

/** Static id an extra key names directly ('services', 'person_services'), when that id is open. */
export function staticTargetForKey(key: string, openIds: Set<string>, primary: PrimarySubject): string | null {
  const m = /^(person|location|firm)_(.+)$/.exec(key);
  const order: Subject[] = m ? [m[1] as Subject] : primary === 'person' ? ['person', 'location', 'firm'] : ['location', 'firm'];
  const k = m ? m[2] : key;
  for (const s of order) if (openIds.has(`${s}.${k}`)) return `${s}.${k}`;
  return null;
}

export type ExtraRouteCandidate = { static_id: string; source: 'name' | 'match' | 'sticky'; reason?: string };

/**
 * Builds contract.static_routes for static ids that have no page rule.
 * (a) taxonomy: same subject + same schema.org property, by code. Alias keys
 *     (copied from a static field), classifier keys (one platform / credential
 *     each) and item-filtered keys (one item of a shared list) are skipped.
 * (b) extra: candidates from the name / the matching call / the previous
 *     contract, kept only when every sample value of the extra passes the
 *     static key's own validation, on at least 2 samples, one extra per id.
 */
export function buildStaticRoutes(args: {
  fields: Record<string, FieldSpec>;
  taxonomyFields: Record<string, TaxonomyFieldSpec>;
  taxKeys: TaxonomyKey[];
  primary: PrimarySubject;
  extraFields: Record<string, ExtraFieldSpec>;
  extraCandidates: Record<string, ExtraRouteCandidate>;
  /** Extra values per sample ({ key: value }), from applyExtraFields with the final extras. */
  extraValues: Array<Record<string, unknown>>;
  sampleUrls: string[];
}): { routes: Record<string, StaticRoute[]>; dropped: StaticRouteDropped[] } {
  const routes: Record<string, StaticRoute[]> = {};
  const add = (sid: string, r: StaticRoute) => { (routes[sid] ??= []).push(r); };
  const dropped: StaticRouteDropped[] = [];
  const open = new Set(allFieldIds(args.primary).filter((id) => isRouteTarget(id) && !args.fields[id]));
  // A route may feed an id that has no page rule, or any list id (merged).
  const routable = (sid: string) => open.has(sid) || isMergeableId(sid);
  const keyById = new Map(args.taxKeys.map((k) => [k.id, k]));

  // (a0) action keys (schema.org potentialAction) of a subject all feed <subject>.actions (merged list).
  const allIds = new Set(allFieldIds(args.primary));
  for (const [slug, spec] of Object.entries(args.taxonomyFields ?? {})) {
    const id = TAX_PREFIX + slug;
    const k = keyById.get(id);
    if (!k?.action || isAlias(spec.locator) || isClassifier(spec.locator)) continue;
    const sid = `${spec.subject}.actions`;
    if (!allIds.has(sid)) continue;
    const r = routes[sid]?.[0];
    if (r && r.kind === 'taxonomy') r.from.push(id);
    else add(sid, { kind: 'taxonomy', from: [id], merge: true });
  }

  // (a) taxonomy → static
  type RoutePart = 'latitude' | 'longitude' | AddressPart;
  const bySource = new Map<string, Array<{ id: string; part?: RoutePart }>>();
  for (const [slug, spec] of Object.entries(args.taxonomyFields ?? {})) {
    const id = TAX_PREFIX + slug;
    const k = keyById.get(id);
    if (!k || !k.path?.length || k.action || isAlias(spec.locator) || isClassifier(spec.locator) || k.classifier || k.item_words) continue;
    const prop = k.path.join('.').toLowerCase();
    const subject = spec.subject;
    const props = STATIC_ROUTE_PROPS[subject] ?? {};
    // Image keys named like a collection (gallery, photos, library …) feed the gallery; other image keys the photo.
    const collection = /(gallery|galleries|photos|images|library|album|collection)/i.test(slug);
    for (const [key, list] of Object.entries(props)) {
      const sid = `${subject}.${key}`;
      if ((key === 'gallery' && !collection) || (key === 'photo_url' && collection)) continue;
      if (routable(sid) && list.includes(prop)) {
        const arr = bySource.get(sid) ?? [];
        arr.push({ id });
        bySource.set(sid, arr);
      }
    }
    // A whole geo / address value feeds its parts.
    if (k.type === 'geo' && subject === 'location') {
      for (const part of ['latitude', 'longitude'] as const) {
        const sid = `location.${part}`;
        if (open.has(sid)) bySource.set(sid, [...(bySource.get(sid) ?? []), { id, part }]);
      }
    }
    if (k.type === 'address') {
      for (const part of ADDRESS_PARTS) {
        const sid = `${subject}.${part}`;
        if (open.has(sid)) bySource.set(sid, [...(bySource.get(sid) ?? []), { id, part }]);
      }
    }
  }
  for (const [sid, srcs] of bySource) {
    // Mixed whole-value / part sources: keep the direct ones only.
    const direct = srcs.filter((x) => !x.part);
    const use = direct.length ? direct : srcs;
    const parts = new Set(use.map((x) => x.part ?? ''));
    if (parts.size > 1) { dropped.push({ static_id: sid, from: use.map((x) => x.id).join(','), reason: 'mixed_parts' }); continue; }
    const part = use[0].part;
    add(sid, { kind: 'taxonomy', from: [...new Set(use.map((x) => x.id))], ...(part ? { part } : {}), ...(isMergeableId(sid) ? { merge: true as const } : {}) });
  }

  // (b) extra → static
  const usedTargets = new Set<string>();
  const order = Object.entries(args.extraCandidates ?? {}).sort(([, a], [, b]) => {
    const rank = { sticky: 0, name: 1, match: 2 } as const;
    return rank[a.source] - rank[b.source];
  });
  for (const [key, c] of order) {
    const sid = c.static_id;
    const from = EXTRA_PREFIX + key;
    if (!isRouteTarget(sid) || !allFieldIds(args.primary).includes(sid)) { dropped.push({ static_id: sid, from, reason: 'not_a_static_id' }); continue; }
    if (!routable(sid)) { dropped.push({ static_id: sid, from, reason: 'static_has_page_rule' }); continue; }
    // Single-value ids: one extra (after any category route); list ids take several extras.
    if (!isMergeableId(sid) && usedTargets.has(sid)) { dropped.push({ static_id: sid, from, reason: 'static_already_routed' }); continue; }
    if (!args.extraFields?.[key]) { dropped.push({ static_id: sid, from, reason: 'extra_not_kept' }); continue; }
    const type = fieldType(sid);
    if (!type) { dropped.push({ static_id: sid, from, reason: 'not_a_static_id' }); continue; }
    let found = 0;
    let bad = 0;
    args.extraValues.forEach((vals, i) => {
      const v = vals?.[key];
      if (v == null || isEmptyValue(v)) return;
      found++;
      const ok = validateValue(type, v, args.sampleUrls[i] ?? '', sid);
      if (ok == null || isEmptyValue(ok)) bad++;
    });
    if (found < 2) { dropped.push({ static_id: sid, from, reason: 'low_support' }); continue; }
    // Brand (firm) values are the same on every page; a value that changes per page belongs to the person / office.
    if (sid.startsWith('firm.') && !isMergeableId(sid)) {
      const distinct = new Set(args.extraValues.map((vals) => vals?.[key]).filter((v) => v != null && !isEmptyValue(v)).map((v) => normVal(v)));
      if (distinct.size > 1) { dropped.push({ static_id: sid, from, reason: 'differs_across_pages' }); continue; }
    }
    if (bad > 0) { dropped.push({ static_id: sid, from, reason: `type_check_failed_${bad}_of_${found}` }); continue; }
    usedTargets.add(sid);
    add(sid, { kind: 'extra', from: key, source: c.source, ...(c.reason ? { reason: c.reason.slice(0, 300) } : {}) });
  }
  return { routes, dropped: dropped.slice(0, 40) };
}

export function taxonomyPromptLines(keys: TaxonomyKey[]): string {
  return keys
    .map((k) =>
      `${k.id} (${k.type}) [default: ${defaultRoleOf(k)}]${k.item_words ? ' (specific item only — not the whole list)' : ''} — ${k.node_name}: ` +
      `${k.node_description.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
    .join('\n');
}

/**
 * JSON-LD tier for taxonomy keys: the dotted schema_property path is read on
 * objects of the key's subject (objects of the key's schema_type first), on
 * every sample. Keys take the first subject with hits. Classifier keys (Fix 12)
 * always get a classifier spec so they are never sent to the locator.
 */
export function buildTaxonomyJsonLdFields(
  fields: Record<string, FieldSpec>,
  keys: TaxonomyKey[],
  samples: Sample[],
  siteEntityNames: Set<string>,
  opts: ApplyOptions = {},
): Record<string, FieldSpec> {
  const out = { ...fields };
  const universal = Object.fromEntries(Object.entries(fields).filter(([id]) => !isTaxId(id)));
  const ctxs = samples.map((s) => ({
    ...ctxFor(docOf(s), s.url, siteEntityNames, opts),
    values: applySiteContract(docOf(s), s.url, { fields: universal }, siteEntityNames, opts).values,
  }));
  for (const k of keys) {
    if (k.classifier) {
      const locator: ClassifierLocator = {
        tier: 'classifier', classifier: k.classifier.kind, label: k.classifier.label, match_text: k.classifier.match_text,
      };
      const hits = ctxs.filter((c) => applyLocator(locator, k.type, k.id, c) != null).length;
      out[k.id] = { tier: 'classifier', locator, type: k.type, hits, samples: samples.length };
      continue;
    }
    if (!k.path || (k.item_words && k.item_words.length === 0)) continue;
    for (const subject of k.subjects) {
      const locator: JsonLdLocator = {
        tier: 'jsonld', subject, types: k.schema_type ? [k.schema_type] : [], path: k.path,
        ...(k.schema_type ? { prefer: [k.schema_type] } : {}),
        ...(k.item_words ? { item_words: k.item_words } : {}),
      };
      const hits = ctxs.filter((c) => applyLocator(locator, k.type, k.id, c) != null).length;
      if (hits > 0) {
        out[k.id] = { tier: 'jsonld', locator, type: k.type, hits, samples: samples.length };
        break;
      }
      if (k.item_words) {
        const { item_words: _w, ...plain } = locator;
        if (ctxs.some((c) => applyLocator(plain, k.type, k.id, c) != null)) k.ambiguous_seen = true;
      }
    }
  }
  return out;
}

/** Taxonomy ids the locator should be asked for (not found in JSON-LD, not classifier, not ambiguous). */
export function taxonomyLocatorIds(fields: Record<string, FieldSpec>, keys: TaxonomyKey[]): string[] {
  return keys
    .filter((k) => !fields[k.id] && !k.classifier && !(k.item_words && k.item_words.length === 0))
    .map((k) => k.id);
}

function finalizeTaxonomy(
  fields: Record<string, FieldSpec>,
  failed: Set<string>,
  perSample: Record<string, unknown>[],
  keys: TaxonomyKey[],
  sampleCount: number,
  finalUniversal: Record<string, FieldSpec> = {},
  rejectedPerSample: string[][] = [],
  rejectedAddressPerSample: string[][] = [],
  rejectedPhotoPerSample: string[][] = [],
  primary: PrimarySubject = 'person',
): Pick<SiteContract, 'taxonomy_fields' | 'taxonomy_unmapped' | 'taxonomy_duplicates' | 'taxonomy_candidates'> {
  const taxonomy_fields: Record<string, TaxonomyFieldSpec> = {};
  const taxonomy_unmapped: Array<{ slug: string; reason: UnmappedReason }> = [];
  const sig = new Map<string, string[]>();
  for (const k of keys) {
    let f = fields[k.id];
    // C1: an alias whose universal source did not survive finalisation is dropped.
    if (f && isAlias(f.locator) && !finalUniversal[f.locator.from]) f = undefined as unknown as FieldSpec;
    const vals = perSample.map((v) => v[k.id]);
    const present = vals.filter((v) => v != null);
    const hits = present.length;
    if (!f || (hits < 1 && !f.homepage_only)) {
      const ambiguous = (k.item_words && (k.item_words.length === 0 || k.ambiguous_seen)) || false;
      const nameRejected =
        !!f && sampleCount > 0 && rejectedPerSample.length === sampleCount &&
        rejectedPerSample.every((r) => r.includes(k.id));
      const addrRejected = nameRejected && rejectedAddressPerSample.length === sampleCount &&
        rejectedAddressPerSample.every((r) => r.includes(k.id));
      const photoRejected = nameRejected && rejectedPhotoPerSample.length === sampleCount &&
        rejectedPhotoPerSample.every((r) => r.includes(k.id));
      taxonomy_unmapped.push({
        slug: k.slug,
        reason: addrRejected ? 'equals_address' : photoRejected ? 'equals_person_photo' : nameRejected ? 'equals_person_name'
          : ambiguous ? 'ambiguous_shared_property' : failed.has(k.id) ? 'rule_failed_validation' : 'not_found_on_samples',
      });
      continue;
    }
    let subject: Subject = f.locator.tier === 'jsonld' && !isDerived(f.locator)
      ? (f.locator as JsonLdLocator).subject
      : k.subjects[0];
    if (f.homepage_only && hits < 1) subject = 'firm';
    // Fix 13: a value identical on every sample that has it (>= 3) is site-wide.
    // Fix 17 / C4: only credential classifier matches are exempt.
    const credentialMatch = isClassifier(f.locator) && f.locator.classifier === 'credential';
    const siteWide =
      !credentialMatch &&
      hits >= 3 &&
      present.every((v) => JSON.stringify(v) === JSON.stringify(present[0]));
    if (siteWide && subject !== 'firm') {
      // Fix (site-wide values to brand, 2026-10-22): in a location-first category a value identical on every location
      // page is a fact of the brand (a chain's cuisine, menu or price range), so it goes to the brand, not dropped.
      if (k.schema_type == null || isOrgType(k.schema_type) || primary === 'location') subject = 'firm';
      else { taxonomy_unmapped.push({ slug: k.slug, reason: 'site_wide_value' }); continue; }
    }
    taxonomy_fields[k.slug] = {
      ...f, hits, samples: sampleCount, subject, scope: k.scope, ...(k.action ? { action: true } : {}),
      ...(k.prop_last === 'logo' ? { logo: true } : {}),
    };
    const key = JSON.stringify(vals.map((v) => (v == null ? null : normVal(v))));
    sig.set(key, [...(sig.get(key) ?? []), k.slug]);
  }
  const taxonomy_duplicates = [...sig.values()].filter((g) => g.length >= 2);
  return { taxonomy_fields, taxonomy_unmapped, taxonomy_duplicates, taxonomy_candidates: keys.length };
}

const CHROME_WORDS = new Set(['header', 'footer', 'nav', 'navbar', 'menu', 'breadcrumb', 'cookie', 'skip']);

function isChromeByName(el: any): boolean {
  const a = el?.attribs ?? {};
  const words = `${a.id ?? ''} ${a.class ?? ''}`.toLowerCase().split(/[^a-z0-9]+/);
  return words.some((w) => CHROME_WORDS.has(w));
}

/**
 * Cleaned markup for the locator prompt (Fix 1, 2026-09-25): site chrome
 * (header/nav/footer/aside/banners/menus) is removed first, then the profile
 * content root (main → smallest h1 ancestor with ≥1,500 chars → body) is
 * cleaned and capped, so the cap is spent on the profile, not navigation.
 */
export function cleanHtmlForPrompt(input: string | Sample, cap = 30_000): string {
  const html = typeof input === 'string' ? input : input.html;
  try {
    // A Sample reuses its parsed document (cloned, since cleaning mutates it).
    const d = typeof input === 'string' ? null : docOf(input);
    const $ = d?.$ ? load(d.$.root().clone().get(0) as any) : parseHtml(html ?? '');
    $('script,style,svg,noscript').remove();
    $('*')
      .contents()
      .filter((_, n: any) => n.type === 'comment')
      .remove();
    const h1 = $('h1').first().get(0) as any;
    const holdsH1 = (el: any) => !!h1 && (el === h1 || $(el).find(h1).length > 0);
    const chrome: any[] = [];
    $('header,nav,footer,aside,[role=banner],[role=navigation],[role=contentinfo],[role=search]').each((_, el) => {
      if (!holdsH1(el)) chrome.push(el);
    });
    $('[id],[class]').each((_, el) => {
      if (isChromeByName(el) && !holdsH1(el)) chrome.push(el);
    });
    for (const el of chrome) $(el).remove();

    const textLen = (el: any) => $(el).text().replace(/\s+/g, ' ').trim().length;
    let root: any = null;
    $('main,[role=main]').each((_, el) => {
      if (!root && textLen(el) > 0) root = el;
    });
    if (!root && h1) {
      let cur = h1.parent;
      while (cur && cur.type === 'tag') {
        if (textLen(cur) >= 1500) { root = cur; break; }
        cur = cur.parent;
      }
    }
    if (!root) root = $('body').get(0) ?? null;

    $('*').each((_, el: any) => {
      const attribs = el.attribs ?? {};
      for (const name of Object.keys(attribs)) {
        const keep =
          ['id', 'class', 'itemprop', 'itemtype', 'href', 'src', 'content'].includes(name) ||
          name.startsWith('data-') ||
          name.startsWith('aria-');
        if (!keep) delete attribs[name];
      }
    });
    let out = (root ? $.html(root) : $.html()) ?? '';
    if (h1 && root && !holdsH1(root)) out = $.html(h1) + out;
    return out.replace(/\s+/g, ' ').trim().slice(0, cap);
  } catch {
    return String(html ?? '').replace(/\s+/g, ' ').slice(0, cap);
  }
}

// ---------------------------------------------------------------------------
// C9 brand pass: firm profile learned once per site from chrome / homepage
// ---------------------------------------------------------------------------

/** C9: ONLY the site chrome (header/footer/nav/chrome-named elements), cleaned and capped. */
export function chromeHtmlForPrompt(input: string | Sample, cap = 12_000): string {
  const html = typeof input === 'string' ? input : input.html;
  try {
    const d = typeof input === 'string' ? null : docOf(input);
    const $ = d?.$ ? load(d.$.root().clone().get(0) as any) : parseHtml(html ?? '');
    $('script,style,svg,noscript').remove();
    $('*').contents().filter((_, n: any) => n.type === 'comment').remove();
    const picked: any[] = [];
    $('header,nav,footer,[role=banner],[role=navigation],[role=contentinfo]').each((_, el) => { picked.push(el); });
    $('[id],[class]').each((_, el) => { if (isChromeByName(el)) picked.push(el); });
    const set = new Set(picked);
    const top = picked.filter((el) => {
      for (let cur = el.parent; cur; cur = cur.parent) if (set.has(cur)) return false;
      return true;
    });
    const uniq = [...new Set(top)];
    for (const el of uniq) {
      $(el).find('*').addBack().each((_, x: any) => {
        const attribs = x.attribs ?? {};
        for (const name of Object.keys(attribs)) {
          const keep = ['id', 'class', 'itemprop', 'itemtype', 'href', 'src', 'content', 'role'].includes(name) ||
            name.startsWith('data-') || name.startsWith('aria-');
          if (!keep) delete attribs[name];
        }
      });
    }
    return uniq.map((el) => $.html(el) ?? '').join('\n').replace(/\s+/g, ' ').trim().slice(0, cap);
  } catch {
    return '';
  }
}

/** C9: universal firm ids handled by the brand pass. */
export const FIRM_BRAND_IDS = [
  'firm.firm_name', 'firm.logo_url', 'firm.phone_main', 'firm.website', 'firm.social_links', 'firm.email', 'firm.address_block',
];

/** C9: firm ids (universal + firm-subject taxonomy) the brand pass should ask for. */
export function firmLocatorIds(fields: Record<string, FieldSpec>, keys: TaxonomyKey[], taxCandidates: string[]): string[] {
  const cand = new Set(taxCandidates);
  return [
    ...FIRM_BRAND_IDS.filter((id) => !fields[id]),
    ...keys.filter((k) => k.subjects[0] === 'firm' && cand.has(k.id) && !fields[k.id]).map((k) => k.id),
  ];
}

/** C10: first raw text a CSS/label locator reads, before validation (<= 120 chars). */
function rawLocatorText($: $T | null, loc: CssLocator): string | null {
  if (!$) return null;
  try {
    if (loc.pair) {
      const a = rawLocatorText($, loc.pair.latitude);
      const b = rawLocatorText($, loc.pair.longitude);
      return a == null && b == null ? null : `${a ?? ''}, ${b ?? ''}`.slice(0, 120);
    }
    let t: string | undefined;
    if (loc.strategy === 'css') {
      if (!loc.css) return null;
      const el = $(loc.css).first();
      if (!el.length) return null;
      t = loc.attr ? el.attr(loc.attr) : el.text();
    } else {
      const el = findLabelEl($, loc.label ?? '');
      if (!el) return null;
      t = $(el).parent().text();
    }
    const s = String(t ?? '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 120) : null;
  } catch {
    return null;
  }
}

function truncDiag(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 200);
  const s = JSON.stringify(v);
  return s.length > 200 ? s.slice(0, 200) : v;
}

/** C10: per-rule record of the firm check. */
export type FirmDiagnostic = {
  id: string;
  rule: { strategy: 'css' | 'label'; css?: string; label?: string; attr?: string };
  homepage: unknown;
  samples: unknown[];
  raw_homepage?: string | null;
  raw_samples?: Array<string | null>;
  outcome: 'accepted' | 'varies' | 'not_found' | 'failed_validation';
  note?: string;
};
export const FIRM_DIAGNOSTICS_CAP = 40;

function diagRule(loc: CssLocator): FirmDiagnostic['rule'] {
  if (loc.pair) {
    const p = loc.pair;
    return { strategy: 'css', css: `${p.latitude.css ?? p.latitude.label ?? ''} | ${p.longitude.css ?? p.longitude.label ?? ''}` };
  }
  return {
    strategy: loc.strategy,
    ...(loc.css ? { css: loc.css } : {}),
    ...(loc.label ? { label: loc.label } : {}),
    ...(loc.attr ? { attr: loc.attr } : {}),
  };
}

/**
 * C9/C10: validate firm rules — the reverse of advisor rules. C10: a rule is
 * accepted when its validated value is non-empty and IDENTICAL on at least 2
 * samples and on every sample that has it (the homepage may differ or lack it:
 * note homepage_differs / homepage_missing); when no sample has it, the
 * homepage value alone is accepted (note homepage_only); one sample is accepted
 * only when the homepage has the identical value. Firm phones may not equal a
 * person/branch phone on the same page. Firm rules may target header/footer.
 * Every validated rule gets a diagnostics entry.
 */
export function mergeFirmRules(
  fields: Record<string, FieldSpec>,
  rules: Rule[],
  home: Sample,
  samples: Sample[],
  siteEntityNames: Set<string>,
  opts: ApplyOptions,
  firmIds: string[],
  taxTypes: Record<string, FieldType> = {},
): { fields: Record<string, FieldSpec>; failed: string[]; diagnostics: FirmDiagnostic[]; homepageDiffers: string[] } {
  const allowed = new Set(firmIds);
  const out = { ...fields };
  const failed = new Set<string>();
  const passed = new Set<string>();
  const diagnostics: FirmDiagnostic[] = [];
  const homepageDiffers: string[] = [];
  const pages = [home, ...samples];
  const ctxs = pages.map((p) => ctxFor(docOf(p), p.url, siteEntityNames, opts));
  const universal = Object.fromEntries(Object.entries(fields).filter(([id]) => !isTaxId(id)));
  const accepted = pages.map((p) => applySiteContract(docOf(p), p.url, { fields: universal }, siteEntityNames, opts).values);
  const nonEmpty = (v: unknown) => v != null && normVal(v) !== '';
  for (const { r, pair } of groupGeoRules(Array.isArray(rules) ? rules : [], taxTypes)) {
    if (!r || typeof r.id !== 'string' || !allowed.has(r.id)) continue;
    if ((r.strategy === 'css' && !r.css) || (r.strategy === 'label' && !r.label) || (r.strategy !== 'css' && r.strategy !== 'label')) {
      failed.add(r.id); continue;
    }
    const tax = isTaxId(r.id);
    const type = tax ? taxTypes[r.id] : fieldType(r.id);
    if (!type) continue;
    const locator = pair ?? ruleToLocator(r);
    const vals = ctxs.map((c) => applyLocator(locator, type, r.id, c));
    const raws = ctxs.map((c) => rawLocatorText(c.$(), locator));
    const hv = vals[0];
    const sv = vals.slice(1);
    const present = sv.filter(nonEmpty);
    const phoneClash = type === 'phone' && vals.some((v, i) => v != null &&
      ['person.phone', 'location.phone'].some((pid) => accepted[i][pid] != null && normVal(accepted[i][pid]) === normVal(v)));
    const typeClash = vals.some((v, i) => v != null && (tax ? clashesTax(type, v, accepted[i], out) : clashes(r.id, v, accepted[i])));
    let outcome: FirmDiagnostic['outcome'];
    let note: string | undefined;
    const anchored = isValueAnchored(locator, vals);
    if (anchored) { outcome = 'failed_validation'; note = 'value_anchored'; }
    else if (phoneClash || typeClash) { outcome = 'failed_validation'; note = phoneClash ? 'equals_person_or_branch_phone' : 'type_clash'; }
    else if (present.length >= 2) {
      const same = present.every((v) => normVal(v) === normVal(present[0]));
      if (!same) outcome = 'varies';
      else {
        outcome = 'accepted';
        if (nonEmpty(hv) && normVal(hv) !== normVal(present[0])) { note = 'homepage_differs'; homepageDiffers.push(r.id); }
        else if (!nonEmpty(hv)) note = 'homepage_missing';
      }
    } else if (present.length === 1) {
      if (nonEmpty(hv) && normVal(hv) === normVal(present[0])) outcome = 'accepted';
      else if (nonEmpty(hv)) { outcome = 'varies'; note = 'homepage_differs'; }
      else { outcome = 'not_found'; note = 'single_sample'; }
    } else if (nonEmpty(hv)) { outcome = 'accepted'; note = 'homepage_only'; }
    else outcome = raws.some((x) => x != null) ? 'failed_validation' : 'not_found';

    diagnostics.push({
      id: r.id,
      rule: diagRule(locator),
      homepage: truncDiag(hv),
      samples: sv.map(truncDiag),
      raw_homepage: raws[0],
      raw_samples: raws.slice(1),
      outcome,
      ...(note ? { note } : {}),
    });
    if (outcome !== 'accepted') { failed.add(r.id); continue; }
    passed.add(r.id);
    const existing = out[r.id];
    if (existing) {
      // C10: a rule kept from the previous contract stays primary; the new one becomes backup.
      if (existing.kept_from_previous && !existing.backup) out[r.id] = { ...existing, backup: locator };
      continue;
    }
    out[r.id] = {
      tier: 'css', locator, type, hits: Math.max(present.length, 1), samples: samples.length,
      ...(note === 'homepage_only' ? { homepage_only: true } : {}),
    };
  }
  return {
    fields: out,
    failed: [...failed].filter((id) => !passed.has(id)),
    diagnostics: diagnostics.slice(0, FIRM_DIAGNOSTICS_CAP),
    homepageDiffers: homepageDiffers.filter((id) => passed.has(id)),
  };
}

/** C9: the firm profile — firm values read on the homepage (else the first sample that has them). */
export function buildFirmProfile(
  contract: Pick<SiteContract, 'fields'> & Partial<Pick<SiteContract, 'taxonomy_fields' | 'own_page_key'>>,
  home: Sample,
  samples: Sample[],
  siteEntityNames: Set<string>,
  opts: ApplyOptions = {},
  /** C10: ids whose homepage value differs from the samples — the sample value is used. */
  preferSampleIds: Set<string> = new Set(),
): FirmProfile {
  const pages = [home, ...samples];
  const per = pages.map((p) => applySiteContract(docOf(p), p.url, contract, siteEntityNames, opts).values);
  const ids: Array<[string, string, FieldSpec]> = [
    ...Object.entries(contract.fields ?? {}).filter(([id]) => id.startsWith('firm.')).map(([id, f]) => [id, id, f] as [string, string, FieldSpec]),
    ...Object.entries(contract.taxonomy_fields ?? {}).filter(([, f]) => f.subject === 'firm')
      .map(([slug, f]) => [TAX_PREFIX + slug, TAX_PREFIX + slug, f] as [string, string, FieldSpec]),
  ];
  const values: FirmProfile['values'] = {};
  const sources: FirmProfile['sources'] = {};
  const order = pages.map((_, i) => i);
  const sampleFirst = [...order.slice(1), 0];
  for (const [key, id, f] of ids) {
    const i = (preferSampleIds.has(id) ? sampleFirst : order).find((j) => !isEmptyValue(per[j][id])) ?? -1;
    if (i < 0) continue;
    values[key] = per[i][id];
    let src: 'jsonld' | 'chrome' | 'homepage' = 'homepage';
    const loc = f.locator;
    if (f.homepage_only) { sources[key] = 'homepage'; continue; }
    if (loc?.tier === 'jsonld' || (isAlias(loc) && contract.fields?.[loc.from]?.tier === 'jsonld')) src = 'jsonld';
    else if (loc?.tier === 'css' && !isDerived(loc)) {
      const $ = docOf(pages[i]).$;
      if ($ && locatorTargetsChrome($, loc as CssLocator)) src = 'chrome';
    }
    sources[key] = src;
  }
  return { values, sources, learned_at: new Date().toISOString() };
}

/** C10: CSS/label locator back to the rule(s) it came from (pair → two part rules). */
function locatorToRules(id: string, loc: CssLocator): Rule[] {
  if (loc.pair) {
    return (['latitude', 'longitude'] as const).flatMap((part) => locatorToRules(id, loc.pair![part]).map((r) => ({ ...r, part })));
  }
  const r: Rule = { id, strategy: loc.strategy };
  if (loc.css) r.css = loc.css;
  if (loc.label) r.label = loc.label;
  if (loc.attr) r.attr = loc.attr;
  if (loc.multi) r.multi = true;
  if (loc.split_commas) r.split_commas = true;
  if (loc.item_fields) r.item_fields = loc.item_fields;
  return [r];
}

const isPlainCss = (loc: Locator | undefined): loc is CssLocator =>
  !!loc && loc.tier === 'css' && !isDerived(loc) && ((loc as CssLocator).strategy === 'css' || (loc as CssLocator).strategy === 'label');

/**
 * C10 sticky rules: the CSS/label rules of a previous contract (universal
 * fields and taxonomy fields, ids 'tax.<slug>'), with each id's previous
 * plain CSS backup. Derived address parts are not listed (they are re-derived
 * from a kept address_block). Contracts below version 3 give nothing.
 */
export function previousContractRules(prev: SiteContract | null | undefined): { rules: Rule[]; backups: Record<string, CssLocator> } {
  const rules: Rule[] = [];
  const backups: Record<string, CssLocator> = {};
  if (!prev || Number(prev.version ?? 0) < 3) return { rules, backups };
  const entries: Array<[string, FieldSpec]> = [
    ...Object.entries(prev.fields ?? {}),
    ...Object.entries(prev.taxonomy_fields ?? {}).map(([slug, f]) => [TAX_PREFIX + slug, f] as [string, FieldSpec]),
    // C14: extra rules are sticky too (ids 'extra.<key>').
    ...Object.entries(prev.extra_fields ?? {}).map(([key, f]) => [EXTRA_PREFIX + key, f] as [string, FieldSpec]),
  ];
  for (const [id, f] of entries) {
    if (!isPlainCss(f?.locator)) continue;
    rules.push(...locatorToRules(id, f.locator));
    if (isPlainCss(f.backup)) backups[id] = f.backup;
  }
  return { rules, backups };
}

/** C10: mark ids kept from the previous contract (and restore their previous backup). */
export function markKeptFields(
  fields: Record<string, FieldSpec>,
  keptIds: Iterable<string>,
  backups: Record<string, CssLocator> = {},
): Record<string, FieldSpec> {
  const out = { ...fields };
  for (const id of keptIds) {
    const f = out[id];
    if (!f) continue;
    out[id] = { ...f, kept_from_previous: true, ...(!f.backup && backups[id] ? { backup: backups[id] } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Harvest helpers (pure; used by disco-harvest-worker)
// ---------------------------------------------------------------------------

const isEmptyValue = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** When the location owns the address, copy it into empty person address keys. */
export function applyAddressOwner(
  values: Record<string, unknown>,
  contract: Pick<SiteContract, 'address_owner'>,
): Record<string, unknown> {
  const out = { ...values };
  if (contract?.address_owner !== 'location') return out;
  for (const k of ['street', 'city', 'state', 'postal_code']) {
    const loc = out['location.' + k];
    if (!isEmptyValue(loc) && isEmptyValue(out['person.' + k])) out['person.' + k] = loc;
  }
  return out;
}

/** The contract must-have rule evaluated on ONE page's values. */
export function recordMustHave(
  values: Record<string, unknown>,
  primary: PrimarySubject,
  nameOwner?: 'location' | null,
): { ok: boolean; missing: string[] } {
  const fields: Record<string, FieldSpec> = {};
  for (const [id, v] of Object.entries(values)) {
    if (!isEmptyValue(v)) fields[id] = { hits: 1 } as FieldSpec;
  }
  const mh = computeMustHave(fields, primary, nameOwner);
  return { ok: mh.ok, missing: mh.missing };
}

export type HarvestRecord = {
  entity_type: 'professional' | 'location';
  payload: Record<string, unknown>;
  identity_candidates: Record<string, unknown> & { universal: Record<string, unknown> };
  detail_url: string;
  must_have: { ok: boolean; missing: string[] };
  filled: number;
  floor_needed: number;
  shallow: boolean;
};

/** Fix (placeholder phones, 2026-10-16): a copy of the values without placeholder phones (ids ending in phone / fax,
 *  or taxonomy keys of type phone); a list keeps its real numbers. */
export function dropPlaceholderPhones(
  values: Record<string, unknown>,
  taxonomyFields?: Record<string, { type?: string } | undefined>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(values)) {
    const isTax = id.startsWith(TAX_PREFIX);
    const phoneLike = /(phone|fax)$/i.test(id) || (isTax && taxonomyFields?.[id.slice(TAX_PREFIX.length)]?.type === 'phone');
    if (!phoneLike) { out[id] = v; continue; }
    if (Array.isArray(v)) {
      const kept = v.filter((x) => !isPlaceholderPhone(x));
      if (kept.length) out[id] = kept;
    } else if (!isPlaceholderPhone(v)) {
      out[id] = v;
    }
  }
  return out;
}

export function buildHarvestRecord(args: {
  contract: Pick<SiteContract, 'primary_subject' | 'version' | 'learned_at'> &
    Partial<Pick<SiteContract, 'taxonomy_fields' | 'own_page_key' | 'firm_profile' | 'name_owner' | 'static_routes' | 'boilerplate_values' | 'sitewide_actions' | 'sitewide_media'>>;
  values: Record<string, unknown>;
  detailUrl: string;
  /** C9: taxonomy ids whose page value equals a firm_profile value (labelled firm). */
  firmRelabelled?: string[];
  detailEntityType?: string | null;
  fieldFloor?: number | null;
  /** C14: extra field values ({ key: value }), written to payload._extra. */
  extras?: Record<string, unknown>;
}): HarvestRecord {
  const { contract, detailUrl } = args;
  // Fix (placeholder phones, 2026-10-16): every record passes here (page, profile API, API plus page). Placeholder
  // phones are removed from every phone / fax value first, so they reach neither the record's main phone nor the
  // taxonomy phone fields, and do not count as filled fields.
  const values = dropPlaceholderPhones(args.values, contract.taxonomy_fields);
  const primary = contract.primary_subject;
  const entity_type: HarvestRecord['entity_type'] =
    args.detailEntityType === 'professional' || args.detailEntityType === 'location'
      ? args.detailEntityType
      : primary === 'person' ? 'professional' : 'location';

  const payload: Record<string, unknown> = {};
  // Staging schema step 3: static values in section-4 formats (routes, derived rules, quality rules).
  const staging = buildStagingStatic({ contract, values, extras: args.extras, pageUrl: detailUrl });
  const universal: Record<string, unknown> = staging.universal;
  const subjects: Record<string, 'person' | 'branch' | 'firm'> = {};
  const label = (s: Subject): 'person' | 'branch' | 'firm' => (s === 'location' ? 'branch' : s);
  for (const [id, v] of Object.entries(values)) {
    if (isEmptyValue(v)) continue;
    if (isTaxId(id)) {
      const slug = id.slice(TAX_PREFIX.length);
      payload[slug] = v;
      const s = contract.taxonomy_fields?.[slug]?.subject ?? (primary === 'person' ? 'person' : 'location');
      subjects[slug] = args.firmRelabelled?.includes(id) ? 'firm' : label(s);
    }
  }
  // S4-1: distinct static + taxonomy values (same rule as the measured floor).
  const filled = countStagingFields(universal, values);
  // Metadata, not fields: excluded from `filled`.
  payload._contract = { version: contract.version, learned_at: contract.learned_at };
  payload._subjects = subjects;
  if (contract.firm_profile) payload._firm_ref = { learned_at: contract.firm_profile.learned_at };
  // C14: extra fields — staging only; not counted in `filled`, no effect on `shallow`.
  // Step 3: extras moved to a static key by a contract route are no longer in _extra.
  const extras = staging.extras;
  if (Object.keys(extras).length) payload._extra = extras;
  if (Object.keys(staging.sources).length) payload._static_sources = staging.sources;

  const pick = (k: string): unknown => {
    const p = values['person.' + k];
    if (!isEmptyValue(p)) return p;
    const l = values['location.' + k];
    return isEmptyValue(l) ? null : l;
  };
  const nameVal = primary === 'person'
    ? (isEmptyValue(values['person.name']) ? values['location.business_name'] : values['person.name'])
    : (isEmptyValue(values['location.business_name']) ? values['person.name'] : values['location.business_name']);
  const identity_candidates = {
    url: detailUrl,
    name: isEmptyValue(nameVal) ? null : nameVal,
    phone: pick('phone'),
    email: pick('email'),
    street: pick('street'),
    city: pick('city'),
    state: pick('state'),
    postal_code: pick('postal_code'),
    branch_name: isEmptyValue(values['location.business_name']) ? null : values['location.business_name'],
    firm_name: isEmptyValue(values['firm.firm_name']) ? null : values['firm.firm_name'],
    universal,
  };

  const must_have = recordMustHave(values, primary, contract.name_owner ?? null);
  const floor = Number(args.fieldFloor ?? 0);
  const floor_needed = floor > 0 ? Math.ceil(0.7 * floor) : 0;
  return {
    entity_type, payload, identity_candidates, detail_url: detailUrl, must_have,
    filled, floor_needed, shallow: !must_have.ok || filled < floor_needed,
  };
}

// ============================================================================
// Staging schema step 3: static values written to identity_candidates.universal
// (docs/ETL-Staging-Data-Schema.md sections 4 and 5). Fill order: page rule →
// taxonomy route → extra route (removed from _extra) → derived rule; then the
// quality rules and the section-4 formats. Taxonomy keys and extras are not
// reformatted. Pure code, no AI.
// ============================================================================

export type Credential = { name?: string; type: 'designation' | 'license' | 'registration'; number?: string; issuer?: string; state?: string };
export type Link = { platform: string; url: string };
export type Hours = { day: string; opens?: string; closes?: string };
export type Member = { name: string; role?: string; license?: string; photo_url?: string };

const nonEmpty = (v: unknown): boolean => v != null && !isEmptyValue(v);
const asStrings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).flatMap((x) =>
    typeof x === 'string' || typeof x === 'number' ? [String(x)]
      : x && typeof x === 'object' && typeof (x as any).name === 'string' ? [String((x as any).name)]
      : x && typeof x === 'object' && typeof (x as any).url === 'string' ? [String((x as any).url)] : []);

// ---- formats (section 4) ----------------------------------------------------
/**
 * Fix (10-digit US phone, 2026-10-13): staged phones are 10 digits ("8605704059"), US only. A leading 1 is dropped;
 * extensions are ignored. Only valid North American numbers pass: area code and exchange start with 2-9, not
 * all one digit, not 1234567890, not the fictional 555-01xx range. Anything else (foreign, short, fake) -> null.
 * toE164 below is unchanged (used elsewhere).
 */
/**
 * Fix (placeholder phones, 2026-10-16): one definition of a placeholder phone, shared by toUSPhone10 and
 * buildHarvestRecord. A placeholder is all one digit ("0000000000", "(111) 111-1111"), a straight run
 * ("123-456-7890", "0123456789", "9876543210") or the fictional North American 555-01xx range. Real numbers,
 * including international ones (+90 ..., +52 ...), are not placeholders.
 */
export function isPlaceholderPhone(v: unknown): boolean {
  const s = String(asStrings(v)[0] ?? '').replace(/^tel:/i, '');
  const main = s.split(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i)[0];
  let d = main.replace(/\D/g, '');
  if (d.length < 6) return false;
  if (/^(\d)\1+$/.test(d)) return true;
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (/^(\d)\1+$/.test(d)) return true;
  if (['1234567890', '0123456789', '9876543210', '2345678901', '123456789', '12345678'].includes(d)) return true;
  if (d.length === 10 && d.slice(3, 6) === '555' && d.slice(6, 8) === '01') return true;
  return false;
}

export function toUSPhone10(v: unknown): string | null {
  const s = String(asStrings(v)[0] ?? '').replace(/^tel:/i, '');
  const main = s.split(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i)[0];
  let d = main.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  if (isPlaceholderPhone(d)) return null;
  return d;
}

export function toE164(v: unknown): string | null {
  const s = String(asStrings(v)[0] ?? '').replace(/^tel:/i, '');
  const main = s.split(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i)[0];
  const d = main.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (/^\s*\+/.test(main) && d.length >= 8 && d.length <= 15) return '+' + d;
  return null;
}

/**
 * Google place id (ChIJ…): the value itself, or the place_id / query_place_id parameter of a Maps
 * link. Links without a place id (cid=, g.page/…) are dropped — no lookup, no guess.
 */
export function toPlaceId(v: unknown): string | null {
  for (const raw of asStrings(v)) {
    const s = raw.trim();
    if (/^ChIJ[\w-]{10,}$/.test(s)) return s;
    let t = s;
    try { t = decodeURIComponent(s); } catch { /* keep raw */ }
    const m = t.match(/(?:place_id[:=]|query_place_id=|placeid=)(ChIJ[\w-]{10,})/i);
    if (m) return m[1];
  }
  return null;
}

const TRACKING_PARAM_RE = /^(utm_[a-z_]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|_ga)$/i;
export function formatUrl(v: unknown, pageUrl: string): string | null {
  const s = asStrings(v)[0];
  if (!s) return null;
  try {
    const u = new URL(s.trim(), pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.protocol = 'https:';
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM_RE.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return null;
  }
}

function formatText(v: unknown): string | null {
  const s = asStrings(v)[0];
  if (s == null) return null;
  const t = cleanText(s);
  return t ? t : null;
}

/**
 * Lists: separate elements are separate entries; explicit breaks (line, ";", " | ") split; commas split
 * only where the locator call decided so for this site (rule split_commas, applied at extraction).
 */
function formatList(_key: string, v: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of asStrings(v)) {
    // Bullet lists in one text ("* Buyers Agent * Relocation", "• A • B") are explicit breaks too.
    const parts = raw.split(/[;\n•]|\s\|\s|(?:^|\s)\*\s/);
    for (const p of parts) {
      const t = cleanText(p);
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

const REG_ISSUER_RE = /\b(NMLS|CRD|FINRA|SEC|IARD)\b/;
export function toCredential(text: string, hint?: 'license' | 'registration'): Credential | null {
  const t = cleanText(text);
  if (!t) return null;
  const issuer = t.match(REG_ISSUER_RE)?.[1];
  const type: Credential['type'] = hint ?? (/licen[cs]e/i.test(t) ? 'license'
    : issuer || /registration|\breg\.?\s*#/i.test(t) ? 'registration' : 'designation');
  const c: Credential = { type };
  if (type === 'designation') {
    const name = t.replace(/[®™]/g, '').trim();
    if (!name) return null;
    c.name = name;
    return c;
  }
  // A licence / registration number holds a digit ("ID Licensed …" is Idaho, not an id label).
  const labelled = t.match(/(?:#|\bno\.?|\bnumber|\bid)\s*:?\s*([A-Z0-9][A-Z0-9-]{3,})/i)?.[1];
  const num = (labelled && /\d/.test(labelled) ? labelled : undefined)
    ?? t.match(/\b([A-Z]{0,3}-?\d[\dA-Z-]{3,})\b/)?.[1];
  if (num) c.number = num;
  if (issuer) c.issuer = issuer;
  if (type === 'license') {
    for (const m of t.matchAll(/\b([A-Z]{2})\b(?!\s*[:#])/g)) {
      // "ID:" / "ID#" is a label, not Idaho.
      if (m[1] !== issuer && stateCode(m[1])) { c.state = m[1]; break; }
    }
    if (!c.state) {
      for (const [code, nm] of Object.entries(US_STATES)) {
        if (new RegExp(`\\b${nm}\\b`, 'i').test(t)) { c.state = code; break; }
      }
    }
  }
  const name = t
    .replace(num ?? '\u0000', '')
    .replace(/(?:#|\bno\.?|\bnumber|\bid)\s*:?\s*$/i, '')
    .replace(/[#:]+/g, ' ')
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;-]+|[\s,.;-]+$/g, '');
  // A licence named only by its state ("CA: 0M62418") has no name; the state is kept in `state`.
  if (name && !(stateCode(name) && (c.state === stateCode(name) || !c.state))) c.name = name;
  else if (name && stateCode(name)) c.state = stateCode(name)!;
  else if (issuer) c.name = issuer;
  return c.name || c.number || c.state ? c : null;
}

const PLATFORM_BY_HOST: Array<[RegExp, string]> = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'facebook'], [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, 'x'], [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'], [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)pinterest\.com$/, 'pinterest'], [/(^|\.)yelp\.com$/, 'yelp'],
  [/(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|(^|\.)g\.page$/, 'google'],
];
function toLinks(v: unknown, pageUrl: string): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>();
  for (const s of asStrings(v)) {
    if (/\s/.test(s.trim())) continue; // address text, labels — not a link
    const url = formatUrl(s, pageUrl);
    if (!url) continue;
    const host = new URL(url).hostname.toLowerCase();
    if (!host.includes('.')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ platform: PLATFORM_BY_HOST.find(([re]) => re.test(host))?.[1] ?? 'other', url });
  }
  return out;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_RE_SRC = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|mo|tu|we|th|fr|sa|su)\\.?';
function dayIndex(s: string): number {
  const t = s.toLowerCase().replace(/\.$/, '');
  const i = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'].indexOf(t.slice(0, 2));
  return i;
}
function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** One hours line → day objects, or null when it cannot be split. */
function parseHoursLine(line: string): Hours[] | null {
  const s = line.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const dayRe = new RegExp(`^${DAY_RE_SRC}(?:\\s*(?:-|to|through)\\s*${DAY_RE_SRC})?((?:\\s*,\\s*${DAY_RE_SRC})*)\\s*:?\\s*(.*)$`, 'i');
  const m = s.match(dayRe);
  if (!m) return null;
  const start = dayIndex(m[1]);
  const end = m[2] ? dayIndex(m[2]) : start;
  if (start < 0 || end < 0) return null;
  const days: number[] = [];
  for (let i = start; ; i = (i + 1) % 7) { days.push(i); if (i === end || days.length > 7) break; }
  // m[3] = extra ", Day" list; the last group is the rest of the line (DAY_RE_SRC has its own group).
  for (const extra of (m[3] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = dayIndex(extra);
    if (i >= 0 && !days.includes(i)) days.push(i);
  }
  const rest = (m[m.length - 1] ?? '').trim();
  if (/^closed$/i.test(rest)) return days.map((d) => ({ day: DAYS[d] }));
  const tm = rest.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!tm) return null;
  let oh = Number(tm[1]); const om = Number(tm[2] ?? 0);
  let ch = Number(tm[4]); const cm = Number(tm[5] ?? 0);
  const oap = tm[3]?.toLowerCase().startsWith('p') ? 'pm' : tm[3] ? 'am' : '';
  const cap = tm[6]?.toLowerCase().startsWith('p') ? 'pm' : tm[6] ? 'am' : '';
  if (oap === 'pm' && oh < 12) oh += 12;
  if (oap === 'am' && oh === 12) oh = 0;
  if (cap === 'pm' && ch < 12) ch += 12;
  if (cap === 'am' && ch === 12) ch = 0;
  // "9-5" without am/pm: a closing hour before the opening hour is afternoon.
  if (!oap && !cap && ch <= oh && ch < 12) ch += 12;
  if (oh > 24 || ch > 24 || om > 59 || cm > 59) return null;
  return days.map((d) => ({ day: DAYS[d], opens: hhmm(oh, om), closes: hhmm(ch, cm) }));
}
/** Hours: split days as objects; text that cannot be split is kept as plain text items (→ office_hours). */
function toHours(v: unknown): Array<Hours | string> {
  const out: Array<Hours | string> = [];
  const seen = new Set<string>();
  for (const raw of asStrings(v)) {
    for (const seg of raw.split(/\n|;|\s\|\s|,(?=\s*(?:mon|tue|wed|thu|fri|sat|sun|mo|tu|we|th|fr|sa|su)\b)/i)) {
      const t = cleanText(seg);
      if (!t) continue;
      const parsed = parseHoursLine(t);
      for (const item of parsed ?? [t]) {
        const k = typeof item === 'string' ? item.toLowerCase() : item.day;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(item);
      }
    }
  }
  return out;
}

/** Words that make an entry a service, tag, title or menu item rather than a person's name. */
const NON_NAME_RE = /\b(solutions?|services?|compensation|wellness|planning|management|investing|investments?|strategies|strategy|specialist|associates?|page|home|debt|risk|access|older|organization|portfolio|insurance|financial|wealth|retirement|charitable|giving|equity|executive|team|group|advisors?|benefits?|plans?|lending|trust|estate|income|tax|business|clients?|contact|learn|more|about|overview)\b/i;
function toMembers(v: unknown, pageUrl: string, exclude: Set<string> = new Set()): Member[] {
  const out: Member[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) {
    let m: Member | null = null;
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const name = formatText(o.name);
      if (name) {
        m = { name };
        const role = formatText(o.role ?? o.jobTitle);
        if (role) m.role = role;
        const lic = formatText(o.license);
        if (lic) m.license = lic;
        const photo = formatUrl(o.photo_url ?? o.image, pageUrl);
        if (photo) m.photo_url = photo;
      }
    } else if (typeof x === 'string') {
      const t = cleanText(x);
      const [a, ...b] = t.split(/\s[-–|]\s|,\s/);
      const words = a.trim().split(/\s+/);
      const nameLike = words.every((w) => /^[A-Z]/.test(w) || /^(de|da|del|della|di|du|la|le|van|von|der|den|bin|al)$/.test(w));
      if (words.length >= 2 && words.length <= 5 && !/\d/.test(a) && nameLike) {
        m = { name: a.trim() };
        if (b.length) m.role = b.join(', ').trim();
      }
    }
    if (!m || seen.has(m.name.toLowerCase())) continue;
    // A team member is a person: not a service / tag / title / menu entry, not one of the page's services.
    if (NON_NAME_RE.test(m.name) || exclude.has(m.name.toLowerCase())) continue;
    seen.add(m.name.toLowerCase());
    out.push(m);
  }
  return out;
}

/** A licence type label: 3-60 characters, not just the number and not a bare state code. */
function isLicenseLabel(name: string | undefined, number?: string): name is string {
  const t = cleanText(name ?? '');
  return t.length >= 3 && t.length <= 60 && t !== number && !/;/.test(t) && !stateCode(t);
}

export type Award = { title: string; year?: number; issuer?: string; description?: string; url?: string };
export type Education = { school?: string; degree?: string; year?: number; text?: string };
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/g;
function oneYear(t: string): number | null {
  const ys = [...new Set([...t.matchAll(YEAR_RE)].map((m) => Number(m[1])))].filter((y) => y <= new Date().getUTCFullYear());
  return ys.length === 1 ? ys[0] : null;
}
/** Awards: structured entries kept; plain text → title (+ the year when exactly one is shown). */
function toAwards(v: unknown, pageUrl: string): Award[] {
  const out: Award[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) {
    let a: Award | null = null;
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const title = formatText(o.title ?? o.name);
      if (!title) continue;
      a = { title };
      const y = oneYear(String(o.year ?? '')) ?? (o.year == null ? oneYear(title) : null);
      if (y) a.year = y;
      const issuer = formatText(o.issuer); if (issuer) a.issuer = issuer;
      const desc = formatText(o.description); if (desc) a.description = desc;
      const url = formatUrl(o.url, pageUrl); if (url) a.url = url;
    } else if (typeof x === 'string' || typeof x === 'number') {
      const t = cleanText(String(x));
      if (!t) continue;
      const y = oneYear(t);
      const title = y ? t.replace(new RegExp(`[\\s,(–—-]*\\b${y}\\b[)\\s]*$`), '').trim() || t : t;
      a = { title, ...(y ? { year: y } : {}) };
    }
    if (!a) continue;
    const k = `${a.title.toLowerCase()}|${a.year ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}
/** Education: structured entries kept; plain text stays as text (+ the year when exactly one is shown). */
function toEducation(v: unknown): Education[] {
  const out: Education[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) {
    let e: Education | null = null;
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      e = {};
      const school = formatText(o.school ?? o.name); if (school) e.school = school;
      const degree = formatText(o.degree); if (degree) e.degree = degree;
      const y = oneYear(String(o.year ?? '')); if (y) e.year = y;
      if (!e.school && !e.degree) { const t = formatText(o.title ?? o.text); if (t) e.text = t; else e = null; }
    } else if (typeof x === 'string') {
      const t = cleanText(x);
      if (t) { e = { text: t }; const y = oneYear(t); if (y) e.year = y; }
    }
    if (!e) continue;
    const k = JSON.stringify(e).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// ---- derived rules (section 5.4) --------------------------------------------
const NAME_SUFFIX_RE = /^(jr\.?|sr\.?|ii|iii|iv|v|vi)$/i;
function isDesignationToken(tok: string): boolean {
  const t = tok.trim();
  if (!t || NAME_SUFFIX_RE.test(t)) return false;
  const u = t.replace(/[®™]/g, '');
  if (u !== t) return u.length >= 2;
  if (/^(?:[A-Z][a-z]?\.){2,4}$/.test(u)) return true;
  if (!/^[A-Za-z]{2,7}$/.test(u)) return false;
  const upper = (u.match(/[A-Z]/g) ?? []).length;
  const lower = (u.match(/[a-z]/g) ?? []).length;
  return upper >= 2 && lower <= 1 && /^[A-Z]/.test(u);
}
/** "Jane Doe, CFP®, CEPA" → { name: "Jane Doe", designations: ["CFP®", "CEPA"] }. */
export function splitPostNominals(name: string): { name: string; designations: string[]; trailing?: string } {
  const segs = name.split(',').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return { name, designations: [] };
  const designations: string[] = [];
  const keep: string[] = [];
  const other: string[] = [];
  segs.forEach((seg, i) => {
    const toks = seg.split(/\s+/);
    if (i > 0 && toks.length <= 3 && toks.every(isDesignationToken)) designations.push(...toks);
    // "Doe, Jane" (surname first): a one-word first segment keeps every non-designation segment.
    else if (i === 0 || NAME_SUFFIX_RE.test(seg) || segs[0].split(/\s+/).length === 1) keep.push(seg);
    // Any other text after the name ("Richard Roe, First Vice President") is not part of the name.
    else other.push(seg);
  });
  // Trailing designations without a comma ("Jane Doe CFP® CRPC"): only from the first ®/™ token on
  // (after at least two name words), so an upper-case surname ("Mary Ann SMITH") is never cut.
  let first = (keep[0] ?? '').split(/\s+/);
  const trail: string[] = [];
  const mark = first.findIndex((t, i) => i >= 2 && /[®™]/.test(t));
  if (mark >= 2 && first.slice(mark).every(isDesignationToken)) {
    trail.push(...first.slice(mark));
    first = first.slice(0, mark);
  }
  const rest = [first.join(' '), ...keep.slice(1)].filter(Boolean).join(', ');
  return { name: rest || name, designations: [...trail, ...designations], ...(other.length ? { trailing: other.join(', ') } : {}) };
}

// ---- quality rules (section 5) ----------------------------------------------
const urlCore = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
};
/** A bio made mostly of short lines (job-history or link lists) is not a bio. */
function isListLikeText(s: string): boolean {
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const short = lines.filter((l) => l.split(/\s+/).length <= 6).length;
  return short / lines.length >= 0.6;
}
/**
 * A real bio is about this person: it names them (first or last name) or speaks as / about a person
 * (I, my, we, our; he, she, his, her, they with 2+ sentences), or is a substantial text (200+ chars, 2+
 * sentences). Generic site text without any of these, and job-history lists (2+ year ranges), are not.
 */
/** Text made of opening hours (3+ "Mon 08:30AM"-style entries) is an hours / contact panel. */
export function isHoursText(text: string): boolean {
  const t = cleanText(text);
  // 3+ day entries ("Mon 08:30AM", "Tue By Appointment Only", "Sat Closed").
  const days = (t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?:?\s+(\d{1,2}(:\d{2})?\s*(am|pm)|by appointment|closed)\b/gi) ?? []).length;
  if (days >= 3) return true;
  // Contact panel: 2+ contact labels (phone, fax, office / mailing address, email, hours) and no real sentences.
  const labels = new Set((t.match(/(phone|fax|office address|mailing address|e-?mail|office hours)/gi) ?? []).map((x) => x.toLowerCase()));
  const sentences = (t.match(/[a-z]{2}[.!?](\s|$)/g) ?? []).length;
  return labels.size >= 2 && sentences < 2;
}
export function isRealBio(text: string, name: string): boolean {
  const t = cleanText(text);
  if (t.length < 40) return false;
  const ranges = t.match(/\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current|today)\b/gi) ?? [];
  if (ranges.length >= 2) return false;
  const sentences = (t.match(/[.!?](\s|$)/g) ?? []).length;
  const tokens = name.replace(/[^A-Za-z\s'-]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !NAME_SUFFIX_RE.test(w));
  if (tokens.some((w) => new RegExp(`\\b${w.replace(/[-']/g, '.')}\\b`, 'i').test(t))) return true;
  if (/\b(i|i'm|i've|i am|my|me|we|we're|our|us)\b/i.test(t)) return true;
  if (/\b(he|she|his|her|hers|they|their)\b/i.test(t) && sentences >= 2) return true;
  return t.length >= 200 && sentences >= 2;
}
/** First 300 characters of normVal: the key compared against contract.boilerplate_values. */
export function boilerplateKey(v: unknown): string {
  return normVal(v).slice(0, 300);
}

/** Phones compare by their last 10 digits; list items and objects by their main text. */
function countKey(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.latitude === 'number') return normVal(v);
    if (typeof o.text === 'string') return normVal(o.text);
    if (typeof o.day === 'string') return normVal(`${o.day}${o.opens ?? ''}${o.closes ?? ''}`);
    return normVal(o.url ?? o.title ?? o.name ?? o.school ?? o.text ?? o.number ?? JSON.stringify(o));
  }
  const s = String(v ?? '');
  const d = s.replace(/\D/g, '');
  if (/^\s*(tel:)?[+()\d\s.\-]+$/i.test(s) && (d.length === 10 || (d.length === 11 && d.startsWith('1')))) return 'tel' + d.slice(-10);
  return normVal(s);
}

export type Action = { label: string; url: string; type: string };
/** Navigation / account links are not calls to action. */
const ACTION_NAV_RE = /^(log ?in|sign ?in|sign ?up|register|my account|careers?|jobs|search|menu|home|back|skip|privacy|terms|cookies?|find (an?|your) [a-z ]+|locations?)$/i;
/** Action type by fixed rules on the button text / key name and the link. */
export function actionType(text: string, url: string): string {
  const t = ` ${text.toLowerCase()} `;
  if (/^tel:/i.test(url)) return 'call';
  if (/^sms:/i.test(url)) return 'text';
  if (/^mailto:/i.test(url)) return 'email';
  if (/quote/.test(t)) return 'quote';
  if (/\bdemo\b/.test(t)) return 'demo';
  if (/\b(book|schedul|appointment|meeting|reserve|consult)/.test(t) || /calendly\.com|acuityscheduling|bookings|\/book/i.test(url)) return 'book';
  if (/\breview\b/.test(t)) return 'review';
  if (/\b(text|sms)\b/.test(t)) return 'text';
  if (/\bcall\b/.test(t)) return 'call';
  if (/\b(contact|message|connect|get in touch|ask|inquir|enquir|chat|e-?mail)/.test(t)) return 'contact';
  return 'other';
}
/** Label for a registry action key without page text: its slug words, e.g. "request quote action" → "Request quote". */
function actionLabelFromSlug(words: string): string {
  const w = words.replace(/\b(action|cta|url|button|link|widget|agent|brand)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : words;
}
/** Key used to compare actions across sample pages (contract.sitewide_actions). */
export function actionKey(label: string, url: string): string {
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${/^https?:/i.test(url) ? urlCore(url) : url.toLowerCase()}`;
}

export type StagingStatic = {
  /** Static ids in section-4 formats (helpers removed). */
  universal: Record<string, unknown>;
  /** Extras left after routed extras are removed. */
  extras: Record<string, unknown>;
  /** Fill source per static id that did not come from a page rule. */
  sources: Record<string, 'taxonomy' | 'extra' | 'derived'>;
};

/** Step 3: page rule → route → derived → quality → format. */
export function buildStagingStatic(args: {
  contract: Partial<Pick<SiteContract, 'primary_subject' | 'static_routes' | 'boilerplate_values' | 'sitewide_actions' | 'sitewide_media'>>;
  values: Record<string, unknown>;
  extras?: Record<string, unknown>;
  pageUrl: string;
}): StagingStatic {
  const { contract, pageUrl } = args;
  const vals: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(args.values ?? {})) if (nonEmpty(v)) vals[id] = v;
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.extras ?? {})) if (nonEmpty(v)) extras[k] = v;
  const sources: StagingStatic['sources'] = {};

  // 2-3. routes. Single-value ids: only when the page rule gave nothing, first route with a value wins
  // (category keys must agree). List ids: page values + every category key + every extra, merged.
  const routedExtras = new Map<string, string[]>();
  for (const [sid, list] of Object.entries(contract.static_routes ?? {})) {
    const routesFor = Array.isArray(list) ? list : [];
    const type = fieldType(sid);
    if (!type || keyOf(sid) === 'actions') continue; // actions are merged below
    for (const r of routesFor) if (r.kind === 'extra') routedExtras.set(sid, [...(routedExtras.get(sid) ?? []), r.from]);
    const merge = isMergeableId(sid);
    if (!merge && nonEmpty(vals[sid])) continue;
    const merged: unknown[] = merge ? [...(Array.isArray(vals[sid]) ? (vals[sid] as unknown[]) : nonEmpty(vals[sid]) ? [vals[sid]] : [])] : [];
    const before = merged.length;
    for (const route of routesFor) {
      if (!merge && nonEmpty(vals[sid])) break;
      if (route.kind === 'taxonomy') {
        const got: unknown[] = [];
        for (const from of route.from) {
          let v = vals[from];
          if (!nonEmpty(v)) continue;
          if (route.part && v && typeof v === 'object' && !Array.isArray(v)) {
            const o = v as Record<string, unknown>;
            const map: Record<string, string> = { street: 'streetAddress', city: 'addressLocality', state: 'addressRegion', postal_code: 'postalCode' };
            v = route.part === 'latitude' || route.part === 'longitude' ? o[route.part] : o[map[route.part]];
          } else if (route.part) continue;
          const ok = validateValue(type, v, pageUrl, sid);
          if (nonEmpty(ok)) got.push(ok);
        }
        if (!got.length) continue;
        if (merge) { for (const g of got) merged.push(...(Array.isArray(g) ? g : [g])); continue; }
        const keys = new Set(got.map((g) => (Array.isArray(g) ? g.map(countKey).sort().join('|') : countKey(g))));
        if (keys.size !== 1) continue; // keys disagree: nothing is copied
        vals[sid] = got[0];
        sources[sid] = 'taxonomy';
      } else {
        let v = extras[route.from];
        if (!nonEmpty(v)) continue;
        // Stored text joined with commas, where the site lists separate entries (decided per source).
        if (route.split_commas) v = asStrings(v).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
        const ok = validateValue(type, v, pageUrl, sid);
        if (!nonEmpty(ok)) continue;
        if (merge) { merged.push(...(Array.isArray(ok) ? ok : [ok])); continue; }
        vals[sid] = ok;
        sources[sid] = 'extra';
      }
    }
    if (merge && merged.length > before) {
      vals[sid] = merged;
      sources[sid] = routesFor.some((r) => r.kind === 'extra' && nonEmpty(extras[r.from])) ? 'extra' : 'taxonomy';
    }
  }
  // Routed extras are not kept in _extra once their static id has a value.
  for (const [sid, keys] of routedExtras) if (nonEmpty(vals[sid])) for (const k of keys) delete extras[k];

  // actions: page buttons + every routed action key; site-wide and navigation items dropped.
  const actionsBy: Record<string, Action[]> = {};
  // A call / text / email action for a number or address already captured adds nothing.
  const last10 = (x: string) => x.replace(/\D/g, '').slice(-10);
  const knownPhones = new Set(
    ['person.phone', 'person.fax', 'location.phone', 'location.fax', 'firm.phone_main', 'firm.fax']
      .flatMap((id) => asStrings(vals[id])).map(last10).filter((d) => d.length === 10),
  );
  const knownEmails = new Set(
    ['person.email', 'location.email', 'firm.email']
      .flatMap((id) => asStrings(vals[id])).map((e) => e.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase()).filter(Boolean),
  );
  for (const subj of ['person', 'location'] as const) {
    const sid = `${subj}.actions`;
    const list: Action[] = [];
    const seen = new Set<string>();
    const push = (label: string, rawUrl: string, typeHint = '') => {
      const url = actionUrl(rawUrl, pageUrl);
      const lab = cleanText(label);
      if (!url || !lab || lab.length > 80) return;
      if (/^(tel|sms):/i.test(url) && knownPhones.has(last10(url))) return;
      if (/^mailto:/i.test(url) && knownEmails.has(url.slice(7).split('?')[0].trim().toLowerCase())) return;
      const fmtUrl = /^https?:/.test(url) ? formatUrl(url, pageUrl) : url;
      if (!fmtUrl) return;
      if (ACTION_NAV_RE.test(lab) || contract.sitewide_actions?.[sid]?.includes(actionKey(lab, fmtUrl))) return;
      const k = fmtUrl.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      list.push({ label: lab, url: fmtUrl, type: actionType(`${typeHint} ${lab}`, fmtUrl) });
    };
    for (const s of asStrings(vals[sid])) { const a = decodeAction(s); if (a) push(a.label, a.url); }
    const r = (contract.static_routes?.[sid] ?? []).find((x) => x.kind === 'taxonomy' && x.merge);
    if (r && r.kind === 'taxonomy') {
      for (const from of r.from) {
        const slugWords = from.slice(TAX_PREFIX.length).replace(/[_-]+/g, ' ');
        for (const u of asStrings(vals[from])) {
          const before = list.length;
          push(actionLabelFromSlug(slugWords), u, slugWords);
          if (list.length > before) sources[sid] ??= 'taxonomy';
        }
      }
    }
    // An office action identical to one of the person's actions adds nothing.
    if (subj === 'location' && actionsBy['person.actions']) {
      const personUrls = new Set(actionsBy['person.actions'].map((a) => a.url.toLowerCase()));
      for (let i = list.length - 1; i >= 0; i--) if (personUrls.has(list[i].url.toLowerCase())) list.splice(i, 1);
    }
    if (list.length) actionsBy[sid] = list;
    // booking link from the first "book" action when the page gave none
    if (subj === 'person' && !nonEmpty(vals['person.booking_url'])) {
      const book = list.find((a) => a.type === 'book' && /^https?:/.test(a.url));
      if (book) { vals['person.booking_url'] = book.url; sources['person.booking_url'] = 'derived'; }
    }
  }

  // 4. derived rules
  // Fix (office block, 2026-10-12): an extra text that is one office address + one phone (parseOfficeBlock) fills the
  // empty office street / city / state / ZIP, and is the office phone when the page gave none or only the person's own
  // number. Single texts only (never lists, so listing addresses cannot match); it must agree with the office address
  // parts the page already gave. The extra is then removed (its facts are in static keys).
  {
    const last10 = (x: unknown) => String(asStrings(x)[0] ?? '').replace(/\D/g, '').slice(-10);
    const low = (x: unknown) => cleanText(String(asStrings(x)[0] ?? '')).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [k, raw] of Object.entries(extras)) {
      if (typeof raw !== 'string') continue;
      const ob = parseOfficeBlock(raw);
      if (!ob) continue;
      const curStreet = low(vals['location.street']);
      if (curStreet && !(curStreet.startsWith(low(ob.street)) || low(ob.street).startsWith(curStreet))) continue;
      if (nonEmpty(vals['location.city']) && low(vals['location.city']) !== low(ob.city)) continue;
      if (nonEmpty(vals['location.state']) && stateCode(cleanText(String(asStrings(vals['location.state'])[0]))) !== ob.state) continue;
      if (nonEmpty(vals['location.postal_code']) && last10(vals['location.postal_code']).slice(0, 5) !== ob.postal_code.slice(0, 5)) continue;
      for (const [part, v] of [['street', ob.street], ['city', ob.city], ['state', ob.state], ['postal_code', ob.postal_code]] as const) {
        const id = `location.${part}`;
        if (!nonEmpty(vals[id])) { vals[id] = v; sources[id] = 'derived'; }
      }
      const lp = last10(vals['location.phone']);
      if ((!lp || lp === last10(vals['person.phone'])) && lp !== ob.phone) { vals['location.phone'] = ob.phone; sources['location.phone'] = 'derived'; }
      delete extras[k];
      break;
    }
  }
  // Fix (years plausibility, 2026-10-13): a page value for years of experience counts only when it is a plausible
  // number of years (1-79). Anything else (e.g. a 4-digit year such as "2026" caught by an "Experience" label) is
  // discarded, so the person's own "N years of ... experience" text below can fill it.
  if (nonEmpty(vals['person.years_experience'])) {
    const yv = vals['person.years_experience'];
    const yn = typeof yv === 'number' ? yv : Number(String(asStrings(yv)[0] ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
    if (!(Number.isFinite(yn) && yn >= 1 && yn < 80)) { delete vals['person.years_experience']; delete sources['person.years_experience']; }
  }
  // Fix (years of experience, 2026-10-12): "N years of (professional / industry) experience" in the person's own text
  // gives the years (then the start year below), before the quality rules may drop that text as a bio. Site-wide text
  // (boilerplate) is not this person's.
  if (!nonEmpty(vals['person.years_experience']) && typeof vals['person.bio'] === 'string'
      && !contract.boilerplate_values?.['person.bio']?.includes(boilerplateKey(vals['person.bio'] as string))) {
    const m = (vals['person.bio'] as string).match(/\b(\d{1,2})\+?\s+years?\s+of\s+(?:(?:professional|industry|financial(?:\s+services)?|relevant)\s+)?experience\b/i);
    if (m) { vals['person.years_experience'] = Number(m[1]); sources['person.years_experience'] = 'derived'; }
  }
  const credTexts: Array<{ text: string; hint?: 'license' | 'registration' }> = [];
  for (const s of asStrings(vals['person.credentials'])) credTexts.push({ text: s });
  if (typeof vals['person.name'] === 'string') {
    const sp = splitPostNominals(vals['person.name'] as string);
    if (sp.designations.length || sp.trailing) {
      vals['person.name'] = sp.name;
      for (const d of sp.designations) credTexts.push({ text: d });
      if (sp.designations.length) sources['person.credentials'] ??= 'derived';
      // Text shown after the name that is not a designation is the title, when the page gave none.
      if (sp.trailing && !nonEmpty(vals['person.job_title'])) { vals['person.job_title'] = sp.trailing; sources['person.job_title'] = 'derived'; }
    }
  }
  for (const s of asStrings(vals['person.licenses'])) credTexts.push({ text: s, hint: 'license' });
  for (const s of asStrings(vals['person.registration_ids'])) credTexts.push({ text: s, hint: 'registration' });
  if (!nonEmpty(vals['person.year_started'])) {
    const n = Number(vals['person.years_experience']);
    const year = new Date().getUTCFullYear();
    if (Number.isFinite(n) && n > 0 && n < 80) { vals['person.year_started'] = year - Math.round(n); sources['person.year_started'] = 'derived'; }
  }

  // credentials: one object list from credentials, post-nominals, licences, registrations
  const creds: Credential[] = [];
  const credSeen = new Set<string>();
  for (const { text, hint } of credTexts) {
    const pieces = hint ? [text] : text.split(/[;\n]|\s\|\s/);
    for (const p of pieces) {
      const c = toCredential(p, hint);
      if (!c) continue;
      const k = `${(c.name ?? '').toLowerCase()}|${c.number ?? ''}`;
      if (credSeen.has(k)) continue;
      credSeen.add(k);
      creds.push(c);
    }
  }
  // Google place id from a Maps link already captured in the same subject's social links.
  for (const subj of ['person', 'location'] as const) {
    const id = `${subj}.gbp_place_id`;
    if (nonEmpty(vals[id])) continue;
    const pid = toPlaceId(asStrings(vals[`${subj}.social_links`]).filter((u) => /google\.|goo\.gl/i.test(u)));
    if (pid) { vals[id] = pid; sources[id] = 'derived'; }
  }
  const lic = creds.find((c) => c.type === 'license');
  if (lic) {
    if (!nonEmpty(vals['person.license_number']) && lic.number) { vals['person.license_number'] = lic.number; sources['person.license_number'] = 'derived'; }
    if (!nonEmpty(vals['person.license_state']) && lic.state) { vals['person.license_state'] = lic.state; sources['person.license_state'] = 'derived'; }
    if (!nonEmpty(vals['person.license_type']) && isLicenseLabel(lic.name, lic.number)) { vals['person.license_type'] = lic.name; sources['person.license_type'] = 'derived'; }
  }

  // quality: boilerplate text, list-like bio, links that are the page / home page / firm site
  for (const id of ['person.bio', 'location.description']) {
    const v = vals[id];
    if (typeof v !== 'string') continue;
    const bp = contract.boilerplate_values?.[id];
    if (bp?.includes(boilerplateKey(v))) {
      delete vals[id]; // site-wide text is not this entity's description
      continue;
    }
    if (id === 'person.bio' && isListLikeText(v)) delete vals[id];
  }
  // Opening-hours / contact panel text is not a description or a bio.
  for (const id of ['person.bio', 'location.description', 'firm.description']) {
    if (typeof vals[id] === 'string' && isHoursText(vals[id] as string)) delete vals[id];
  }
  // Street lines: a glued suite gets its space back ("Ave WestSuite 212" → "Ave West Suite 212"); a leading
  // branch / office name before the first part that starts with a house number is dropped.
  for (const id of ['person.street', 'location.street', 'firm.street']) {
    if (typeof vals[id] !== 'string') continue;
    let t = cleanText(vals[id] as string).replace(/([a-z.])(Suite|Ste\b|Unit|Apt|Bldg|Building|Floor|Fl\b|#)/g, '$1 $2');
    const parts = t.split(/\s*,\s*/);
    const i = parts.findIndex((p) => /^\d/.test(p));
    if (i > 0) t = parts.slice(i).join(', ');
    vals[id] = t;
  }
  // The profile URL is always the harvested page itself (section 3a).
  if ((contract.primary_subject ?? 'person') === 'person') vals['person.profile_url'] = pageUrl;
  // A real bio only: about this person (name or pronouns), not generic site text, not a job-history list.
  // Generic text is skipped, never moved to another key.
  if (typeof vals['person.bio'] === 'string' && !isRealBio(vals['person.bio'] as string, String(vals['person.name'] ?? ''))) {
    delete vals['person.bio'];
  }
  // A licence type is a short label; a whole licence block is not.
  if (typeof vals['person.license_type'] === 'string' && (cleanText(vals['person.license_type'] as string).length > 60 || /;/.test(vals['person.license_type'] as string)
    || cleanText(vals['person.license_type'] as string).length < 3 || !!stateCode(cleanText(vals['person.license_type'] as string)))) {
    delete vals['person.license_type'];
    if (lic && isLicenseLabel(lic.name, lic.number)) { vals['person.license_type'] = lic.name; sources['person.license_type'] = 'derived'; }
  }
  // US coordinates: latitude north (+), longitude west (−); outside the US range they are dropped.
  {
    const st = asStrings(vals['location.state'] ?? vals['person.state'])[0];
    const lat = Number(vals['location.latitude']);
    const lon = Number(vals['location.longitude']);
    if (st && stateCode(cleanText(st)) && Number.isFinite(lat) && Number.isFinite(lon)) {
      const la = Math.abs(lat);
      const lo = -Math.abs(lon);
      if (la >= 17 && la <= 72 && lo >= -180 && lo <= -64) { vals['location.latitude'] = la; vals['location.longitude'] = lo; }
      else { delete vals['location.latitude']; delete vals['location.longitude']; }
    }
  }
  const pageCore = urlCore(pageUrl);
  let homeCore = '';
  try { homeCore = urlCore(new URL('/', pageUrl).href); } catch { /* ignore */ }
  const firmCore = typeof vals['firm.website'] === 'string' ? urlCore(formatUrl(vals['firm.website'], pageUrl) ?? '') : '';
  for (const id of ['person.website', 'person.booking_url']) {
    const u = formatUrl(vals[id], pageUrl);
    const c = u ? urlCore(u) : '';
    if (!c || c === pageCore || c === homeCore || (firmCore && c === firmCore)) delete vals[id];
  }
  // The firm website is the home page, never this profile page.
  if (firmCore && firmCore === pageCore) delete vals['firm.website'];
  // Fix (office website, 2026-10-12): the office website is never this profile page either
  // (Edward Jones filled location.website with the advisor's own page on 19,390 rows).
  {
    const u = formatUrl(vals['location.website'], pageUrl);
    if (u && urlCore(u) === pageCore) delete vals['location.website'];
  }
  // Social links point to social profiles, not back to this site.
  const siteRoot = (() => { try { return new URL(pageUrl).hostname.toLowerCase().split('.').slice(-2).join('.'); } catch { return ''; } })();
  for (const id of ['person.social_links', 'location.social_links', 'firm.social_links']) {
    if (!nonEmpty(vals[id]) || !siteRoot) continue;
    const kept = asStrings(vals[id]).filter((u) => {
      try { const h = new URL(u, pageUrl).hostname.toLowerCase(); return h !== siteRoot && !h.endsWith('.' + siteRoot); } catch { return true; }
    });
    if (kept.length) vals[id] = kept; else delete vals[id];
  }

  // formats
  const universal: Record<string, unknown> = {};
  for (const [id, fmt] of Object.entries(STATIC_FORMATS)) {
    const v = vals[id];
    let out: unknown = null;
    const key = id.slice(id.indexOf('.') + 1);
    switch (fmt) {
      case 'credential_list': out = id === 'person.credentials' && creds.length ? creds : null; break;
      case 'text': out = formatText(v); break;
      case 'phone': out = nonEmpty(v) ? toUSPhone10(v) : null; break;
      case 'email': {
        const e = asStrings(v)[0]?.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
        out = e && EMAIL_RE.test(e) ? e : null; break;
      }
      case 'url': out = nonEmpty(v) ? formatUrl(v, pageUrl) : null; break;
      case 'state': { const s = asStrings(v)[0]; out = s ? stateCode(cleanText(s)) : null; break; }
      case 'postal': { const s = asStrings(v)[0]; out = s ? (cleanText(s).match(ZIP_RE)?.[1] ?? null) : null; break; }
      case 'year': {
        const n = typeof v === 'number' ? v : Number(String(asStrings(v)[0] ?? '').match(/\d{4}/)?.[0]);
        out = Number.isInteger(n) && n >= 1800 && n <= new Date().getUTCFullYear() ? n : null; break;
      }
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(asStrings(v)[0] ?? '').trim());
        out = nonEmpty(v) && Number.isFinite(n) ? n : null; break;
      }
      case 'list': { const l = formatList(key, v); out = l.length ? l : null; break; }
      case 'link_list': { const l = toLinks(v, pageUrl); out = l.length ? l : null; break; }
      case 'hours_list': { const l = toHours(v); out = l.length ? l : null; break; }
      case 'member_list': {
        const exclude = new Set(['person.name', 'person.services', 'person.specialties', 'person.job_title', 'person.headline']
          .flatMap((k) => asStrings(vals[k])).flatMap((x) => [x, ...x.split(',')]).map((x) => cleanText(x).toLowerCase()).filter(Boolean));
        const l = toMembers(v, pageUrl, exclude); out = l.length ? l : null; break;
      }
      case 'place_id': out = toPlaceId(v); break;
      case 'action_list': out = actionsBy[id] ?? null; break;
      case 'award_list': { const l = toAwards(v, pageUrl); out = l.length ? l : null; break; }
      case 'video_list': {
        const site = new Set(contract.sitewide_media?.[id] ?? []);
        const l: Video[] = [];
        const seenV = new Set<string>();
        for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) {
          const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
          const vv = videoFromUrl(String(o ? o.url ?? '' : x), pageUrl);
          if (!vv || site.has(vv.url) || seenV.has(vv.url)) continue;
          seenV.add(vv.url);
          const title = o ? formatText(o.title) : null;
          l.push(title ? { ...vv, title } : vv);
        }
        out = l.length ? l : null; break;
      }
      case 'gallery_list': {
        const subj = id.slice(0, id.indexOf('.'));
        const own = new Set([`${subj}.photo_url`, `${subj}.cover_photo_url`, `${subj}.logo_url`, 'firm.logo_url']
          .map((k) => formatUrl(vals[k], pageUrl)).filter((x): x is string => !!x));
        const site = new Set(contract.sitewide_media?.[id] ?? []);
        const l: string[] = [];
        for (const x of asStrings(v)) {
          const u = formatUrl(x, pageUrl);
          if (!u || own.has(u) || site.has(u) || l.includes(u)) continue;
          l.push(u);
        }
        out = l.length ? l : null; break;
      }
      case 'education_list': { const l = toEducation(v); out = l.length ? l : null; break; }
    }
    if (nonEmpty(out)) universal[id] = out;
  }
  return { universal, extras, sources };
}

/**
 * Field count for the yield gate and the measured floor: distinct values over the
 * static (formatted) and taxonomy values. Phones compare by their last 10 digits;
 * a value already inside another key's list counts once; a list contained in
 * another list counts once.
 */
export function countStagingFields(universal: Record<string, unknown>, values: Record<string, unknown>): number {
  const all: unknown[] = [
    ...Object.values(universal),
    ...Object.entries(values).filter(([id, v]) => isTaxId(id) && nonEmpty(v)).map(([, v]) => v),
  ];
  const scalars = new Set<string>();
  const lists: Set<string>[] = [];
  for (const v of all) {
    if (Array.isArray(v)) {
      const s = new Set(v.map(countKey).filter(Boolean));
      if (s.size) lists.push(s);
    } else {
      const k = countKey(v);
      if (k) scalars.add(k);
    }
  }
  const inAnyList = (k: string) => lists.some((l) => l.has(k));
  let n = [...scalars].filter((k) => !inAnyList(k)).length;
  const sig = (s: Set<string>) => [...s].sort().join('|');
  const distinct = [...new Map(lists.map((l) => [sig(l), l])).values()];
  for (const l of distinct) {
    const containedElsewhere = distinct.some((o) => o !== l && o.size > l.size && [...l].every((x) => o.has(x)));
    if (!containedElsewhere) n++;
  }
  return n;
}
