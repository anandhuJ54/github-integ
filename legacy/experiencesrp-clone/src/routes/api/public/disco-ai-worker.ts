// ============================================================================
// disco-ai-worker — the AI brain for Category Population.
// Calls Claude, STRICTLY validates the structured output, and writes back ONLY
// through the governed RPCs (never direct table writes). The graph stays protected.
//
// Tools implemented: discover_companies (source discovery: brand sites, then
// directories — DR-3), classify_method, map_site.
//
// Network policy: Anthropic calls (callClaude) always go direct. ALL fetches of
// external target websites (classify_method, map_site) are routed through
// disco-webscraper-worker's scrapeWebsite() — the single shared Oxylabs fetch /
// bot-block-detection / render-fallback layer (also the intended eventual home
// for the DB-side scrapers, once they can reach it). This is an in-process
// function call, not an HTTP hop, so it needs no x-disco-worker-key of its own.
// See disco-webscraper-worker.ts for the OXYLABS_* config it reads.
//
// Trigger: POST /api/public/disco-ai-worker with header x-disco-worker-key.
// It drains any `pending` rows in disco_llm_requests and returns.
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';
import { scrapeWebsite, looksBlocked, captureNetworkCalls, fetchApiCall, type CrawlMethod } from './disco-webscraper-worker';
import { runV2Research, runV2Step, type V2Research } from './disco-agent-mapper';
import { refreshExtraKeys } from './-disco-extra-keys';
import { noteAiUsage, withCostContext, ACTIVITY_BY_REQUEST_TOOL } from './-disco-ai-cost';
import { probeDetailApi, fetchDetailJson, learnJsonFields, JSON_FIELDS_TOOL, type DetailRouteResult } from './-disco-detail-api';
import { generateCategoryBoundary } from './-disco-boundary';
import {
  allFieldIds,
  buildJsonLdFields,
  buildTaxonomyJsonLdFields,
  collectEmbeddedEntities,
  collectSiteEntityNames,
  embeddedEntityUrls,
  ENTITY_TYPE_RE,
  extractJsonLdBlocks,
  hasPageSpecificEntityJsonLd,
  pageEntityEvidence,
  jsonLdTypes,
  JSONLD_SKIP_KEYS,
  resolveTaxonomyKeys,
  taxonomyLocatorIds,
  taxonomyPromptLines,
  taxonomyRoleLines,
  applyTaxonomyRoles,
  taxonomySubjectMap,
  taxonomyActionIds,
  addTaxonomyAliases,
  type ApplyOptions,
  type TaxonomyRole,
  taxonomyTypes,
  taxonomyItemWords,
  cleanHtmlForPrompt,
  chromeHtmlForPrompt,
  firmLocatorIds,
  mergeFirmRules,
  buildFirmProfile,
  taxonomyLogoIds,
  previousContractRules,
  markKeptFields,
  FIRM_DIAGNOSTICS_CAP,
  type FirmDiagnostic,
  type FirmProfile,
  type SiteContract,
  fieldType,
  finalizeSiteContract,
  mergeCssRules,
  locatorTargetIds,
  mustHaveIds,
  type FieldSpec,
  type PrimarySubject,
  type Rule,
  type Sample,
  type TaxonomyRow,
  type ExtraFieldSpec,
  type ExtraDropped,
  type FieldType,
  EXTRA_PREFIX,
  EXTRA_DROPPED_CAP,
  PERSON_KEYS,
  PERSON_IDENTITY_KEYS,
  FIELD_MEANINGS,
  LOCATION_KEYS,
  FIRM_KEYS,
  normalizeExtraKey,
  EXTRA_VALUE_TYPES,
  EXTRA_SUBJECTS,
  type ExtraValueType,
  type ExtraSubject,
  type RejectedRule,
  isStaticExtraKey,
  isRouteTarget,
  isMergeableId,
  staticTargetForKey,
  buildStaticRoutes,
  type ExtraRouteCandidate,
  finalizeExtraFields,
  applyExtraFields,
  docOf,
  extraSampleAgrees,
  chooseExtraContainer,
  applySiteContract as applyContractS4,
  applyAddressOwner as applyAddressOwnerS4,
  countStagingFields,
  buildStagingStatic,
  boilerplateKey,
  decodeAction,
  actionKey,
  videoFromUrl,
  recordMustHave,
} from './-disco-site-contract';
import {
  normalizeCapturedCalls,
  parseJsonLoose,
  profileUrlsInJson,
  idTemplateHits,
  idUrlsAt,
  recordTemplateHits,
  recordUrlsAt,
  type RecordTemplate,
  pagingFromTwoCalls,
  pagingFromParams,
  totalsInJson,
  callWithPage,
  callParams,
  replayHeaders,
  endpointKey,
  noiseReason,
  type CapturedCall,
  type Paging,
} from './-disco-network-route';
import {
  statedTotalInText,
  needsMoreRoutes,
  findSearchInputs,
  searchValues,
  nameStarts,
  type SearchInput,
  type SearchKind,
  type CityRow,
} from './-disco-search-route';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const BATCH = 5;

// Fix (strip null characters before saving, 2026-10-15): Postgres jsonb cannot store the NUL character (\u0000);
// one in page text (howardhanna.com, request 165) failed the map step save with "unsupported Unicode escape
// sequence" and lost the step's progress. Every value this worker writes to the database goes through noNul, which
// removes NUL from all strings and keys (the character carries no data). Generic: applies to every site and tool.
function noNul<T>(v: T): T {
  if (typeof v === 'string') return (v.indexOf('\u0000') >= 0 ? v.replace(/\u0000/g, '') : v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => noNul(x)) as unknown as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[noNul(k)] = noNul(x);
    return out as T;
  }
  return v;
}

// ---- structured-output contract for discover_companies ----------------------
// DR-3 (2026-09-30): source-oriented discovery. The model returns WEBSITES that
// publish many individual profile pages for the category — brand sites first,
// then directories — ranked by authority (market share, size, brand strength and
// number of profile pages). It no longer returns entities that "match" the
// category definition, which made person-level categories return personal sites.
const DISCOVER_SOURCE_TYPES = [
  'brand_site',
  'portal',
  'directory',
  'review_platform',
  'association',
  'license_registry',
] as const;
const DISCOVER_BRAND_MAX = 20;
const DISCOVER_DIRECTORY_MAX = 10;
// Up to 30 sources with evidence per call; the default 4096 can truncate.
const DISCOVER_MAX_TOKENS = 8192;
// Registries are real per-state / per-county sites; cap them per answer so they
// do not crowd out other directories (later rounds bring the next ones).
const DISCOVER_REGISTRY_MAX = 3;

const DISCOVER_TOOL = {
  name: 'return_top_sources',
  description:
    'Return the leading real US websites that publish many individual profile pages for a category.',
  input_schema: {
    type: 'object',
    properties: {
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Official organisation or site name' },
            domain: {
              type: 'string',
              description: 'Primary official website domain only, e.g. example.com',
            },
            group: { type: 'string', enum: ['brand_site', 'directory'] },
            source_type: { type: 'string', enum: [...DISCOVER_SOURCE_TYPES] },
            authority_rank: { type: 'integer', description: '1 = strongest within its group' },
            profiles_hosted_estimate: {
              type: 'integer',
              description:
                'Approximate number of individual US profile (or location) pages the site publishes for this category',
            },
            evidence: {
              type: 'string',
              description: 'Why it ranks here (market share, size, brand strength), including the page count',
            },
            // P0 site mapper (2026-10-05): optional hints the mapper verifies before use.
            directory_url: {
              type: 'string',
              description:
                'Optional. Full URL of the page on this site that lists or searches its individual profiles. Leave empty if not sure.',
            },
            profile_url_example: {
              type: 'string',
              description:
                'Optional. Full URL of one real individual profile page on this site. Leave empty if not sure.',
            },
          },
          required: [
            'name',
            'domain',
            'group',
            'source_type',
            'authority_rank',
            'profiles_hosted_estimate',
            'evidence',
          ],
        },
      },
    },
    required: ['sources'],
  },
} as const;

const CONTRACT_TOOL = {
  name: 'return_site_contract',
  description: 'Return a deterministic parser contract for this site.',
  input_schema: {
    type: 'object',
    properties: {
      roster_pattern: {
        type: 'string',
        description:
          'A regular expression matched against a URL to decide whether it is a roster/listing page ' +
          'for this site, e.g. "/agents/[a-z-]+/?$". Must be a valid regex, not a plain-English description.',
      },
      detail_pattern: {
        type: 'string',
        description:
          'A regular expression matched against a URL to decide whether it is an entity detail page ' +
          'for this site (required), e.g. "/agents/[a-z0-9-]+-\\\\d+$". Must be a valid regex.',
      },
      field_floor: {
        type: 'integer',
        description: 'Count of distinct fields the detail page offers',
      },
      extraction: {
        type: 'object',
        description:
          'How to pull entities out of the detail page. Set "list_source" to "jsonld" when the page has ' +
          'application/ld+json script tags with the entity data; then "json_path" is the array of keys ' +
          'to walk from the parsed JSON-LD root to the entity object (or list of entity objects), ' +
          'and "field_map" maps our field names to the keys on each entity object in that JSON-LD, ' +
          'e.g. { "list_source": "jsonld", "json_path": ["mainEntity","itemListElement"], ' +
          '"field_map": { "name": "name", "phone": "telephone" } }. ' +
          'If the page has no JSON-LD entity list, set "list_source" to "none" and leave json_path/field_map empty ' +
          '-- the page will be queued for per-page extraction instead.',
        properties: {
          list_source: { type: 'string', enum: ['jsonld', 'none'] },
          json_path: { type: 'array', items: { type: 'string' } },
          field_map: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['list_source'],
      },
    },
    required: ['roster_pattern', 'detail_pattern', 'field_floor', 'extraction'],
  },
} as const;

const METHOD_TOOL = {
  name: 'return_render_mode',
  description: 'Judge whether the raw HTML already contains entity data.',
  input_schema: {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['server_crawl', 'needs_js_api'] },
      evidence: { type: 'string', description: 'Short reason' },
    },
    required: ['method', 'evidence'],
  },
} as const;

const ROSTER_LINK_TOOL = {
  name: 'pick_roster_link',
  description:
    "Pick which link, if any, leads to a directory/roster of this category's professionals or locations.",
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      index: {
        type: 'integer',
        description: 'Index into the numbered link list; omit if found=false',
      },
      reason: { type: 'string' },
    },
    required: ['found'],
  },
} as const;

const ENTITY_PAGE_TOOL = {
  name: 'return_entity_page',
  description:
    'Judge whether a page describes ONE identifiable person, professional, or business (vs a directory/search-form/marketing page).',
  input_schema: {
    type: 'object',
    properties: {
      is_entity_page: { type: 'boolean' },
      reason: { type: 'string', description: 'Short reason' },
      entity_kind: {
        type: 'string',
        enum: ['person', 'business'],
        description: 'Only when is_entity_page=true: whether the page describes one person or one business/office',
      },
      fits_category: {
        type: 'boolean',
        description:
          "True only if the page's subject belongs to the given category as defined (e.g. a client-facing practitioner or office of that category), not a person or business in some other role",
      },
    },
    required: ['is_entity_page', 'reason'],
  },
} as const;

// Fix (pattern coverage, 2026-10-05): one small corrective call that only returns a pattern.
const PATTERN_TOOL = {
  name: 'return_detail_pattern',
  description: 'Return a corrected detail_pattern regular expression for profile (detail) page URLs.',
  input_schema: {
    type: 'object',
    properties: {
      detail_pattern: { type: 'string', description: 'Regular expression matched against a full URL' },
      reason: { type: 'string', description: 'Short reason' },
    },
    required: ['detail_pattern'],
  },
} as const;

const NO_PROFILES_TOOL = {
  name: 'return_profile_availability',
  description:
    'Say whether this website hosts individual profile pages (one per person or office) for professionals in the category, and if not, where they live.',
  input_schema: {
    type: 'object',
    properties: {
      hosts_profiles: { type: 'string', enum: ['yes', 'no', 'unsure'] },
      where_profiles_live: {
        type: 'string',
        description:
          'Short, e.g. "advisors\' own websites", "firm search tool that loads results via JavaScript", "not publicly listed"',
      },
      note: { type: 'string' },
      profiles_url: {
        type: 'string',
        description: 'If individual profiles, or the directory/search that lists them, live at a URL on this same company site root (ANY subdomain, e.g. advisor.<root> or locations.<root>), give that full URL. Omit if they are on a different company\'s domain or not public.',
      },
    },
    required: ['hosts_profiles'],
  },
} as const;

// P0 (2026-10-05): one call per map when discovery left no hint for the source.
const SOURCE_HINTS_TOOL = {
  name: 'return_profile_urls',
  description:
    'Give the URL of the page on this website that lists or searches its individual profiles, and one real profile page URL, if known.',
  input_schema: {
    type: 'object',
    properties: {
      directory_url: { type: 'string', description: 'Full URL on this website, or empty if not known' },
      profile_url_example: { type: 'string', description: 'Full URL of one real profile page on this website, or empty if not known' },
    },
    required: [],
  },
} as const;

const LOCATOR_TOOL = {
  name: 'return_locator_rules',
  description:
    'Return CSS / label extraction rules for the requested field ids, plus labelled facts on the page that no id covers.',
  input_schema: {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        maxItems: 120,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Field id, e.g. person.job_title' },
            strategy: { type: 'string', enum: ['css', 'label'] },
            css: { type: 'string' },
            label: { type: 'string' },
            attr: { type: 'string', enum: ['content', 'href', 'src', 'data-href', 'action'] },
            multi: { type: 'boolean' },
            part: { type: 'string', enum: ['latitude', 'longitude'], description: 'Geo ids only: which coordinate this rule reads.' },
            split_commas: {
              type: 'boolean',
              description: 'List ids only: true when one element holds several entries separated by commas and each part is a complete entry on its own (e.g. "Annuities, 529 Plans"); false when parts depend on each other (e.g. "Series 7, 63, 65").',
            },
            item_fields: {
              type: 'object',
              description: 'person.awards / person.education only, when each entry is a block with parts: css of each part relative to the block matched by css (keys: title, year, issuer, description, url for awards; school, degree, year for education).',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['id', 'strategy'],
        },
      },
      taxonomy_roles: {
        type: 'array',
        maxItems: 60,
        description: 'Only category keys whose subject differs from the default, plus at most one own_page_url key.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Category key id, e.g. tax.<slug>' },
            role: { type: 'string', enum: ['person', 'branch', 'firm', 'own_page_url'] },
          },
          required: ['id', 'role'],
        },
      },
      unkeyed: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            sample: { type: 'string' },
            key: { type: 'string', description: 'snake_case key for this fact' },
            match: { type: 'string', enum: ['existing_extra', 'taxonomy', 'static', 'new'] },
            strategy: { type: 'string', enum: ['css', 'label'] },
            css: { type: 'string', description: 'Required when strategy is css: a selector that returns this fact on every detail page.' },
            attr: { type: 'string', enum: ['content', 'href', 'src', 'data-href', 'action'] },
            multi: { type: 'boolean' },
            split_commas: { type: 'boolean', description: 'true when one element lists several entries separated by commas and each part is a complete entry' },
          },
          required: ['label', 'sample', 'strategy'],
        },
      },
    },
    required: ['rules', 'unkeyed'],
  },
} as const;

// C14c: extra key matching on real example values.
const MATCH_EXTRA_TOOL = {
  name: 'return_extra_key_matches',
  description: 'For each new extra, the existing key holding the same kind of information, or null.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The new extra key' },
            match: { type: ['string', 'null'], description: 'Existing key with the same meaning, or null' },
            static_id: { type: ['string', 'null'], description: 'Open static id holding exactly this information, or null' },
            reason: { type: 'string', description: 'One short sentence' },
            new_key: { type: ['string', 'null'], description: 'Only when match is null and the key is already in the existing list: a different descriptive snake_case name (no numbers added)' },
            definition: { type: ['string', 'null'], description: 'Only when match is null: one generic sentence saying what the value means (not tied to this site)' },
            value_type: { type: ['string', 'null'], enum: [...EXTRA_VALUE_TYPES, null], description: 'Only when match is null: the format of the value' },
            subject: { type: ['string', 'null'], enum: [...EXTRA_SUBJECTS, null], description: 'Only when match is null: whose fact it is' },
          },
          required: ['key', 'match', 'reason'],
        },
      },
    },
    required: ['matches'],
  },
} as const;

class MapSiteError extends Error {
  diagnostics: Record<string, unknown>;
  constructor(message: string, diagnostics: Record<string, unknown>) {
    super(message);
    this.name = 'MapSiteError';
    this.diagnostics = diagnostics;
  }
}

// ---- anthropic helper -------------------------------------------------------
// Always direct — never routed through Oxylabs. Only target-website fetches
// (fetchPage below, which delegates to disco-webscraper-worker) go through
// the proxy.
async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  tool: { name: string },
  maxTokens = 4096,
  temperature?: number,
): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const data: any = await res.json();
  // Fix (ETL AI cost log, 2026-10-22): every call notes its token usage (activity from the request, or from the tool).
  noteAiUsage({ model: String(data?.model ?? model), usage: data?.usage, tool: tool.name });
  const block = (data.content ?? []).find((b: any) => b?.type === 'tool_use');
  if (!block) throw new Error('model returned no tool_use block');
  return block.input ?? {};
}

// Fix (route-based mapper step 1, 2026-10-06): mapping AI calls go through callClaudeMap.
// Fix (temperature rejected, 2026-10-06): the mapping model (claude-sonnet-4-6) rejects the
// temperature parameter ("temperature is deprecated for this model"), so no temperature is sent;
// calls run exactly as before step 1. Repeatability comes from removing AI guessing (plan step 2).
const MAP_TEMPERATURE: number | undefined = undefined;
function callClaudeMap(apiKey: string, model: string, prompt: string, tool: { name: string }, maxTokens = 4096): Promise<any> {
  return callClaude(apiKey, model, prompt, tool, maxTokens, MAP_TEMPERATURE);
}

// ---- network helper: ALL external website traffic goes through the shared
// disco-webscraper-worker fetch layer (scrapeWebsite) ------------------------
// LLM/API traffic remains direct Anthropic traffic; only target websites are
// routed through the scraper service. Oxylabs config (OXYLABS_USERNAME/
// PASSWORD/ENDPOINT/GEO_LOCATION/USER_AGENT_TYPE/TIMEOUT_MS/
// RENDER_TIMEOUT_MS), bot-block detection, and the blocked-response
// render-fallback retry all live in disco-webscraper-worker.ts now — this
// file just calls scrapeWebsite() and adapts its result to the FetchResult
// shape the rest of this file already expects, so classifyMethod/mapSite
// below needed no changes beyond that adapter.

type FetchResult = {
  ok: boolean;
  status: number;
  body: string;
  url: string;
  networkError?: string;
  rendered?: boolean;
  oxylabsJobId?: string;
};

async function fetchPage(
  url: string,
  method: CrawlMethod = 'server_crawl',
): Promise<FetchResult> {
  const result = await scrapeWebsite({ url, crawl_method: method });
  return {
    ok: result.ok,
    status: result.status_code ?? 0,
    body: result.content ?? '',
    url: result.resolved_url ?? url,
    networkError: result.error,
    rendered: result.rendered,
    oxylabsJobId: result.oxylabs?.job_id,
  };
}

// ============================================================================
// §1 discover_companies — source discovery (DR-3, 2026-09-30)
// ============================================================================
type Boundary = {
  definition?: string;
  includes?: string[];
  excludes?: Array<{ type?: string; goes_to?: string }>;
  subtypes?: Array<{ name?: string; criteria?: string }>;
};

type DiscoverContext = {
  category: string; // gcid
  displayName: string;
  // gbp_categories.entity_type: 'both' (professional-first) → person, 'location' → place
  unit: 'person' | 'place';
  complexity?: string;
  boundary?: Boundary;
  excludeDomains: string[];
  // P0 (2026-10-05): exp_taxonomy names for the category (person: profession_title + alias;
  // place: alias + specialization) and negative_keyword phrases. Empty when none.
  terms?: string[];
  negatives?: string[];
};

type DiscoveredSource = {
  name: string;
  domain: string;
  group: 'brand_site' | 'directory';
  source_type: (typeof DISCOVER_SOURCE_TYPES)[number];
  authority_rank: number; // overall position: brand sites first, then directories
  group_rank: number; // rank the model gave within its group
  profiles_hosted_estimate: number;
  evidence: string;
  directory_url?: string; // P0: same-site URLs only; dropped otherwise
  profile_url_example?: string;
};

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const PLACEHOLDER_RE = /placeholder|lorem ipsum|\btbd\b|\bremoved\b/i;
// Names must be the organisation's name only; the model sometimes writes notes about
// the do-not-repeat list into the name ("… (excluded, x.com already listed) - replaced with …").
const NAME_COMMENT_RE =
  /\b(excluded|replaced|omitted|already (listed|found|included)|instead of)\b|\balternatives?\s*($|[-/(),;:]|to\b)/i;

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0]
    .replace(/\.$/, '');
}

function isSourceDomain(d: string): boolean {
  return DOMAIN_RE.test(d);
}

// P0 (2026-10-05): a hint URL is kept only when it is a full http(s) URL on the
// source's own site (any subdomain). Anything else is dropped, never guessed.
function sameSiteUrl(raw: unknown, domain: string): string | undefined {
  const s = cleanUrl(String(raw ?? ''));
  if (!s) return undefined;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    return isSameSite(u.toString(), domain) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

// P0 (2026-10-05): taxonomy names and negative phrases for a category, read-only.
// Person categories use profession_title + alias; place categories alias + specialization.
// Returns empty lists on no rows or any error, never throws.
async function loadCategoryTerms(
  db: any,
  gcid: string,
  unit: 'person' | 'place',
): Promise<{ terms: string[]; negatives: string[] }> {
  const out = { terms: [] as string[], negatives: [] as string[] };
  if (!gcid) return out;
  try {
    const nameLevels = unit === 'person' ? ['profession_title', 'alias'] : ['alias', 'specialization'];
    const { data, error } = await db
      .from('exp_taxonomy')
      .select('level, term_display')
      .eq('gcid', gcid)
      .eq('is_active', true)
      .in('level', [...nameLevels, 'negative_keyword']);
    if (error || !data) return out;
    const terms = new Map<string, string>();
    const negs = new Map<string, string>();
    for (const row of data as Array<{ level: string; term_display: string | null }>) {
      const t = String(row?.term_display ?? '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const key = t.toLowerCase().replace(/[®™]/g, '');
      if (row.level === 'negative_keyword') negs.set(key, t);
      else if (!terms.has(key)) terms.set(key, t);
    }
    out.terms = [...terms.values()];
    out.negatives = [...negs.values()];
  } catch {
    /* enhancement only */
  }
  return out;
}

function buildDiscoverPrompt(ctx: DiscoverContext): string {
  const person = ctx.unit === 'person';
  const pages = person ? 'profile pages' : 'location pages';
  const members = person ? 'profiles' : 'locations';
  const L: string[] = [];

  L.push(
    person
      ? 'You are finding data sources for a professional-profile graph.'
      : 'You are finding data sources for a local-business profile graph.',
  );
  L.push('');
  L.push(
    `CATEGORY: "${ctx.displayName}" [${ctx.category}]${ctx.complexity ? ` (${ctx.complexity} complexity)` : ''}`,
  );
  L.push(
    person
      ? 'PROFILE UNIT: an individual person. One profile = one page about one professional, usually with their office and firm.'
      : 'PROFILE UNIT: a single physical location. One profile = one page about one place, with its address, hours and contact details.',
  );

  const b = ctx.boundary;
  if (b?.definition) {
    L.push('', 'WHAT ONE PROFILE LOOKS LIKE:', `DEFINITION: ${b.definition}`);
    const includes = (b.includes ?? []).filter(Boolean).join('; ');
    if (includes) L.push(`INCLUDES: ${includes}`);
    const subtypes = (b.subtypes ?? [])
      .filter((s) => s?.name)
      .map((s) => (s.criteria ? `${s.name} (${s.criteria})` : String(s.name)))
      .join('; ');
    if (subtypes) L.push(`PROFILE SUB-TYPES: ${subtypes}`);
    const excludes = (b.excludes ?? []).filter((e) => e?.type);
    if (excludes.length) {
      L.push(
        `THESE ARE NOT PROFILES OF THIS CATEGORY (they are separate categories), BUT THEIR WEBSITES ARE ` +
          `VALID SOURCES IF THEY PUBLISH PAGES FOR THE ${members.toUpperCase()} ABOVE:`,
      );
      for (const e of excludes) L.push(`  • ${e.type} → ${e.goes_to ?? 'another category'}  (can be a source)`);
    }
  }
  // P0 (2026-10-05): category names and negative phrases from the taxonomy.
  const terms = (ctx.terms ?? []).slice(0, 20);
  if (terms.length) {
    L.push('', `ALSO CALLED: ${terms.join('; ')}`);
  }
  const negatives = (ctx.negatives ?? []).slice(0, 15);
  if (negatives.length) {
    L.push(`NOT WHAT WE WANT (sites mainly about these are not sources): ${negatives.join('; ')}`);
  }

  L.push('');
  L.push(`TASK: list the real US websites that publish many individual ${pages} for this category, in two groups:`);
  L.push('');
  L.push(
    person
      ? `GROUP 1 — BRAND SITES (up to ${DISCOVER_BRAND_MAX}): firms, brokerages, franchisors and networks whose own website has a page per professional (e.g. a staff directory or "find a professional" search).`
      : `GROUP 1 — BRAND SITES (up to ${DISCOVER_BRAND_MAX}): chains, franchisors and multi-location groups whose own website has a page per location (e.g. a store or location finder).`,
  );
  L.push(
    person
      ? `GROUP 2 — DIRECTORIES (up to ${DISCOVER_DIRECTORY_MAX}): portals, directories, review platforms, professional associations and licence registries that list professionals from many firms.`
      : `GROUP 2 — DIRECTORIES (up to ${DISCOVER_DIRECTORY_MAX}): directories, portals, review platforms, industry associations and government registries (e.g. licensing or inspection lists) that list locations from many owners.`,
  );
  L.push(
    `Registries are listed one per state or county with their real website domain; include at most ${DISCOVER_REGISTRY_MAX} registries, largest first, so other directories are not crowded out.`,
  );
  L.push(
    'Where several sites belong to the same owner and show the same profiles, return only the main domain. ' +
      'Do not return a site owned by the same company as any site in the ALREADY FOUND list.',
  );
  L.push(
    `List category-focused directories first (sites built around this kind of ${person ? 'professional' : 'business'}). ` +
      'Include a general multi-industry directory only if it has a dedicated section for these profiles with substantial coverage, and rank it below the category-focused ones.',
  );
  L.push('Do not pad either group: return fewer sites than the maximum if fewer qualify.');
  L.push('Do not return general search engines or map apps.');
  L.push(
    `Return sites whose ${members} mainly belong to this category; sites whose ${members} mainly belong to a narrower or different category are found under that category.`,
  );
  L.push('');
  L.push(
    person
      ? 'NOT A SOURCE: a website about a single person or a single small team (personal sites, single-professional pages). Do not return these.'
      : "NOT A SOURCE: a website for a single location (e.g. an independent business's own site). Do not return these; directories cover them.",
  );
  if (ctx.excludeDomains.length) {
    L.push('');
    L.push('ALREADY FOUND — do NOT repeat these domains; return only sites not in this list:');
    L.push(ctx.excludeDomains.join(', '));
  }
  L.push('');
  L.push(
    `RANK within each group by authority: market share, size, brand strength and the number of individual ${pages} the site publishes.`,
  );
  L.push('');
  L.push(
    "For each site return: name (the organisation's official name only — no comments, alternatives or notes about other sites); " +
      'official primary domain only (no marketing subdomains, no guesses); group; ' +
      'source_type (brand_site for group 1; portal | directory | review_platform | association | license_registry for group 2); ' +
      'authority_rank (1 = strongest in its group); profiles_hosted_estimate; evidence (why it ranks here, including the page count).',
  );
  L.push(
    `Optional, only when you know them: directory_url (the page on that site that lists or searches its ${members}) and ` +
      `profile_url_example (one real ${person ? 'profile' : 'location'} page URL on that site). Leave them empty rather than guess.`,
  );
  L.push('');
  L.push('Only include sites you are confident are real. Use the return_top_sources tool.');
  return L.join('\n');
}

// Strict validation before anything reaches the DB. Invalid entries are counted
// (they trigger one retry); repeats of already-seen domains are silently skipped.
function validateDiscoveredSources(
  raw: unknown,
  exclude: Set<string>,
): { sources: DiscoveredSource[]; rejected: number } {
  const brands: DiscoveredSource[] = [];
  const dirs: DiscoveredSource[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    const name = String((r as any)?.name ?? '').trim();
    const domain = normalizeDomain(String((r as any)?.domain ?? ''));
    const group = (r as any)?.group;
    const st = (r as any)?.source_type;
    const est = Number((r as any)?.profiles_hosted_estimate);
    const rank = Number((r as any)?.authority_rank);
    const evidence = String((r as any)?.evidence ?? '').trim();
    const typeOk =
      group === 'brand_site'
        ? st === 'brand_site'
        : group === 'directory' && st !== 'brand_site' && (DISCOVER_SOURCE_TYPES as readonly string[]).includes(st);
    if (
      !name ||
      !isSourceDomain(domain) ||
      !typeOk ||
      !Number.isFinite(est) ||
      est <= 0 ||
      PLACEHOLDER_RE.test(name) ||
      NAME_COMMENT_RE.test(name) ||
      PLACEHOLDER_RE.test(evidence)
    ) {
      rejected++;
      continue;
    }
    if (exclude.has(domain) || seen.has(domain)) continue;
    seen.add(domain);
    const s: DiscoveredSource = {
      name,
      domain,
      group,
      source_type: st,
      authority_rank: 0,
      group_rank: Number.isFinite(rank) && rank > 0 ? Math.round(rank) : 999,
      profiles_hosted_estimate: Math.round(est),
      evidence,
    };
    // P0: optional hints — kept only when they are URLs on this source's own site.
    const dirUrl = sameSiteUrl((r as any)?.directory_url, domain);
    const profUrl = sameSiteUrl((r as any)?.profile_url_example, domain);
    if (dirUrl) s.directory_url = dirUrl;
    if (profUrl) s.profile_url_example = profUrl;
    (group === 'brand_site' ? brands : dirs).push(s);
  }
  const byRank = (a: DiscoveredSource, b: DiscoveredSource) => a.group_rank - b.group_rank;
  let registries = 0;
  const directories = dirs
    .sort(byRank)
    .filter((s) => s.source_type !== 'license_registry' || ++registries <= DISCOVER_REGISTRY_MAX);
  const sources = [
    ...brands.sort(byRank).slice(0, DISCOVER_BRAND_MAX),
    ...directories.slice(0, DISCOVER_DIRECTORY_MAX),
  ].map((s, i) => ({ ...s, authority_rank: i + 1 }));
  return { sources, rejected };
}

// Read-only context: category unit and name, plus every domain already seen for
// this category (existing sources and every earlier proposal) so a rerun only
// returns new sites.
async function loadDiscoverContext(
  db: any,
  category: string,
  complexity: string | undefined,
  boundary: Boundary | undefined,
): Promise<DiscoverContext> {
  const { data: cat, error: catErr } = await db
    .from('gbp_categories')
    .select('display_name, entity_type')
    .eq('gcid', category)
    .maybeSingle();
  if (catErr) throw new Error(`gbp_categories read failed: ${catErr.message}`);

  const seen = new Set<string>();
  const { data: srcs, error: srcErr } = await db
    .from('exp_etl_sources')
    .select('source_domain')
    .eq('gcid', category);
  if (srcErr) throw new Error(`exp_etl_sources read failed: ${srcErr.message}`);
  for (const s of srcs ?? []) {
    const d = normalizeDomain(String(s?.source_domain ?? ''));
    if (isSourceDomain(d)) seen.add(d);
  }
  const { data: props, error: propErr } = await db
    .from('disco_proposals')
    .select('payload')
    .eq('category_slug', category)
    .eq('kind', 'company_list');
  if (propErr) throw new Error(`disco_proposals read failed: ${propErr.message}`);
  for (const p of props ?? []) {
    for (const c of (p?.payload?.companies ?? []) as any[]) {
      const d = normalizeDomain(String(c?.domain ?? ''));
      if (isSourceDomain(d)) seen.add(d);
    }
  }

  const unit: 'person' | 'place' = cat?.entity_type === 'location' ? 'place' : 'person';
  const { terms, negatives } = await loadCategoryTerms(db, category, unit);
  return {
    category,
    displayName: cat?.display_name || category.replace(/^gcid:/, '').replace(/_/g, ' '),
    unit,
    complexity,
    boundary,
    excludeDomains: [...seen].sort(),
    terms,
    negatives,
  };
}

async function discoverSources(
  apiKey: string,
  model: string,
  ctx: DiscoverContext,
): Promise<DiscoveredSource[]> {
  const prompt = buildDiscoverPrompt(ctx);
  const exclude = new Set(ctx.excludeDomains);
  let best: { sources: DiscoveredSource[]; rejected: number } | null = null;
  // One retry when the answer is empty or has a noticeable share of broken entries.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const input = await callClaude(apiKey, model, prompt, DISCOVER_TOOL, DISCOVER_MAX_TOKENS);
    const result = validateDiscoveredSources(input?.sources, exclude);
    if (!best || result.sources.length > best.sources.length) best = result;
    const broken = result.sources.length === 0 || result.rejected > Math.max(2, result.sources.length * 0.2);
    if (!broken) break;
  }
  if (!best || best.sources.length === 0) throw new Error('no valid sources in model output');
  return best.sources;
}

// ============================================================================
// §2 classify_method
// ============================================================================
const ROSTER_HINTS = [
  'find a loan officer',
  'find an agent',
  'loan officers',
  'our agents',
  'find a lender',
  'locations',
  'branches',
  'offices',
  'our team',
  'agents',
  'find a ',
  'find an ',
  'locator',
  'near me',
  'near you',
  'directory',
];

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function findRosterLink(html: string, base: string, extraHints: string[] = []): string | null {
  const ranked = rankRosterLinks(html, base, extraHints);
  return ranked.length && ranked[0].score > 0 ? ranked[0].href : null;
}

// Category-driven roster phrases from exp_taxonomy profession titles. An
// enhancement only — returns [] on no rows or any error, never throws.
async function getDynamicRosterHints(db: any, gcid: string): Promise<string[]> {
  if (!gcid) return [];
  try {
    const { data, error } = await db
      .from('exp_taxonomy')
      .select('term_display')
      .eq('gcid', gcid)
      .eq('level', 'profession_title')
      .eq('is_active', true);
    if (error || !data) return [];
    const out = new Set<string>();
    for (const row of data as Array<{ term_display: string | null }>) {
      const term = String(row?.term_display ?? '').trim().toLowerCase();
      if (!term) continue;
      out.add(term);
      out.add(`find a ${term}`);
      out.add(`find your ${term}`);
      out.add(`our ${term}s`);
      out.add(`meet our ${term}s`);
      out.add(`${term} directory`);
    }
    return [...out];
  } catch {
    return [];
  }
}

// Every same-site (incl. subdomain) <a> with non-empty visible text, deduped by resolved href,
// capped at 50 in document order.
function extractAllLinks(html: string, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 50) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const abs = absolutize(m[1], base);
    if (!abs || !/^https?:/.test(abs)) continue;
    if (!isSameSite(abs, siteRootOf(base))) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ href: abs, text: text.slice(0, 160) });
  }
  return out;
}

// LLM escalation — only called when the deterministic hint match fails.
async function pickRosterLinkWithLLM(
  apiKey: string,
  model: string,
  category: string,
  boundary: Boundary | undefined,
  links: { href: string; text: string }[],
  temperature?: number,
): Promise<string | null> {
  const boundaryBlock = boundary?.definition
    ? `CATEGORY BOUNDARY:\n${boundary.definition}\n` +
      (boundary.includes?.length ? `Includes: ${boundary.includes.join('; ')}\n` : '')
    : '';
  const list = links.map((l, i) => `${i}. ${l.text} — ${l.href}`).join('\n');
  const input = await callClaude(
    apiKey,
    model,
    `Category: "${category}".\n` +
      boundaryBlock +
      `\nBelow is a numbered list of links from a company's website. Which numbered link, if any, ` +
      `leads to a directory/roster of this category's professionals or locations? ` +
      `Answer via the pick_roster_link tool (found=false if none).\n\n${list}`,
    ROSTER_LINK_TOOL,
    256,
    temperature,
  );
  if (input?.found !== true) return null;
  const idx = Number(input?.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= links.length) return null;
  return links[idx].href;
}

// Fix (inconclusive pages, 2026-10-06): a page that errors, is blocked or says "not found"
// tells nothing about whether its URL form is a profile; it is inconclusive, not a rejection.
const INCONCLUSIVE_REASON_RE = /\b(404|not found|page not found|blocked|access denied|captcha|error page|not accessible|unavailable|forbidden)\b/i;
function pageDidNotLoad(r: FetchResult | null | undefined): boolean {
  return !r || !r.ok || !r.body || r.status >= 400 || looksBotBlocked(r);
}

function looksBotBlocked(r: FetchResult): boolean {
  return looksBlocked(r.status, r.body);
}

function hasEntityData(html: string): boolean {
  if (/application\/ld\+json/i.test(html)) return true;
  if (/__NEXT_DATA__|__NUXT__|window\.__INITIAL_STATE__/i.test(html)) return true;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 2000;
}

function isJsShell(html: string): boolean {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length < 500 && /<div[^>]+id=["'](root|app|__next)["']/i.test(html);
}

// Fix (script-only form results, 2026-10-08): a page whose visible text is under 500 characters
// (scripts and styles removed) - a form result that only fills in with JavaScript. Used by the
// search route to stop submitting that form and type into the box in the browser instead.
function isEmptyShell(html: string): boolean {
  if (!html) return true;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length < 500;
}

// Keys whose values are related people/details, not the page's subject.
const ENTITY_KIND_EXTRA_SKIP = new Set([
  'employee', 'employees', 'member', 'members', 'founder', 'founders', 'alumni', 'contactPoint',
]);

// What the page describes: one person ('professional'), one business/office
// ('location'), or undetermined (null). Same qualifying rules as
// hasPageSpecificEntityJsonLd.
type PageEntityKind = 'professional' | 'location';
type PageEntityKindResult = {
  kind: PageEntityKind | null;
  source: 'jsonld' | 'url_match' | null;
};

// Normalize a page URL / JSON-LD `url`/`@id` value so both sides of the
// rule-(b2) comparison can be matched: drop fragment + query, lowercase,
// drop the www. host prefix, drop one trailing slash.
function normalizePageRef(raw: string): string {
  let s = raw.trim();
  const hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);
  const q = s.indexOf('?');
  if (q !== -1) s = s.slice(0, q);
  s = s.toLowerCase();
  const m = s.match(/^(https?:\/\/)([^/]+)(\/.*)?$/);
  if (m) {
    let host = m[2];
    if (host.startsWith('www.')) host = host.slice(4);
    s = host + (m[3] ?? '');
  }
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function detectPageEntityKindDetailed(
  html: string,
  siteEntityNames: Set<string>,
  pageUrl?: string,
): PageEntityKindResult {
  const blocks = extractJsonLdBlocks(html);
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const qualifies = (obj: Record<string, unknown>): boolean => {
    const name = obj['name'];
    return (
      typeof name === 'string' &&
      !!name.trim() &&
      jsonLdTypes(obj).some((x) => ENTITY_TYPE_RE.test(x)) &&
      !siteEntityNames.has(name.trim().toLowerCase())
    );
  };
  const isPerson = (obj: Record<string, unknown>) => jsonLdTypes(obj).some((x) => /person/i.test(x));

  // Collect all object nodes (full walk) for rules (a), (b) and (b2).
  const all: Record<string, unknown>[] = [];
  const stack: unknown[] = [...blocks];
  let guard = 0;
  while (stack.length && guard++ < 5000) {
    const n = stack.pop();
    if (Array.isArray(n)) { stack.push(...n); continue; }
    if (!isObj(n)) continue;
    all.push(n);
    for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v);
  }

  // (a) ProfilePage
  if (all.some((o) => jsonLdTypes(o).some((t) => t === 'ProfilePage')))
    return { kind: 'professional', source: 'jsonld' };

  // (b) qualifying mainEntity
  for (const o of all) {
    const me = o['mainEntity'];
    if (isObj(me) && qualifies(me))
      return { kind: isPerson(me) ? 'professional' : 'location', source: 'jsonld' };
  }

  // (b2) qualifying nodes whose url/@id points at this very page — the
  // page's own subject node(s), even when a second business node sits
  // alongside them at the same level.
  if (pageUrl) {
    const target = normalizePageRef(pageUrl);
    if (target) {
      const selfNodes = all.filter(
        (o) =>
          qualifies(o) &&
          [o['url'], o['@id']].some(
            (v) => typeof v === 'string' && normalizePageRef(v) === target,
          ),
      );
      if (selfNodes.length) {
        const persons = selfNodes.filter(isPerson).length;
        if (persons === selfNodes.length) return { kind: 'professional', source: 'url_match' };
        if (persons === 0) return { kind: 'location', source: 'url_match' };
        // mixed — fall through to rule (c)
      }
    }
  }

  // (c) breadth-first; items of arrays and @graph sit at the same depth as the array
  const expand = (items: unknown[]): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    const q: unknown[] = [...items];
    let g = 0;
    while (q.length && g++ < 5000) {
      const n = q.shift();
      if (Array.isArray(n)) { q.push(...n); continue; }
      if (!isObj(n)) continue;
      out.push(n);
      const graph = n['@graph'];
      if (Array.isArray(graph)) q.push(...graph);
    }
    return out;
  };
  let level = expand(blocks);
  let depth = 0;
  while (level.length && depth++ < 50) {
    const hits = level.filter(qualifies);
    if (hits.length) {
      const persons = hits.filter(isPerson).length;
      if (persons === hits.length) return { kind: 'professional', source: 'jsonld' };
      if (persons === 0) return { kind: 'location', source: 'jsonld' };
      return { kind: null, source: null };
    }
    const next: unknown[] = [];
    for (const o of level) {
      for (const [k, v] of Object.entries(o)) {
        if (k === '@graph' || JSONLD_SKIP_KEYS.has(k) || ENTITY_KIND_EXTRA_SKIP.has(k)) continue;
        if (v && typeof v === 'object') next.push(v);
      }
    }
    level = expand(next);
  }
  // (d)
  return { kind: null, source: null };
}

function detectPageEntityKind(
  html: string,
  siteEntityNames: Set<string>,
  pageUrl?: string,
): PageEntityKind | null {
  return detectPageEntityKindDetailed(html, siteEntityNames, pageUrl).kind;
}



type FetchTier = 'direct' | 'proxy' | 'proxy_render' | null;

async function classifyMethod(
  apiKey: string,
  model: string,
  domain: string,
  category: string,
  boundary: Boundary | undefined,
): Promise<{ method: string; evidence: string; fetch_tier: FetchTier }> {
  const url = `https://${domain}/`;

  // Tier 1 — always attempt a genuine direct fetch first (never FORCE_PROXY-gated:
  // that gate only governs real harvest traffic, not this classification probe).
  let tier: FetchTier = null;
  let home: FetchResult | null = null;

  const direct = await fetchPage(url, 'direct');
  if (
    !direct.networkError &&
    direct.ok &&
    !looksBotBlocked(direct) &&
    !isJsShell(direct.body) &&
    hasEntityData(direct.body)
  ) {
    home = direct;
    tier = 'direct';
  }

  // Tier 2 — proxy. A direct-only failure proves nothing about the site itself.
  if (!home) {
    const viaProxy = await fetchPage(url, 'server_crawl');
    tier = 'proxy';

    if (viaProxy.networkError) {
      return {
        method: 'unreachable',
        evidence: `fetch failed: ${viaProxy.networkError.slice(0, 200)}`,
        fetch_tier: null,
      };
    }
    if (looksBotBlocked(viaProxy)) {
      return {
        method: 'blocked_needs_proxy',
        evidence: `homepage returned ${viaProxy.status} / anti-bot challenge — needs proxy IP rotation`,
        fetch_tier: null,
      };
    }
    if (viaProxy.status >= 500) {
      return {
        method: 'unreachable',
        evidence: `homepage returned ${viaProxy.status}`,
        fetch_tier: null,
      };
    }
    if (!viaProxy.ok) {
      return {
        method: 'unreachable',
        evidence: `homepage returned ${viaProxy.status}`,
        fetch_tier: null,
      };
    }
    home = viaProxy;
  }

  // Tier 3 — rendered retry, only used to rescue a js_needs_api conclusion.
  const renderRescue = async (
    probeUrl: string,
    fallbackEvidence: string,
  ): Promise<{ method: string; evidence: string; fetch_tier: FetchTier }> => {
    const rendered = await fetchPage(probeUrl, 'needs_js_api');
    if (!rendered.networkError && rendered.ok && hasEntityData(rendered.body)) {
      return {
        method: 'server_crawl',
        evidence: `${fallbackEvidence} — but rendered fetch returned entity data; crawlable with rendering`,
        fetch_tier: 'proxy_render',
      };
    }
    return { method: 'js_needs_api', evidence: fallbackEvidence, fetch_tier: null };
  };

  // Follow one roster-style link when the homepage exposes one — the roster is
  // what actually has to be crawlable.
  let probe = home;
  let probeLabel = 'homepage';
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const extraHints = await getDynamicRosterHints(db, category);
  let roster = findRosterLink(home.body, home.url, extraHints);
  if (!roster) {
    const links = extractAllLinks(home.body, home.url);
    if (links.length > 0) {
      roster = await pickRosterLinkWithLLM(apiKey, model, category, boundary, links);
    }
  }
  if (roster) {
    const r = await fetchPage(roster, 'server_crawl');
    if (r.networkError) {
      return {
        method: 'unreachable',
        evidence: `roster ${roster} fetch failed`,
        fetch_tier: null,
      };
    }
    if (looksBotBlocked(r)) {
      return {
        method: 'blocked_needs_proxy',
        evidence: `roster page ${roster} returned ${r.status} / anti-bot — needs proxy IP rotation`,
        fetch_tier: null,
      };
    }
    if (r.ok) {
      probe = r;
      probeLabel = `roster ${roster}`;
    }
  }

  if (isJsShell(probe.body)) {
    return renderRescue(
      probe.url,
      `${probeLabel} is an empty JS shell — data loads via XHR; needs data API`,
    );
  }
  if (hasEntityData(probe.body)) {
    return {
      method: 'server_crawl',
      evidence: `${probeLabel} is server-rendered with entity data in raw HTML`,
      fetch_tier: tier,
    };
  }

  // Genuinely ambiguous — let the model judge from a markup excerpt.
  const input = await callClaude(
    apiKey,
    model,
    `Decide whether this raw HTML (fetched server-side, no JavaScript executed) already contains real entity data ` +
      `(person/office names, JSON-LD, embedded state), or whether it is an empty shell whose data loads over XHR.\n` +
      `Answer "server_crawl" or "needs_js_api" via the return_render_mode tool.\n\n` +
      `URL: ${probe.url}\n\nHTML (truncated):\n${probe.body.slice(0, 12000)}`,
    METHOD_TOOL,
    512,
  );
  const evidence = `model judgement on ${probeLabel}: ${String(input?.evidence ?? '').slice(0, 300)}`;
  if (input?.method === 'needs_js_api') {
    return renderRescue(probe.url, evidence);
  }
  return { method: 'server_crawl', evidence, fetch_tier: tier };
}

// ============================================================================
// §3 map_site — the parser-learner
// ============================================================================
function collectDetailUrls(html: string, base: string, cap = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#?]+)["']/gi;
  let m: RegExpExecArray | null;
  let baseHost = '';
  try {
    baseHost = new URL(base).host;
  } catch {
    /* ignore */
  }
  while ((m = re.exec(html))) {
    const abs = absolutize(m[1], base);
    if (!abs || !/^https?:/.test(abs)) continue;
    try {
      const u = new URL(abs);
      if (baseHost && u.host !== baseHost) continue;
      const depth = u.pathname.split('/').filter(Boolean).length;
      if (depth < 2) continue;
      if (/\.(jpg|jpeg|png|gif|svg|pdf|css|js|webp|ico)$/i.test(u.pathname)) continue;
      const key = u.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch {
      /* ignore */
    }
  }
  // deepest paths first — those are the entity detail pages
  return out
    .sort(
      (a, b) =>
        new URL(b).pathname.split('/').filter(Boolean).length -
        new URL(a).pathname.split('/').filter(Boolean).length,
    )
    .slice(0, cap);
}

// ---- Listing navigation (P3 pagination, pulled forward 2026-10-05) ----------
// Learns, from the chosen directory page, how to reach (a) the next page of the
// listing and (b) sub-listings (city / office / letter pages). Each rule is kept
// as verified only when fetching it actually yields profile links (final
// detail_pattern) that page 1 did not have. Additive: stored as
// extraction.navigation; nothing reads it until the harvest walk is approved.
type PageLink = { href: string; label: string; rel: string; cls: string };
type ListingNavigation = {
  listing_url: string;
  page1_detail_links: number;
  next_page: null | {
    how: 'rel_next' | 'url_number' | 'link_text';
    example_url: string;
    template: string | null;
    max_page_seen: number | null;
    new_detail_links: number;
    verified: boolean;
  };
  sub_listings: null | {
    pattern: string;
    source: 'roster_pattern' | 'same_path_group';
    count_on_listing: number;
    examples: string[];
    example_checked: string;
    new_detail_links: number;
    verified: boolean;
  };
  /** Profile links found on the fetched page 2 / sub-listing (sample candidates). */
  profile_links: string[];
  skipped?: string;
};

const NAV_PAGE_PARAMS = ['page', 'p', 'pg', 'pagenum', 'pagenumber', 'page_number', 'pageno', 'start', 'offset', 'from', 'skip'];
const NAV_NEXT_TEXT = /^(next|next page|next ›|next »|more|load more|show more|›|»|>|→|>>)$/i;

function reEsc(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function navAttr(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[2] ?? m[3] ?? '') : '';
}

// Every same-host link on a page, query strings kept (pagination lives there).
function collectPageLinks(html: string, base: string, cap = 2000): PageLink[] {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  let baseHost = '';
  try { baseHost = new URL(base).host; } catch { /* ignore */ }
  const push = (rawHref: string, label: string, rel: string, cls: string) => {
    if (out.length >= cap || !rawHref || rawHref.startsWith('#') || /^(javascript|mailto|tel):/i.test(rawHref)) return;
    const abs = absolutize(rawHref.replace(/&amp;/g, '&'), base);
    if (!abs || !/^https?:/.test(abs)) return;
    try {
      const u = new URL(abs);
      if (baseHost && u.host !== baseHost) return;
      if (/\.(jpg|jpeg|png|gif|svg|pdf|css|js|webp|ico|xml)$/i.test(u.pathname)) return;
      u.hash = '';
      const key = u.toString();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ href: key, label, rel: rel.toLowerCase(), cls: cls.toLowerCase() });
    } catch { /* ignore */ }
  };
  const linkRe = /<link\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const rel = navAttr(m[1], 'rel');
    if (/\bnext\b/i.test(rel)) push(navAttr(m[1], 'href'), '', rel, '');
  }
  const aRe = /<a\b([^>]*)>([\s\S]{0,600}?)<\/a>/gi;
  while ((m = aRe.exec(html))) {
    const attrs = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&raquo;/g, '»').replace(/&rsaquo;/g, '›').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    const label = (text || navAttr(attrs, 'aria-label') || navAttr(attrs, 'title')).slice(0, 80);
    push(navAttr(attrs, 'href'), label, navAttr(attrs, 'rel'), `${navAttr(attrs, 'class')} ${navAttr(attrs, 'aria-label')}`);
  }
  return out;
}

function detailLinkSet(links: PageLink[], detailRe: RegExp): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    let hit = false;
    try {
      hit = detailRe.test(l.href);
      if (!hit) { const u = new URL(l.href); u.search = ''; hit = detailRe.test(u.toString()); if (hit) { out.add(u.toString()); continue; } }
    } catch { hit = false; }
    if (hit) out.add(l.href);
  }
  return out;
}

// "Page n" template when `url` is the listing URL plus a page number (query or path).
function pageTemplate(url: string, listingUrl: string): string | null {
  try {
    const u = new URL(url);
    const r = new URL(listingUrl);
    if (u.host !== r.host) return null;
    const rPath = r.pathname.replace(/\/+$/, '');
    if (u.pathname.replace(/\/+$/, '') === rPath) {
      const qs: Array<[string, string]> = [];
      u.searchParams.forEach((v, k) => qs.push([k, v]));
      for (const [k, v] of qs) {
        if (!/^\d+$/.test(v) || Number(v) < 2) continue;
        const rv = r.searchParams.get(k);
        if (rv !== null && rv === v) continue;
        if (!NAV_PAGE_PARAMS.includes(k.toLowerCase()) && v !== '2') continue;
        const t = new URL(u.toString());
        t.searchParams.set(k, '__N__');
        return t.toString().replace('__N__', '{n}');
      }
      return null;
    }
    const m = new RegExp(`^${reEsc(rPath)}/(?:page/|p/)?(\\d+)/?$`, 'i').exec(u.pathname);
    if (m && Number(m[1]) >= 2) {
      const t = new URL(u.toString());
      t.pathname = u.pathname.replace(new RegExp(`${m[1]}(/?)$`), '{n}$1');
      return decodeURI(t.toString());
    }
  } catch { /* ignore */ }
  return null;
}

async function learnNavigation(
  listing: FetchResult,
  homeUrl: string,
  detailRe: RegExp,
  rosterPattern: string | null,
  crawlMethod: CrawlMethod,
): Promise<ListingNavigation> {
  const links = collectPageLinks(listing.body, listing.url);
  const page1 = detailLinkSet(links, detailRe);
  const nav: ListingNavigation = { listing_url: listing.url, page1_detail_links: page1.size, next_page: null, sub_listings: null, profile_links: [] };
  // Fix (sub-listings without profiles on page 1, 2026-10-07): a directory page that shows no
  // profile links itself (e.g. state/city hub pages) is still checked for sub-listings; only the
  // next-page check needs profile links on page 1.
  const noPage1 = page1.size === 0;
  const listingKey = (() => { try { const u = new URL(listing.url); u.hash = ''; return u.toString().replace(/\/+$/, ''); } catch { return listing.url; } })();
  const notListing = (h: string) => h.replace(/\/+$/, '') !== listingKey && h.replace(/\/+$/, '') !== homeUrl.replace(/\/+$/, '');

  // (a) next page: rel=next, then "page 2" URL, then a "Next" link.
  let next: { how: 'rel_next' | 'url_number' | 'link_text'; url: string } | null = null;
  const relNext = links.find((l) => /\bnext\b/.test(l.rel) && notListing(l.href));
  if (relNext) next = { how: 'rel_next', url: relNext.href };
  if (!next) {
    const numbered = links.find((l) => notListing(l.href) && !page1.has(l.href) && (() => {
      const t = pageTemplate(l.href, listing.url);
      if (!t) return false;
      try {
        const u = new URL(l.href);
        const qv: string[] = [];
        u.searchParams.forEach((v) => qv.push(v));
        const vals = [...qv, ...u.pathname.split('/')].filter((v) => /^\d+$/.test(v)).map(Number);
        return vals.includes(2) || vals.some((v) => v > 2 && v <= 100);
      } catch { return false; }
    })());
    if (numbered) next = { how: 'url_number', url: numbered.href };
  }
  if (!next) {
    const textNext = links.find((l) => notListing(l.href) && !page1.has(l.href) && (NAV_NEXT_TEXT.test(l.label) || /\b(next|pagination-next|page-next)\b/.test(l.cls)));
    if (textNext) next = { how: 'link_text', url: textNext.href };
  }

  if (noPage1) next = null;
  // (b) sub-listings: links that are not profiles, grouped by roster_pattern or by parent path.
  const nonDetail = links.filter((l) => notListing(l.href) && !page1.has(l.href) && l.href !== next?.url && (() => {
    try { return !detailRe.test(l.href); } catch { return true; }
  })());
  let sub: { pattern: string; source: 'roster_pattern' | 'same_path_group'; urls: string[] } | null = null;
  if (rosterPattern) {
    try {
      const rre = new RegExp(rosterPattern);
      const urls = nonDetail.map((l) => l.href).filter((h) => rre.test(h) && !pageTemplate(h, listing.url));
      if (urls.length >= 2) sub = { pattern: rosterPattern, source: 'roster_pattern', urls };
    } catch { /* ignore */ }
  }
  if (!sub) {
    let listingSegs: string[] = [];
    try { listingSegs = new URL(listing.url).pathname.split('/').filter(Boolean).map((x) => x.toLowerCase()); } catch { /* ignore */ }
    const groups = new Map<string, string[]>();
    for (const l of nonDetail) {
      try {
        const u = new URL(l.href);
        if (u.search) continue;
        const segs = u.pathname.split('/').filter(Boolean).map((x) => x.toLowerCase());
        if (segs.length <= listingSegs.length || listingSegs.some((x, i) => segs[i] !== x)) continue;
        const parent = segs.slice(0, -1).join('/');
        const g = groups.get(parent) ?? [];
        g.push(l.href);
        groups.set(parent, g);
      } catch { /* ignore */ }
    }
    const best = [...groups.entries()].filter(([, g]) => g.length >= 5).sort((a, b) => b[1].length - a[1].length)[0];
    if (best) {
      const host = new URL(listing.url).host;
      sub = {
        pattern: `^https?://${reEsc(host)}/${best[0] ? `${best[0].split('/').map(reEsc).join('/')}/` : ''}[^/?#]+/?$`,
        source: 'same_path_group',
        urls: best[1],
      };
    }
  }

  const newLinks = (r: FetchResult | null): string[] => {
    if (!r || !r.ok || !r.body) return [];
    return [...detailLinkSet(collectPageLinks(r.body, r.url), detailRe)].filter((u) => !page1.has(u));
  };
  const countNew = (r: FetchResult | null): number => newLinks(r).length;
  const need = page1.size ? Math.min(3, page1.size) : 3;
  const [nextPage, subPage] = await Promise.all([
    next ? fetchPage(next.url, crawlMethod).catch(() => null) : Promise.resolve(null),
    sub ? fetchPage(sub.urls[0], crawlMethod).catch(() => null) : Promise.resolve(null),
  ]);
  if (next) {
    const n = countNew(nextPage);
    const template = pageTemplate(next.url, listing.url);
    // Highest page number linked from page 1 for this template (e.g. pagination "1 2 3 … 187").
    let maxPage: number | null = null;
    if (template) {
      const tre = new RegExp(`^${reEsc(template).replace('\\{n\\}', '(\\d+)')}$`);
      for (const l of links) {
        const m = tre.exec(l.href);
        if (m) maxPage = Math.max(maxPage ?? 0, Number(m[1]));
      }
    }
    nav.next_page = { how: next.how, example_url: next.url, template, max_page_seen: maxPage, new_detail_links: n, verified: n >= need };
  }
  if (sub) {
    const n = countNew(subPage);
    nav.sub_listings = {
      pattern: sub.pattern,
      source: sub.source,
      count_on_listing: sub.urls.length,
      examples: sub.urls.slice(0, 3),
      example_checked: sub.urls[0],
      new_detail_links: n,
      verified: n >= need,
    };
  }
  nav.profile_links = [...new Set([...newLinks(nextPage), ...newLinks(subPage)])].slice(0, 40);
  if (noPage1 && !nav.sub_listings?.verified) nav.skipped = 'no profile links on the directory page itself';
  return nav;
}

// ---- route-based plan step 5 (2026-10-07): background calls (XHR / fetch) -------------------
// When the sitemap and listing routes fall short, the directory page (or its first sub-listing) is
// opened once in Oxylabs' browser and the background calls it makes are collected. A call counts
// only on evidence: its JSON response holds >= 3 links matching the profile rule (or profile IDs
// whose built links pass the normal profile-page check). Paging comes from the call itself (two
// captured calls to the same endpoint, else a page/offset parameter it sends) and is proven by
// replaying the next call and finding new profiles. Cookies and login/session headers are never
// kept. No AI is used to pick the call. Stored only when it is the best route.
// Fix (coverage rule, 2026-10-07): the fixed 500-profile trigger is replaced by needsMoreRoutes
// (best proven reach against a total the site states; see -disco-search-route.ts).
const NETWORK_CAPTURE_MS = 60_000; // browser capture (aborted at this limit)
// Fix (replay time, 2026-10-07): 45 s (was 20 s); a POST replay through Oxylabs took longer than 20 s
// on kw.com (dry run 1331). Still bounded by the step deadline.
const NETWORK_REPLAY_MS = 45_000; // next-page replay (aborted at this limit)

type NetworkRoute = {
  method: string;
  url: string;
  body: string | null;
  headers: Record<string, string>;
  profile_links_at: string | null;
  id_template: string | null;
  paging: Paging | null;
  page_size: number | null;
  total: number | null;
  total_pages: number | null;
  proof: { page1_profiles: number; next_value: number | null; next_new_profiles: number; proven: boolean; why: string };
};
type NetworkRouteReport = {
  status: 'proven' | 'found_not_proven' | 'none_found' | 'skipped' | 'error';
  reason: string;
  trigger?: string;
  captured_on?: string;
  scope?: 'listing' | 'sub_listing';
  scrolled?: boolean;
  actions?: string;
  failed_attempts?: Array<{ actions: string; error: string }>;
  calls_excluded?: Record<string, number>;
  calls_captured?: number;
  calls_checked?: number;
  calls?: Array<{ endpoint: string; status: number | null; profiles: number; via: 'url' | 'record' | 'id' | null; why: string }>;
  route?: NetworkRoute | null;
  reach_estimate?: number;
  basis?: string;
  ms?: number;
};

async function learnNetworkRoute(o: {
  pageUrl: string;
  scope: 'listing' | 'sub_listing';
  subListingCount: number;
  matches: (u: string) => boolean;
  knownProfiles: string[];
  crawlMethod: CrawlMethod;
  deadlineAt: number;
  judge: (u: string) => Promise<{ ok: boolean; reason: string }>;
  forced: boolean;
  triggerWhy: string;
}): Promise<NetworkRouteReport> {
  const started = Date.now();
  const left = () => o.deadlineAt - Date.now();
  const head = {
    trigger: o.forced ? `forced (dry run); ${o.triggerWhy}` : o.triggerWhy,
    captured_on: o.pageUrl,
    scope: o.scope,
  };
  if (left() < 20_000) return { status: 'skipped', reason: 'time budget', ...head };
  const cap = await captureNetworkCalls(o.pageUrl, { timeoutMs: Math.min(NETWORK_CAPTURE_MS, left() - 5_000) });
  if (!cap.ok) return { status: 'error', reason: `capture failed: ${cap.error ?? 'no result'}`, ...head, failed_attempts: cap.failed_attempts, ms: Date.now() - started };
  const all = normalizeCapturedCalls(cap.content);
  // Trackers, consent, bot-detection, monitoring and asset calls are dropped before checking.
  const excluded: Record<string, number> = {};
  const calls = all.filter((c) => {
    const why = noiseReason(c.url);
    if (why) excluded[why] = (excluded[why] ?? 0) + 1;
    return !why;
  });
  type Cand = {
    call: CapturedCall;
    json: unknown;
    urls: string[];
    path: string | null;
    via: 'url' | 'record' | 'id' | null;
    template: string | null;
    record: { array_path: string; template: RecordTemplate } | null;
    known: boolean;
    why: string;
  };
  const cands: Cand[] = calls.map((c) => {
    const none = { call: c, json: undefined, urls: [] as string[], path: null, via: null, template: null, record: null, known: false };
    if (c.status_code != null && (c.status_code < 200 || c.status_code >= 300)) return { ...none, why: `status ${c.status_code}` };
    const json = parseJsonLoose(c.response_body);
    if (json === undefined) return { ...none, why: 'not JSON' };
    const p = profileUrlsInJson(json, o.pageUrl, o.matches);
    if (p.urls.length >= 3) return { ...none, json, urls: p.urls, path: p.path, via: 'url', why: `${p.urls.length} profile links` };
    // Fix (links from record fields, 2026-10-07): records without links are turned into profile
    // links only from their own fields, with a template learned from a record whose profile URL is
    // known (kw.com: /agent/{slug:fullName}/{id}); the one-field ID template is the fallback.
    const rec = recordTemplateHits(json, o.knownProfiles, o.matches);
    if (rec && rec.urls.length >= 3) {
      return { ...none, json, urls: rec.urls, path: rec.array_path, via: 'record', template: rec.label, record: { array_path: rec.array_path, template: rec.template }, why: `${rec.urls.length} records → profile links (${rec.label})` };
    }
    const id = idTemplateHits(json, o.knownProfiles, o.matches);
    if (id && id.urls.length >= 3) {
      return { ...none, json, urls: id.urls, path: id.field_path, via: 'id', template: id.template, known: id.known_match, why: `${id.urls.length} profile IDs${id.known_match ? ' (match known profiles)' : ''}` };
    }
    return { ...none, json, why: p.urls.length ? `${p.urls.length} profile links (3 needed)` : 'no profile links' };
  });
  const report = () =>
    [...cands]
      .sort((a, b) => b.urls.length - a.urls.length)
      .slice(0, 15)
      .map((c) => ({ endpoint: endpointKey(c.call), status: c.call.status_code, profiles: c.urls.length, via: c.via, why: c.why }));
  const base0 = {
    ...head,
    scrolled: cap.scrolled,
    actions: cap.actions,
    ...(cap.failed_attempts.length ? { failed_attempts: cap.failed_attempts } : {}),
    calls_captured: all.length,
    calls_excluded: excluded,
    calls_checked: calls.length,
  };
  const hits = cands
    .filter((c) => c.via)
    .sort((a, b) => (a.via === 'url' ? 0 : 1) - (b.via === 'url' ? 0 : 1) || b.urls.length - a.urls.length);
  if (!hits.length) {
    return { status: 'none_found', reason: calls.length ? 'no background call lists profile links' : 'the page made no background calls', ...base0, calls: report(), ms: Date.now() - started };
  }
  // Built links must pass the normal profile-page check on one built link for a profile this run had
  // not seen (a link equal to a known profile proves nothing about the others). A record template
  // learned from a known profile's own record is accepted when no time is left for the check.
  const knownSet = new Set(o.knownProfiles.map((u) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()));
  let best: Cand | null = null;
  for (const h of hits.slice(0, 3)) {
    if (h.via === 'url') { best = h; break; }
    const probe = h.urls.find((u) => !knownSet.has(u.replace(/\/+$/, '').toLowerCase()));
    if (!probe) { h.why += '; every built link is an already known profile'; continue; }
    if (left() < 35_000) {
      if (h.via === 'record') { h.why += '; built link not checked (time budget)'; best = h; break; }
      h.why += '; built link not checked (time budget)';
      break;
    }
    const v = await o.judge(probe);
    if (v.ok) { h.why += '; built link passed the page check'; best = h; break; }
    h.why += `; built link failed the page check (${v.reason})`;
  }
  if (!best) {
    return { status: 'none_found', reason: 'profile IDs found, but no built link passed the profile-page check', ...base0, calls: report(), ms: Date.now() - started };
  }
  const extract = (json: unknown): string[] =>
    best!.via === 'record' && best!.record
      ? recordUrlsAt(json, best!.record.array_path, best!.record.template, o.matches)
      : best!.via === 'id' && best!.template && best!.path
        ? idUrlsAt(json, best!.path, best!.template, o.matches)
        : profileUrlsInJson(json, o.pageUrl, o.matches).urls;
  // Paging: two captured calls to the same endpoint first, else a page/offset parameter it sends.
  const seen = new Set(best.urls);
  let paging: Paging | null = null;
  let base: CapturedCall = best.call;
  for (const s of calls) {
    if (s === best.call || endpointKey(s) !== endpointKey(best.call)) continue;
    const later = pagingFromTwoCalls(best.call, s);
    const earlier = later ? null : pagingFromTwoCalls(s, best.call);
    if (later || earlier) {
      paging = later ?? earlier;
      base = later ? s : best.call;
      const sj = parseJsonLoose(s.response_body);
      if (sj !== undefined) for (const u of extract(sj)) seen.add(u);
      break;
    }
  }
  if (!paging) paging = pagingFromParams(best.call, best.urls.length);
  const totals = totalsInJson(best.json, best.urls.length);
  const headers = replayHeaders(base.request_headers);
  const proof: NetworkRoute['proof'] = { page1_profiles: best.urls.length, next_value: null, next_new_profiles: 0, proven: false, why: 'no paging found in the call' };
  if (paging) {
    const nextValue = paging.current + paging.step;
    proof.next_value = nextValue;
    const nc = callWithPage(base, paging.key, nextValue);
    if (!nc) proof.why = 'could not build the next call';
    else if (left() < 12_000) proof.why = 'next call not tried (time budget)';
    else {
      const r = await fetchApiCall({ url: nc.url, method: base.method, headers, body: nc.body, crawl_method: o.crawlMethod, timeoutMs: Math.min(NETWORK_REPLAY_MS, left() - 2_000) });
      if (!r.ok) {
        proof.why = r.status_code === 401 || r.status_code === 403
          ? `next call refused (status ${r.status_code}): needs a session, not used`
          : `next call failed (status ${r.status_code ?? 0}${r.error ? `: ${r.error.slice(0, 120)}` : ''})`;
      } else {
        const j = parseJsonLoose(r.content);
        const fresh = j === undefined ? [] : extract(j).filter((u) => !seen.has(u));
        proof.next_new_profiles = fresh.length;
        const need = Math.min(3, best.urls.length);
        proof.proven = fresh.length >= need;
        proof.why = j === undefined ? 'next call did not return JSON' : proof.proven ? `next call returned ${fresh.length} new profiles` : `next call returned ${fresh.length} new profiles (${need} needed)`;
      }
    }
  }
  const pageSize = paging?.page_size ?? best.urls.length;
  let reach = 0;
  let basis = '';
  if (proof.proven) {
    if (totals.total) { reach = totals.total; basis = `total stated by the call (${totals.total_key})`; }
    else if (totals.total_pages && pageSize) { reach = totals.total_pages * pageSize; basis = `${totals.total_pages} pages × ${pageSize} per page`; }
    else { reach = seen.size + proof.next_new_profiles; basis = 'profiles on the pages fetched (no total stated): lower bound'; }
    if (o.scope === 'sub_listing' && o.subListingCount > 1) { reach *= o.subListingCount; basis += ` × ${o.subListingCount} sub-listings (estimate)`; }
  }
  return {
    status: proof.proven ? 'proven' : 'found_not_proven',
    reason: proof.why,
    ...base0,
    calls: report(),
    route: {
      method: base.method,
      url: base.url,
      body: base.request_payload,
      headers,
      profile_links_at: best.path,
      id_template: best.via === 'id' || best.via === 'record' ? best.template : null,
      paging,
      page_size: paging?.page_size ?? best.urls.length,
      total: totals.total,
      total_pages: totals.total_pages,
      proof,
    },
    reach_estimate: reach,
    basis,
    ms: Date.now() - started,
  };
}

// ---- route-based plan step 6 (2026-10-07): search inputs -----------------------------------
// When the other routes still fall short (coverage rule) and the directory page has a search box,
// the mapper searches it with values from our own data: the largest cities (exp_us_cities), the
// most common ZIP among our professionals in each, and the commonest last-name starts in our
// professionals' names. Only two values are tried per kind while mapping. A GET / POST form is
// submitted directly; otherwise the value is typed in Oxylabs' browser and the background calls are
// read. Proven when the first value returns >= 3 profile links matching the profile rule and a
// second value returns >= 3 the first did not. No AI, no logins.
const SEARCH_CITY_SHORTLIST = 6; // cities read for the values tried while mapping (largest first)
const SEARCH_NAME_SAMPLE = 3000; // last names read to order initials / two-letter starts

type SearchAttempt = { kind: SearchKind; value: string; how: string; profiles: number; fresh: number; stated: number | null; note?: string; calls?: string[] };
type SearchRouteReport = {
  status: 'proven' | 'found_not_proven' | 'none_found' | 'skipped' | 'error';
  reason: string;
  trigger?: string;
  boxes?: Array<{ label: string; kinds: SearchKind[]; form: string | null }>;
  attempts?: SearchAttempt[];
  route?: {
    kind: SearchKind;
    format: string;
    how: 'form_get' | 'form_post' | 'browser_call';
    request: { method: string; url: string; body: string | null; value_at: string | null; headers?: Record<string, string> };
    profile_links_at: string | null;
    id_template: string | null;
    inputs: { rule: string; tried: string[] };
    per_input: { profiles: number[]; stated: Array<number | null> };
    next_page: { template: string | null; new_profiles: number } | null;
  } | null;
  reach_estimate?: number;
  basis?: string;
  ms?: number;
};

async function loadSearchValues(db: any, kinds: Set<SearchKind>): Promise<{ cities: CityRow[]; letters: string[]; bigrams: Record<string, string> }> {
  let cities: CityRow[] = [];
  if (kinds.has('city') || kinds.has('zip')) {
    const { data } = await db.from('exp_us_cities').select('city, state_abbr, population').order('population', { ascending: false }).limit(SEARCH_CITY_SHORTLIST);
    cities = ((data ?? []) as any[]).map((r) => ({ city: String(r.city), state: String(r.state_abbr), zip: null }));
    if (kinds.has('zip')) {
      for (const c of cities.slice(0, 4)) {
        const { data: zr } = await db.from('professionals').select('address_zip').ilike('address_city', c.city).ilike('address_state', c.state).not('address_zip', 'is', null).limit(300);
        const counts = new Map<string, number>();
        for (const r of (zr ?? []) as any[]) {
          const z = String(r.address_zip ?? '').slice(0, 5);
          if (/^\d{5}$/.test(z)) counts.set(z, (counts.get(z) ?? 0) + 1);
        }
        c.zip = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      }
    }
  }
  let letters: string[] = [];
  let bigrams: Record<string, string> = {};
  if (kinds.has('name')) {
    const { data } = await db.from('professionals').select('last_name').not('last_name', 'is', null).limit(SEARCH_NAME_SAMPLE);
    ({ letters, bigrams } = nameStarts(((data ?? []) as any[]).map((r) => String(r.last_name ?? ''))));
  }
  return { cities, letters, bigrams };
}

async function learnSearchRoute(o: {
  db: any;
  pageUrl: string;
  pageHtml?: string;
  boxes: SearchInput[];
  detailRe: RegExp;
  knownProfiles: string[];
  categoryWords: string[];
  crawlMethod: CrawlMethod;
  deadlineAt: number;
  trigger: string;
}): Promise<SearchRouteReport> {
  const started = Date.now();
  const left = () => o.deadlineAt - Date.now();
  const matches = (u: string) => { try { return o.detailRe.test(u); } catch { return false; } };
  const boxesReport = o.boxes.map((b) => ({ label: b.label, kinds: b.kinds, form: b.form ? `${b.form.method} ${b.form.action}` : null }));
  const head = { trigger: o.trigger, boxes: boxesReport };
  const kinds = new Set(o.boxes.flatMap((b) => b.kinds));
  const vals = await loadSearchValues(o.db, kinds);
  const attempts: SearchAttempt[] = [];
  const miss = (url: string): FetchResult => ({ ok: false, status: 0, body: '', url, networkError: 'time cap' });

  type Hit = {
    how: 'form_get' | 'form_post' | 'browser_call';
    urls: string[];
    stated: number | null;
    request: { method: string; url: string; body: string | null; value_at: string | null; headers?: Record<string, string> };
    path: string | null;
    template: string | null;
    html?: string;
    finalUrl?: string;
  };
  // Fix (results-page menu links, 2026-10-08): links already on the page holding the search box
  // (menus, footers, featured profiles) are not search results.
  const pageKeyOf = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  const onSearchPage = new Set(o.pageHtml ? collectPageLinks(o.pageHtml, o.pageUrl).map((l) => pageKeyOf(l.href)) : []);
  const htmlLinks = (html: string, base: string): string[] =>
    [...new Set([...detailLinkSet(collectPageLinks(html, base), o.detailRe), ...embeddedEntityUrls(html, base).filter(matches)])]
      .filter((u) => !onSearchPage.has(pageKeyOf(u)));

  let lastCalls: string[] = [];
  // Fix (script-only form results, 2026-10-08): a form whose result page is script-only with no
  // profile links is not submitted again; later values are typed in the browser straight away
  // (elliman.com dry run 2651 spent its search time on a rendered form result, 1 value tried).
  const shellForms = new Set<SearchInput>();
  const tryValue = async (box: SearchInput, value: string, allowBrowser = true): Promise<Hit | null> => {
    lastCalls = [];
    // 1) a real form is submitted directly (fast, no browser)
    if (box.form && !shellForms.has(box) && left() > 25_000) {
      const fields = { ...box.form.fields, [box.form.inputName]: value };
      if (box.form.method === 'GET') {
        const u = new URL(box.form.action);
        for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, v);
        const r = await withTimeout(fetchPage(u.toString(), o.crawlMethod).catch(() => miss(u.toString())), Math.min(40_000, left() - 5_000), miss(u.toString()));
        const urls = r.ok ? htmlLinks(r.body, r.url) : [];
        if (r.ok && !urls.length && isEmptyShell(r.body)) { shellForms.add(box); lastCalls = ['form result is script-only; typing in the browser']; }
        if (urls.length >= 3) {
          const tpl = new URL(box.form.action);
          for (const [k, v] of Object.entries(fields)) tpl.searchParams.set(k, k === box.form.inputName ? '__VALUE__' : v);
          return { how: 'form_get', urls, stated: statedTotalInText(r.body, o.categoryWords)?.total ?? null, request: { method: 'GET', url: tpl.toString().replace('__VALUE__', '{value}'), body: null, value_at: `query:${box.form.inputName}` }, path: null, template: null, html: r.body, finalUrl: r.url };
        }
      } else {
        const body = new URLSearchParams(fields).toString();
        const r = await fetchApiCall({ url: box.form.action, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, crawl_method: o.crawlMethod, timeoutMs: Math.min(40_000, left() - 5_000) });
        const urls = r.ok && r.content ? htmlLinks(r.content, box.form.action) : [];
        if (r.ok && !urls.length && isEmptyShell(r.content ?? '')) { shellForms.add(box); lastCalls = ['form result is script-only; typing in the browser']; }
        if (urls.length >= 3) {
          const tplBody = new URLSearchParams({ ...fields, [box.form.inputName]: '__VALUE__' }).toString().replace('__VALUE__', '{value}');
          return { how: 'form_post', urls, stated: r.content ? statedTotalInText(r.content, o.categoryWords)?.total ?? null : null, request: { method: 'POST', url: box.form.action, body: tplBody, value_at: `form:${box.form.inputName}` }, path: null, template: null, html: r.content ?? '', finalUrl: box.form.action };
        }
      }
    }
    // 2) typed into the box in the browser; the background calls carry the results. One browser try
    // per value (first written format only); other formats are tried on real forms only.
    if (!allowBrowser || left() < 35_000) return null;
    const cap = await captureNetworkCalls(o.pageUrl, { timeoutMs: Math.min(60_000, left() - 5_000), typeInput: { xpath: box.inputXpath, value, submitXpath: box.submitXpath } });
    if (!cap.ok) { lastCalls = [`capture failed: ${cap.error ?? ''}`.slice(0, 120)]; return null; }
    let best: Hit | null = null;
    for (const c of normalizeCapturedCalls(cap.content)) {
      if (noiseReason(c.url)) continue;
      if (lastCalls.length < 6) lastCalls.push(endpointKey(c));
      if (c.status_code != null && (c.status_code < 200 || c.status_code >= 300)) continue;
      const json = parseJsonLoose(c.response_body);
      if (json === undefined) continue;
      let urls = profileUrlsInJson(json, o.pageUrl, matches).urls.filter((u) => !onSearchPage.has(pageKeyOf(u)));
      let path: string | null = null;
      let template: string | null = null;
      if (urls.length < 3) {
        const rec = recordTemplateHits(json, o.knownProfiles, matches);
        if (rec) { urls = rec.urls; path = rec.array_path; template = rec.label; }
      }
      if (urls.length < 3 || (best && best.urls.length >= urls.length)) continue;
      // which request field carries the typed value
      const p = callParams(c).find((f) => typeof f.value === 'string' && String(f.value).toLowerCase().includes(value.toLowerCase()));
      const valueAt = p ? `${p.ref.where}:${p.ref.param ? `${p.ref.param}.` : ''}${p.ref.path.join('.')}` : null;
      best = {
        how: 'browser_call',
        urls,
        stated: totalsInJson(json, urls.length).total,
        request: { method: c.method, url: c.url, body: c.request_payload, value_at: valueAt, headers: replayHeaders(c.request_headers) },
        path,
        template,
      };
    }
    return best;
  };

  const kindOrder: SearchKind[] = ['zip', 'city', 'name'];
  // Fix (next box sooner, 2026-10-08): a box whose first two values return no profiles is left for
  // the next box (elliman.com dry run 2656 spent 173 s on 5 values in the first-name box and never
  // reached the city box).
  boxLoop: for (const box of o.boxes.slice(0, 3)) {
    let boxMisses = 0;
    for (const kind of kindOrder.filter((k) => box.kinds.includes(k))) {
      const lists = searchValues(kind, vals.cities, vals.letters, vals.bigrams);
      let first: { hit: Hit; value: string; format: number } | null = null;
      let formatIdx = -1;
      for (const variants of lists.slice(0, 3)) {
        if (left() < 25_000) break;
        let got: { hit: Hit; value: string; format: number } | null = null;
        const order: string[] = first ? [variants[formatIdx] ?? variants[0]] : variants;
        for (const [vi, v] of order.entries()) {
          if (left() < 25_000) break;
          if (vi > 0 && (!box.form || shellForms.has(box))) break; // typed boxes: first format only
          const hit = await tryValue(box, v, vi === 0);
          const fresh = hit ? hit.urls.filter((u) => !(first?.hit.urls ?? []).includes(u)).length : 0;
          attempts.push({ kind, value: v, how: hit?.how ?? 'no profiles', profiles: hit?.urls.length ?? 0, fresh, stated: hit?.stated ?? null, ...(lastCalls.length ? { calls: lastCalls } : {}) });
          if (hit) { got = { hit, value: v, format: first ? formatIdx : vi }; break; }
        }
        if (!got) {
          if (!first && ++boxMisses >= 2) continue boxLoop;
          continue;
        }
        if (!first) { first = got; formatIdx = got.format; continue; }
        const fresh = got.hit.urls.filter((u) => !first!.hit.urls.includes(u));
        if (fresh.length < 3) continue;
        // proven: two values return different profiles. Paging inside the results (form GET): the
        // results page's own next link, fetched once when time allows.
        let nextPage: { template: string | null; new_profiles: number } | null = null;
        if (first.hit.how === 'form_get' && first.hit.html && first.hit.finalUrl && left() > 30_000) {
          const links = collectPageLinks(first.hit.html, first.hit.finalUrl);
          const nx = links.find((l) => /\bnext\b/.test(l.rel)) ?? links.find((l) => NAV_NEXT_TEXT.test(l.label));
          if (nx) {
            const r = await withTimeout(fetchPage(nx.href, o.crawlMethod).catch(() => miss(nx.href)), Math.min(30_000, left() - 5_000), miss(nx.href));
            const more = r.ok ? htmlLinks(r.body, r.url).filter((u) => !first!.hit.urls.includes(u)).length : 0;
            nextPage = { template: pageTemplate(nx.href, first.hit.finalUrl) ?? nx.href, new_profiles: more };
          }
        }
        const all = new Set([...first.hit.urls, ...got.hit.urls]);
        const formats = kind === 'zip' ? ['ZIP'] : kind === 'city' ? ['City, ST', 'City ST', 'City'] : ['initial', 'two-letter start'];
        return {
          status: 'proven',
          reason: `"${first.value}" returned ${first.hit.urls.length} profiles and "${got.value}" ${fresh.length} new`,
          ...head,
          attempts,
          route: {
            kind,
            format: formats[formatIdx] ?? formats[0],
            how: first.hit.how,
            request: first.hit.request,
            profile_links_at: first.hit.path,
            id_template: first.hit.template,
            inputs: {
              rule: kind === 'name'
                ? 'last-name starts in the order our professionals\' names use them'
                : `largest US cities (exp_us_cities by population)${kind === 'zip' ? ', most common ZIP among our professionals in each' : ''}`,
              tried: [first.value, got.value],
            },
            per_input: { profiles: [first.hit.urls.length, got.hit.urls.length], stated: [first.hit.stated, got.hit.stated] },
            next_page: nextPage,
          },
          reach_estimate: all.size,
          basis: `distinct profiles from the 2 values tried (lower bound; the harvest's input list decides the real reach)`,
          ms: Date.now() - started,
        };
      }
      if (first) {
        return { status: 'found_not_proven', reason: `"${first.value}" returned profiles but no second value returned new ones`, ...head, attempts, route: null, ms: Date.now() - started };
      }
    }
  }
  return { status: 'none_found', reason: attempts.length ? 'no search value returned profile links' : 'no value could be tried (time budget)', ...head, attempts, ms: Date.now() - started };
}

// ---- step 6 follow-up (2026-10-07): search supplies the first profile candidates --------------
// Sites whose directory is only a search box (no profile links, no usable sitemap) never reached a
// profile page, so no route step could run (wellsfargoadvisors.com dry run 1335: 0 candidates).
// When a run has no candidates at all, the directory page (else the homepage) search box is used
// once with the first value from our own data; the same-site links on the results page, or the
// same-site URLs in the background-call responses, become candidates and get the normal checks.
async function searchSeedCandidates(o: {
  db: any;
  pages: Array<{ html: string; url: string }>;
  siteRoot: string;
  crawlMethod: CrawlMethod;
  deadlineAt: number;
}): Promise<{ urls: string[]; report: Record<string, unknown> }> {
  const left = () => o.deadlineAt - Date.now();
  // Fix (search pages, 2026-10-08): boxes from every page given (directory page, linked
  // search / find / locator pages, homepage), at most 3; boxes labelled for one kind of value
  // (ZIP, city or name) come before catch-all site-search boxes, page order otherwise.
  const pairs: Array<{ page: { html: string; url: string }; box: SearchInput; i: number }> = [];
  for (const p of o.pages) for (const b of findSearchInputs(p.html, p.url)) pairs.push({ page: p, box: b, i: pairs.length });
  const catchAll = (b: SearchInput) => (b.kinds.length >= 3 ? 1 : 0);
  const picked = pairs.sort((x, y) => catchAll(x.box) - catchAll(y.box) || x.i - y.i).slice(0, 3);
  const pagesChecked = o.pages.map((p) => p.url);
  if (!picked.length) return { urls: [], report: { status: 'no search box', pages: pagesChecked } };
  const pageKey = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  const skip = new Set(o.pages.map((p) => pageKey(p.url)));
  const keep = (u: string) => {
    if (!isSameSite(u, o.siteRoot) || skip.has(pageKey(u))) return false;
    try { return new URL(u).pathname.split('/').filter(Boolean).length >= 1 && !/\.(xml|pdf|jpe?g|png|gif|svg|css|js)(\?|$)/i.test(u); } catch { return false; }
  };
  const vals = await loadSearchValues(o.db, new Set(picked.flatMap((x) => x.box.kinds)));
  const tries: Array<{ page: string; box: string; kind: SearchKind; value: string; how: string; links: number; calls?: string[] }> = [];
  const miss = (url: string): FetchResult => ({ ok: false, status: 0, body: '', url, networkError: 'time cap' });
  // Fix (results-page menu links, 2026-10-08): links already on the page holding the search box
  // (menus, footers) are not results (wellsfargoadvisors.com dry run 2653: the ZIP form's result page
  // gave 20 menu links - market articles, IRA and tax pages - taken as profile candidates).
  const menuLinks = new Map<string, Set<string>>();
  const onPage = (page: { html: string; url: string }) => {
    let set = menuLinks.get(page.url);
    if (!set) { set = new Set(collectPageLinks(page.html, page.url).map((l) => pageKey(l.href))); menuLinks.set(page.url, set); }
    return set;
  };
  for (const { page, box } of picked) {
    let formShell = false; // Fix (script-only form results, 2026-10-08)
    let boxMisses = 0; // Fix (next box sooner, 2026-10-08): two values with no results -> next box
    kindLoop: for (const kind of (['zip', 'city', 'name'] as SearchKind[]).filter((k) => box.kinds.includes(k))) {
      if (boxMisses >= 2) break kindLoop;
      boxMisses++;
      const variants = searchValues(kind, vals.cities, vals.letters, vals.bigrams)[0] ?? [];
      for (const value of variants) {
        if (left() < 20_000) return { urls: [], report: { status: 'time budget', pages: pagesChecked, tries } };
        if (box.form && !formShell) {
          const fields = { ...box.form.fields, [box.form.inputName]: value };
          let html = '';
          let base = box.form.action;
          if (box.form.method === 'GET') {
            const u = new URL(box.form.action);
            for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, v);
            const r = await withTimeout(fetchPage(u.toString(), o.crawlMethod).catch(() => miss(u.toString())), Math.min(40_000, left() - 5_000), miss(u.toString()));
            if (r.ok) { html = r.body; base = r.url; }
          } else {
            const r = await fetchApiCall({ url: box.form.action, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), crawl_method: o.crawlMethod, timeoutMs: Math.min(40_000, left() - 5_000) });
            if (r.ok && r.content) html = r.content;
          }
          const menu = onPage(page);
          const urls = html ? collectDetailUrls(html, base, LINK_CANDIDATE_CAP).filter((u) => keep(u) && !menu.has(pageKey(u))) : [];
          if (html && !urls.length && isEmptyShell(html)) formShell = true;
          tries.push({ page: page.url, box: box.label, kind, value, how: `form_${box.form.method.toLowerCase()}${formShell ? ' (script-only result)' : ''}`, links: urls.length });
          if (urls.length >= 3) return { urls, report: { status: 'candidates found', page: page.url, box: box.label, kind, value, how: `form_${box.form.method.toLowerCase()}`, pages: pagesChecked, tries } };
        }
        if (left() < 35_000) continue;
        const cap = await captureNetworkCalls(page.url, { timeoutMs: Math.min(60_000, left() - 5_000), typeInput: { xpath: box.inputXpath, value, submitXpath: box.submitXpath } });
        const found = new Set<string>();
        const seenCalls: string[] = [];
        if (cap.ok) {
          for (const c of normalizeCapturedCalls(cap.content)) {
            if (noiseReason(c.url)) continue;
            if (seenCalls.length < 6) seenCalls.push(endpointKey(c));
            const json = parseJsonLoose(c.response_body);
            if (json === undefined) continue;
            for (const u of profileUrlsInJson(json, page.url, (x) => keep(x) && !onPage(page).has(pageKey(x))).urls) found.add(u);
          }
        }
        tries.push({ page: page.url, box: box.label, kind, value, how: cap.ok ? 'browser_call' : `browser failed: ${cap.error ?? ''}`.slice(0, 120), links: found.size, calls: seenCalls });
        if (found.size >= 3) return { urls: [...found], report: { status: 'candidates found', page: page.url, box: box.label, kind, value, how: 'browser_call', pages: pagesChecked, tries } };
        break; // one browser try per kind
      }
    }
  }
  return { urls: [], report: { status: 'no candidates from search', pages: pagesChecked, tries } };
}

// ---- step 6 follow-up (2026-10-07): route search as a second call (dry runs) ------------------
// A run that ran out of time before the network-call / search routes returns routes_state (what
// that run proved: profile rule, directory and search pages, profile links seen, the static route
// and any stated total). A second dry-run request { dry_run, phase: 'routes', state } runs only the
// two route steps with its own 300 s. Read-only; the page check here has no AI step (a built link
// counts when the fetched page holds one entity tied to it, or matches the profile rule and is not
// a listing page).
type RoutesState = {
  domain: string;
  category: string;
  crawl_method: CrawlMethod;
  detail_pattern: string;
  person: boolean;
  count_words: string[];
  known_profiles: string[];
  network_page: string | null;
  scope: 'listing' | 'sub_listing';
  sub_listing_count: number;
  search_pages: string[];
  static: { route: string; reach: number; lower_bound: boolean; basis: string };
  stated_total: number | null;
};

async function runDeferredRoutes(st: RoutesState, opts: { forceNetwork?: boolean; forceSearch?: boolean }): Promise<Record<string, unknown>> {
  const started = Date.now();
  const deadline = started + 262_000;
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  let detailRe: RegExp;
  try { detailRe = new RegExp(st.detail_pattern); } catch { return { error: 'bad detail_pattern' }; }
  const matches = (u: string) => { try { return detailRe.test(u); } catch { return false; } };
  const home = await withTimeout(fetchPage(`https://${st.domain}/`, st.crawl_method).catch(() => null), 45_000, null);
  const siteEntityNames = home?.ok ? collectSiteEntityNames(home.body) : new Set<string>();
  const judge = async (url: string): Promise<{ ok: boolean; reason: string }> => {
    const r = await withTimeout(fetchPage(url, st.crawl_method).catch(() => null), 30_000, null);
    if (!r || pageDidNotLoad(r)) return { ok: false, reason: 'did not load' };
    const ev = pageEntityEvidence(r.body, r.url, siteEntityNames, st.person ? 'person' : 'location');
    if (ev.kind === 'listing') return { ok: false, reason: 'listing page' };
    if (ev.kind === 'profile') return { ok: true, reason: 'one entity tied to the page' };
    return matches(r.url) ? { ok: true, reason: 'loads, matches the profile rule, not a listing' } : { ok: false, reason: `redirected to ${r.url}` };
  };
  const cov = needsMoreRoutes(st.static.reach, st.static.lower_bound, st.stated_total);
  const network: NetworkRouteReport =
    !st.network_page ? { status: 'skipped', reason: 'no directory page' }
    : !opts.forceNetwork && !cov.more ? { status: 'skipped', reason: `not needed: ${cov.why}` }
    : await withTimeout(
        learnNetworkRoute({
          pageUrl: st.network_page, scope: st.scope, subListingCount: st.sub_listing_count, matches, knownProfiles: st.known_profiles,
          crawlMethod: st.crawl_method, deadlineAt: deadline - 90_000, judge, forced: !!opts.forceNetwork && !cov.more, triggerWhy: cov.why,
        }).catch((e) => ({ status: 'error', reason: String(e).slice(0, 200) } as NetworkRouteReport)),
        Math.max(1_000, deadline - 90_000 - Date.now()),
        { status: 'skipped', reason: 'time budget (did not finish in time)' } as NetworkRouteReport,
      );
  const networkReach = network.status === 'proven' ? network.reach_estimate ?? 0 : 0;
  const stated = Math.max(st.stated_total ?? 0, network.route?.total ?? 0) || null;
  const cov2 = needsMoreRoutes(Math.max(st.static.reach, networkReach), networkReach <= st.static.reach && st.static.lower_bound, stated);
  let boxes: SearchInput[] = [];
  let searchPage: string | null = null;
  let searchHtml = '';
  for (const u of st.search_pages) {
    if (Date.now() > deadline - 60_000) break;
    const r = await withTimeout(fetchPage(u, st.crawl_method).catch(() => null), 30_000, null);
    if (r?.ok) { boxes = findSearchInputs(r.body, r.url); if (boxes.length) { searchPage = r.url; searchHtml = r.body; break; } }
  }
  const search: SearchRouteReport =
    !boxes.length || !searchPage ? { status: 'skipped', reason: 'no search box on the directory page or homepage' }
    : !opts.forceSearch && !cov2.more ? { status: 'skipped', reason: `not needed: ${cov2.why}` }
    : await withTimeout(
        learnSearchRoute({
          db, pageUrl: searchPage, pageHtml: searchHtml, boxes, detailRe, knownProfiles: st.known_profiles, categoryWords: st.count_words,
          crawlMethod: st.crawl_method, deadlineAt: deadline,
          trigger: opts.forceSearch && !cov2.more ? `forced (dry run); ${cov2.why}` : cov2.why,
        }).catch((e) => ({ status: 'error', reason: String(e).slice(0, 200) } as SearchRouteReport)),
        Math.max(1_000, deadline - Date.now()),
        { status: 'skipped', reason: 'time budget (did not finish in time)' } as SearchRouteReport,
      );
  const searchReach = search.status === 'proven' ? search.reach_estimate ?? 0 : 0;
  const best =
    searchReach > Math.max(st.static.reach, networkReach) ? { route: 'search_input', reach_estimate: searchReach, basis: `search inputs: ${search.basis ?? ''}`, search_input: search.route }
    : networkReach > st.static.reach ? { route: 'network_call', reach_estimate: networkReach, basis: `network call: ${network.basis ?? ''}`, network_call: network.route }
    : { route: st.static.route, reach_estimate: st.static.reach, basis: st.static.basis };
  return { network_calls: network, search_inputs: search, best_route: best, run_ms: Date.now() - started };
}

// Fix (report before the limit, 2026-10-08): a map run is stopped at MAP_RUN_LIMIT_MS and returns
// what it learned so far (as a MapSiteError with `stopped` and `progress`), instead of being cut off by
// the worker's 300 s limit with nothing (wellsfargoadvisors.com dry run 2647).
const MAP_RUN_LIMIT_MS = 285_000;
async function mapSiteWithLimit(
  apiKey: string,
  model: string,
  category: string,
  domain: string,
  boundary: Boundary | undefined,
  crawlMethod: CrawlMethod,
  opts?: { forceNetwork?: boolean; forceSearch?: boolean; profileUrls?: string[]; limitMs?: number; v2Led?: { pattern: string | null } },
): Promise<Record<string, unknown>> {
  const progress: Record<string, unknown> = {};
  // Fix (map in steps, 2026-10-14): the live map's version 1 step passes a shorter limit (V1_STEP_LIMIT_MS) so the
  // save check and save that follow it still finish inside the worker call; dry runs keep MAP_RUN_LIMIT_MS.
  const limitMs = opts?.limitMs ?? MAP_RUN_LIMIT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new MapSiteError(`run stopped at ${limitMs / 1000} s, before the worker limit (last step: ${String(progress.step ?? 'start')})`, { stopped: true, progress })),
      limitMs,
    );
  });
  try {
    const { limitMs: _limit, ...mapOpts } = opts ?? {};
    return await Promise.race([mapSite(apiKey, model, category, domain, boundary, crawlMethod, undefined, { ...mapOpts, progress }), stop]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- G1 (one mapper behind Map, 2026-10-13) --------------------------------------------
// Map runs site mapper version 2 first: it finds and proves where the site lists its profiles (sitemaps,
// listing pages or the site's own search API) and returns sample profile pages spread over the site's
// sections. Version 1's field learner then reads those pages (the same profile_urls path the dry runs
// use). The contract keeps version 1's fields and gains `site_contract.list_route` (version 2's sources,
// estimate, coverage); version 2's sitemaps are recorded as profile_sitemaps so Run seeds from them, and
// version 2's profile pattern replaces version 1's when version 1's does not match 90% of the samples.
// Version 2 failing or not finishing in one call = version 1 alone, exactly as before. Nothing here
// writes; saving stays with the normal save path.
const V2_CALL_MS = 480_000;              // version 2 research, one call (dry runs); version 1 then has MAP_RUN_LIMIT_MS
const V1_STEP_LIMIT_MS = 255_000;        // live map, version 1 step: leaves time for the save check and save inside a 300 s call
const V2_HARVESTABLE = new Set(['sitemap', 'listing', 'link_crawl', 'autocomplete']); // G3: the list worker reads listing / API / hub / type-ahead routes
function v2Summary(v2: V2Research | null): Record<string, unknown> | null {
  if (!v2) return null;
  return {
    outcome: v2.outcome, reason: v2.reason, error: v2.error, cost_usd: v2.cost_usd, active_seconds: v2.active_seconds,
    profile_urls_given: v2.profile_urls.length, sample_pool: v2.sample_pool, coverage: v2.coverage, flags: v2.flags,
    sources: v2.config?.sources?.map((x: any) => ({ name: x?.name ?? null, type: x?.type ?? null })) ?? null,
    estimate: v2.config?.estimate ?? null, log: v2.log.slice(-15),
  };
}
function applyV2(contract: Record<string, any>, v2: V2Research): void {
  const cfg = v2.config;
  if (!cfg) return;
  const extraction = (contract.extraction ??= {});
  const sc = (extraction.site_contract ??= {});
  const sources: any[] = Array.isArray(cfg.sources) ? cfg.sources : [];
  // Fix (sitemap filters, 2026-10-14): a sitemap source with an include filter (child sitemaps of an index, e.g.
  // sitemap-agent[0-9]+.xml) adds only its resolved matching shards (resolveSitemapIncludes), never the root index:
  // Run walks profile_sitemaps without the filter and would read every listing shard (bhhs.com proposal 136).
  const sitemaps = [...new Set(sources.filter((x) => x?.type === 'sitemap')
    .flatMap((x) => (x?.include ? (Array.isArray(x?.resolved_sitemaps) ? x.resolved_sitemaps : []) : (Array.isArray(x?.sitemaps) ? x.sitemaps : [])))
    .filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)))];
  const harvestable = sources.length > 0 && sources.every((x) => V2_HARVESTABLE.has(String(x?.type)));
  let patternFrom: 'v1' | 'v2' = 'v1';
  const v1Pattern = typeof contract.detail_pattern === 'string' ? contract.detail_pattern : '';
  let v2Re: RegExp | null = null;
  try { v2Re = typeof cfg.profile_url_pattern === 'string' && cfg.profile_url_pattern ? new RegExp(cfg.profile_url_pattern) : null; } catch { v2Re = null; }
  if (v2Re && v2.profile_urls.length) {
    let v1Re: RegExp | null = null;
    try { v1Re = v1Pattern ? new RegExp(v1Pattern) : null; } catch { v1Re = null; }
    const hit = v1Re ? v2.profile_urls.filter((u) => v1Re!.test(u)).length / v2.profile_urls.length : 0;
    if (hit < 0.9) { contract.detail_pattern = cfg.profile_url_pattern; patternFrom = 'v2'; }
  }
  if (contract.route_report?.fields_only?.v2_pattern_used) patternFrom = 'v2';
  if (sitemaps.length) {
    const prev = Array.isArray(contract.profile_sitemaps) ? contract.profile_sitemaps : [];
    contract.profile_sitemaps = [...new Set([...sitemaps, ...prev])];
  }
  // Fix (fields only after version 2, 2026-10-14): when version 1 measured no route of its own (it learned fields
  // only), the best route and its reach come from version 2's list route (its measured estimate), so the save
  // rule and the panel still have a reach figure.
  const br = extraction.best_route;
  const v2Reach = Number(cfg.estimate?.expected_profiles ?? 0) || 0;
  // A fields-only version 1 run counts only version 2's handed-over pages as "sitemap" URLs (remax.com dry run 64544:
  // reach 9), so its best route is always replaced by version 2's.
  const fieldsOnly = !!contract.route_report?.fields_only?.v2_led;
  if ((fieldsOnly || !br || br.route === 'none' || !(Number(br.reach_estimate) > 0)) && v2Reach > 0) {
    extraction.best_route = { route: String(sources[0]?.type ?? 'sitemap'), reach_estimate: v2Reach,
      basis: `version 2 list route: ${String(cfg.estimate?.basis ?? '').slice(0, 300)}`, from: 'v2' };
  }
  sc.list_route = {
    version: 2, learned_at: new Date().toISOString(), summary: cfg.summary ?? null, start_url: cfg.start_url ?? null,
    profile_url_pattern: cfg.profile_url_pattern ?? null, detail_pattern_from: patternFrom, v1_detail_pattern: v1Pattern || null,
    sources, estimate: cfg.estimate ?? null, coverage: v2.coverage, coverage_justification: v2.coverage_justification,
    render: cfg.render ?? false, harvestable, harvest_note: harvestable ? null : 'a source type the harvest cannot read',
    cost_usd: v2.cost_usd, flags: v2.flags ?? null,
  };
}
// Fix (sitemap filters, 2026-10-14): resolves version 2 sitemap sources that carry an include filter to the
// matching child sitemaps of their index (at most 50), stored as source.resolved_sitemaps. Plain fetch, no AI.
async function resolveSitemapIncludes(v2: V2Research | null): Promise<void> {
  const sources: any[] = Array.isArray(v2?.config?.sources) ? v2!.config.sources : [];
  for (const src of sources) {
    if (src?.type !== 'sitemap' || !src.include || !Array.isArray(src.sitemaps)) continue;
    let re: RegExp;
    try { re = new RegExp(src.include); } catch { continue; }
    const found: string[] = [];
    for (const root of src.sitemaps.slice(0, 5)) {
      if (typeof root !== 'string') continue;
      const r = await withTimeout(fetchPage(root, 'server_crawl').catch(() => null), 30_000, null);
      if (!r?.ok || !r.body) continue;
      if (/<sitemapindex/i.test(r.body.slice(0, 3000))) {
        for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) { const u = m[1].replace(/&amp;/g, '&'); if (re.test(u) && !found.includes(u)) found.push(u); }
      } else if (re.test(root)) found.push(root);
    }
    src.resolved_sitemaps = found.slice(0, 50);
  }
}

// Fix (combine list routes, 2026-10-14): a remap keeps the saved contract's proven list sources and adds the new
// run's sources (duplicates removed), so a remap never swaps a larger proven route for a smaller one (bhhs.com:
// saved agent-search API about 38,000 profiles, remap 156 found only the agent sitemaps, about 14,000). The
// expected count is the larger measured estimate; profile_sitemaps are combined; best_route keeps the larger reach.
// Each profile URL is queued once, so combining adds list calls only. Runs before the save check.
async function mergeSavedListRoute(db: any, domain: string, category: string, contract: Record<string, any>): Promise<void> {
  const { data: row } = await db.from('disco_site_contract').select('profile_sitemaps, extraction')
    .eq('domain', domain.toLowerCase()).eq('category_slug', category).maybeSingle();
  const savedLr = row?.extraction?.site_contract?.list_route;
  if (!savedLr || !Array.isArray(savedLr.sources) || !savedLr.sources.length) return;
  const extraction = (contract.extraction ??= {});
  const sc = (extraction.site_contract ??= {});
  const keyOf = (x: any) => JSON.stringify({ t: x?.type, u: x?.listing?.request?.url ?? null, b: x?.listing?.request?.body ?? null,
    s: x?.sitemaps ?? null, i: x?.include ?? null, p: x?.items?.path ?? null, a: x?.start_urls ?? null });
  const lr = sc.list_route;
  if (!lr || !Array.isArray(lr.sources)) {
    sc.list_route = { ...savedLr, carried_from_saved: true };
  } else {
    const have = new Set(lr.sources.map(keyOf));
    const added = savedLr.sources.filter((x: any) => !have.has(keyOf(x)));
    if (added.length) {
      const nNew = Number(lr.estimate?.expected_profiles ?? 0) || 0;
      const nSaved = Number(savedLr.estimate?.expected_profiles ?? 0) || 0;
      sc.list_route = {
        ...lr,
        sources: [...lr.sources, ...added],
        estimate: nSaved > nNew ? savedLr.estimate : lr.estimate,
        estimates: { new: lr.estimate ?? null, saved: savedLr.estimate ?? null },
        harvestable: [...lr.sources, ...added].every((x: any) => V2_HARVESTABLE.has(String(x?.type))),
        combined_with_saved: { sources_added: added.length, saved_learned_at: savedLr.learned_at ?? null },
      };
    }
  }
  const savedSm: string[] = Array.isArray(row?.profile_sitemaps) ? row.profile_sitemaps : [];
  if (savedSm.length) contract.profile_sitemaps = [...new Set([...(Array.isArray(contract.profile_sitemaps) ? contract.profile_sitemaps : []), ...savedSm])];
  const savedBr = row?.extraction?.best_route;
  if (savedBr && Number(savedBr.reach_estimate) > Number(extraction.best_route?.reach_estimate ?? 0)) {
    extraction.best_route = { ...savedBr, basis: `combined list route; larger reach from the saved contract: ${String(savedBr.basis ?? '').slice(0, 200)}` };
  }
}

// ---- Detail route (2026-10-14): the richest per-profile source -------------------------------
// After version 2 has proven the list route, one map step checks for the site's own profile API (one call per
// profile, proven by replay on 3 profiles, see -disco-detail-api.ts) and learns a JSON field map from up to 20
// profiles. The version 1 step then compares measured field counts and records site_contract.detail_route:
// record_source 'api' (the API has the required fields and at least as many fields as the page), 'api+page'
// (the page adds fields) or 'page' (no usable profile API). Harvest from the API is a later step; until then the
// harvest keeps reading profile pages. Writes nothing itself.
const DETAIL_STEP_MS = 230_000;
async function runDetailRoute(apiKey: string, model: string, category: string, domain: string, profileUrls: string[]): Promise<DetailRouteResult> {
  const started = Date.now();
  try {
    const probe = await probeDetailApi({ domain, profileUrls, deadlineAt: started + 150_000 });
    if (probe.status !== 'proven' || !probe.api) return { probe, ms: Date.now() - started };
    const api = probe.api;
    const urls = [...new Set([...probe.proven_on.map((c) => c.profile_url), ...profileUrls])].slice(0, 20);
    const items: Array<{ profile_url: string; json: unknown }> = [];
    for (let i = 0; i < urls.length && Date.now() < started + 185_000; i += 6) {
      const batch = urls.slice(i, i + 6);
      const got = await Promise.all(batch.map(async (u) => ({ profile_url: u, json: await fetchDetailJson(api, u, Math.max(5_000, Math.min(25_000, started + 190_000 - Date.now()))) })));
      items.push(...got.filter((x) => x.json !== undefined));
    }
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { data: catRow } = await db.from('gbp_categories').select('entity_type').eq('gcid', category).maybeSingle();
    const primary: PrimarySubject = (catRow as any)?.entity_type === 'location' ? 'location' : 'person';
    const json = await withTimeout(
      learnJsonFields({
        items, fieldIds: allFieldIds(primary), meanings: FIELD_MEANINGS,
        ask: (prompt) => callClaudeMap(apiKey, model, prompt, JSON_FIELDS_TOOL, 2048),
        mustHave: (v) => recordMustHave(v, primary, null).ok,
      }).catch(() => undefined),
      Math.max(5_000, started + DETAIL_STEP_MS - Date.now()), undefined,
    );
    return { probe, json, ms: Date.now() - started, ...(json ? {} : { error: 'JSON field map not learned in time' }) };
  } catch (e) {
    return { probe: { status: 'error', reason: String((e as Error)?.message ?? e).slice(0, 200), proven_on: [], checked: [], captures: 0, ms: Date.now() - started }, error: String(e).slice(0, 200), ms: Date.now() - started };
  }
}
function attachDetailRoute(contract: Record<string, any>, detail: DetailRouteResult | null | undefined): void {
  if (!detail?.probe) return;
  const extraction = (contract.extraction ??= {});
  const sc = (extraction.site_contract ??= {});
  const perPage: number[] = Array.isArray(contract.site_contract_summary?.field_floor_per_sample) ? contract.site_contract_summary.field_floor_per_sample : [];
  const sortedPage = [...perPage].sort((a, b) => a - b);
  const pageMedian = sortedPage.length ? sortedPage[Math.floor(sortedPage.length / 2)] : Number(contract.field_floor ?? 0);
  const api = detail.probe.status === 'proven' ? detail.probe.api ?? null : null;
  const j = detail.json;
  let source: 'api' | 'api+page' | 'page' = 'page';
  let reason: string;
  if (!api) reason = `no profile API: ${detail.probe.reason}`;
  else if (!j || !Object.keys(j.fields).length) reason = `profile API proven but no field could be mapped${detail.error ? ` (${detail.error})` : ''}`;
  else if (j.must_have_share < 0.8) reason = `profile API has the required fields on ${Math.round(j.must_have_share * 100)}% of ${j.items} profiles (under 80%)`;
  else {
    // Fix (API plus page when the page adds fields, 2026-10-15): comparing field counts alone chose 'api' for bhhs.com
    // (API median 18, page 9) although its 8 office fields exist only on the page, so API records had no office data.
    // The page's own rules (not copies of other fields) with a value on at least 2 sample pages — the same 2-profile
    // rule the JSON field map keeps — that the JSON map does not cover make the source 'api+page'.
    const jsonIds = new Set(Object.keys(j.fields));
    const pageOnly = Object.entries((sc.fields ?? {}) as Record<string, any>)
      .filter(([id, f]) => !jsonIds.has(id) && !id.startsWith('extra.') && f?.locator?.tier !== 'alias' && Number(f?.hits ?? 0) >= 2)
      .map(([id]) => id);
    if (j.median >= pageMedian && !pageOnly.length) { source = 'api'; reason = `profile API median ${j.median} fields, page median ${pageMedian}`; }
    else {
      source = 'api+page';
      reason = `profile API median ${j.median} fields, page median ${pageMedian}: the page adds ${pageOnly.length ? `${pageOnly.length} field(s) the API lacks (${pageOnly.slice(0, 12).join(', ')})` : 'fields'}`;
    }
  }
  const sampleText = j?.sample !== undefined ? JSON.stringify(j.sample) : '';
  sc.detail_route = {
    record_source: source, reason, api, json_fields: j?.fields ?? null,
    measured: { json_median: j?.median ?? null, json_per_item: j?.per_item ?? null, page_median: pageMedian, page_per_sample: perPage, must_have_share: j?.must_have_share ?? null, items: j?.items ?? 0 },
    fill_rate: j?.fill ?? null, dropped: (j?.dropped ?? []).slice(0, 20), json_sample: sampleText && sampleText.length <= 4_000 ? j!.sample : null,
    probe: { status: detail.probe.status, reason: detail.probe.reason, proven_on: detail.probe.proven_on, checked: detail.probe.checked.slice(0, 15), captures: detail.probe.captures, ms: detail.probe.ms },
    learned_at: new Date().toISOString(),
  };
}
async function mapWithV2(
  apiKey: string, model: string, category: string, domain: string, boundary: Boundary | undefined, crawlMethod: CrawlMethod,
  opts: { v1Only?: boolean; startUrl?: string; profileUrls?: string[]; forceNetwork?: boolean; forceSearch?: boolean; v2?: V2Research | null; v1LimitMs?: number; detail?: DetailRouteResult | null },
): Promise<{ contract: Record<string, unknown>; v2: V2Research | null }> {
  // Fix (map in steps, 2026-10-14): the live map passes the version 2 result its earlier steps produced (opts.v2), so
  // this call only runs version 1 field learning; dry runs still run version 2 here in one call.
  let v2: V2Research | null = opts.v2 ?? null;
  const given = (opts.profileUrls ?? []).filter((u) => typeof u === 'string');
  if (!opts.v1Only && !given.length && opts.v2 === undefined) {
    try {
      const budget = Number(process.env['DISCO_V2_BUDGET'] ?? 3) || 3;
      v2 = await runV2Research(apiKey, { domain, category, start_url: opts.startUrl, budget, callMs: V2_CALL_MS });
    } catch (e) {
      v2 = { outcome: 'failed', reason: null, config: null, profile_urls: [], sample_pool: 0, cost_usd: 0, active_seconds: 0, coverage: {}, coverage_justification: null, flags: null, error: String((e as Error)?.message ?? e).slice(0, 300), log: [] };
    }
  }
  const profileUrls = given.length ? given : v2?.config ? v2.profile_urls : [];
  try {
    // Fix (fields only after version 2, 2026-10-14): a finished version 2 with profile pages leads; version 1 learns fields only.
    const v2Led = v2?.config && v2.profile_urls.length && !given.length ? { pattern: typeof v2.config.profile_url_pattern === 'string' ? v2.config.profile_url_pattern : null } : undefined;
    const contract = await mapSiteWithLimit(apiKey, model, category, domain, boundary, crawlMethod,
      { forceNetwork: opts.forceNetwork, forceSearch: opts.forceSearch, profileUrls, limitMs: opts.v1LimitMs, v2Led });
    if (v2?.config && contract.outcome !== 'no_profiles_on_site') { await resolveSitemapIncludes(v2); applyV2(contract as Record<string, any>, v2); }
    if (opts.detail && contract.outcome !== 'no_profiles_on_site') attachDetailRoute(contract as Record<string, any>, opts.detail);
    if (v2) (contract as any).v2_research = v2Summary(v2);
    return { contract, v2 };
  } catch (e) {
    // Fix (API-built contract, 2026-10-15): when version 1 cannot learn the fields from the page (elliman.com request
    // 162: the page holds only the name; contact details load from the site's API) but the site's own profile API is
    // proven and its JSON field map has the required fields on 80%+ of profiles, the contract is built from the
    // profile API: version 2's list route and profile pattern, the JSON field map (record_source 'api'), no page rules.
    const built = v2?.config ? apiBuiltContract(category, v2, opts.detail ?? null, e) : null;
    if (built) {
      applyV2(built, v2!);
      attachDetailRoute(built, opts.detail ?? null);
      built.v2_research = v2Summary(v2);
      return { contract: built, v2 };
    }
    if (v2 && e && typeof e === 'object') (e as any).diagnostics = { ...((e as any).diagnostics ?? {}), v2_research: v2Summary(v2) };
    throw e;
  }
}
function apiBuiltContract(_category: string, v2: V2Research, detail: DetailRouteResult | null, err: unknown): Record<string, any> | null {
  const j = detail?.json;
  const pattern = typeof v2.config?.profile_url_pattern === 'string' ? v2.config.profile_url_pattern : null;
  if (!pattern || detail?.probe?.status !== 'proven' || !detail.probe.api || !j) return null;
  if (j.must_have_share < 0.8 || Object.keys(j.fields).length < 5 || j.median < 5) return null;
  const primary: PrimarySubject = Object.keys(j.fields).some((id) => id.startsWith('person.')) ? 'person' : 'location';
  const learnedAt = new Date().toISOString();
  return {
    roster_pattern: null,
    detail_pattern: pattern,
    field_floor: j.median,
    detail_entity_type: primary === 'person' ? 'professional' : 'location',
    extraction: {
      list_source: 'none',
      site_contract: {
        version: 3, primary_subject: primary, fields: {}, must_have: { required: ['name', 'phone|email', 'city', 'state'], ok: true, missing: [] },
        address_owner: null, unmapped: [], unkeyed: [], samples: v2.profile_urls.slice(0, 10), learned_at: learnedAt,
        site_entity_names: [], built_from: 'profile_api',
      },
      best_route: { route: 'none', reach_estimate: 0, basis: 'version 1 did not run on the page' },
    },
    site_contract_summary: {
      fields: 0, must_have_ok: true, samples: j.items, field_floor_measured: j.median, field_floor_per_sample: j.per_item,
      built_from: 'profile_api', page_error: String((err as Error)?.message ?? err).slice(0, 300),
    },
    route_report: { fields_only: { v2_led: true, api_built: true, page_error: String((err as Error)?.message ?? err).slice(0, 300) } },
    sample_detail_url: v2.profile_urls[0] ?? null,
    profile_sitemaps: [],
  };
}

// ---- route-based plan step 4 (2026-10-07): save rule --------------------------------------
// Before a remap saves its contract, the saved contract is re-checked on the live site: up to 3
// of its sample pages are fetched and must load, match its detail_pattern and give its required
// fields. A broken saved contract (2 or more of 3 failing) is replaced. A working one is replaced
// only when the new contract is the same or better on every measure (required fields, field floor,
// best-route reach when both have one); otherwise the saved contract is kept.
type SaveCheck = {
  save: boolean;
  reason: string;
  saved: { field_floor: number | null; must_have_ok: boolean | null; reach: number | null } | null;
  fresh: { field_floor: number; must_have_ok: boolean; reach: number | null };
  live: Array<{ url: string; ok: boolean; why: string }>;
};

async function savedContractCheck(
  db: any,
  domain: string,
  category: string,
  fresh: Record<string, any>,
  crawlMethod: CrawlMethod,
): Promise<SaveCheck> {
  const freshSc = fresh?.extraction?.site_contract ?? {};
  const freshM = {
    field_floor: Number(fresh?.field_floor ?? 0),
    must_have_ok: freshSc?.must_have?.ok === true,
    reach: typeof fresh?.extraction?.best_route?.reach_estimate === 'number' ? fresh.extraction.best_route.reach_estimate : null,
  };
  const { data: row } = await db
    .from('disco_site_contract')
    .select('detail_pattern, field_floor, extraction')
    .eq('domain', domain.toLowerCase())
    .eq('category_slug', category)
    .maybeSingle();
  const savedSc = (row as any)?.extraction?.site_contract;
  if (!row || !(row as any).detail_pattern || !savedSc) {
    return { save: true, reason: 'no saved contract', saved: null, fresh: freshM, live: [] };
  }
  const savedM = {
    field_floor: (row as any).field_floor ?? null,
    must_have_ok: savedSc?.must_have?.ok ?? null,
    reach: typeof (row as any).extraction?.best_route?.reach_estimate === 'number' ? (row as any).extraction.best_route.reach_estimate : null,
  };
  let savedRe: RegExp | null = null;
  try { savedRe = new RegExp((row as any).detail_pattern); } catch { savedRe = null; }
  const urls: string[] = (Array.isArray(savedSc.samples) ? savedSc.samples : []).filter((u: unknown) => typeof u === 'string').slice(0, 3);
  const names = new Set<string>((savedSc.site_entity_names ?? []).map((n: string) => String(n).toLowerCase()));
  const firmSignatures = new Set<string>(savedSc.firm_signatures ?? []);
  const live = await Promise.all(urls.map(async (u) => {
    const r = await fetchPage(u, crawlMethod).catch(() => null);
    if (pageDidNotLoad(r) || !r) return { url: u, ok: false, why: `did not load (status ${r?.status ?? 0})` };
    if (savedRe && !savedRe.test(r.url) && !savedRe.test(u)) return { url: u, ok: false, why: `redirected to ${r.url}` };
    try {
      const { values } = applyContractS4(r.body, r.url, savedSc, names, { firmSignatures });
      const mh = recordMustHave(values, savedSc.primary_subject ?? 'person', savedSc.name_owner ?? null);
      return mh.ok ? { url: u, ok: true, why: 'works' } : { url: u, ok: false, why: `missing ${mh.missing.join(', ')}` };
    } catch (e) {
      return { url: u, ok: false, why: `check failed: ${String(e).slice(0, 80)}` };
    }
  }));
  const failed = live.filter((x) => !x.ok).length;
  if (!urls.length || failed >= 2) {
    return { save: true, reason: urls.length ? `saved contract no longer works (${failed} of ${live.length} sample pages fail)` : 'saved contract has no sample pages to re-check', saved: savedM, fresh: freshM, live };
  }
  const worse: string[] = [];
  if (savedM.must_have_ok === true && !freshM.must_have_ok) worse.push('required fields');
  if (savedM.field_floor != null && freshM.field_floor < savedM.field_floor) worse.push(`field floor ${freshM.field_floor} < ${savedM.field_floor}`);
  if (savedM.reach != null && freshM.reach != null && freshM.reach < savedM.reach) worse.push(`route reach ${freshM.reach} < ${savedM.reach}`);
  if (worse.length) return { save: false, reason: `saved contract still works and the new one is worse: ${worse.join('; ')}`, saved: savedM, fresh: freshM, live };
  return { save: true, reason: 'new contract is the same or better on every measure', saved: savedM, fresh: freshM, live };
}

const SITEMAP_MAX_TOP = 6; // top-level sitemaps fetched per run
const SITEMAP_MAX_CHILDREN = 3; // children sampled per sitemap index
const SITEMAP_MAX_DEPTH = 2; // index -> index -> urlset at most
const SITEMAP_MAX_FETCHES = 10; // hard cap on sitemap fetches per mapSite run
const SITEMAP_LOCS_READ = 500; // <loc> values read per sitemap document
const SITEMAP_CANDIDATE_CAP = 40; // same cap step 0 already used
const SITEMAP_NEGATIVE = [
  'video', 'image', 'news', 'blog', 'press', 'career', 'job', 'media', 'article',
  'disclosure', 'legal', 'privacy', 'terms', 'brochure',
];

type SitemapTraceEntry = {
  url: string;
  depth: number;
  kind: 'index' | 'urlset' | 'error';
  status: number;
  locs: number;
  sampled?: string[];
};

function cleanUrl(s: string): string {
  return s.replace(/[\r\n\t]/g, '').trim();
}

function isSameSite(url: string, domain: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    const d = domain.toLowerCase();
    return host === d || host.endsWith('.' + d);
  } catch {
    return false;
  }
}

function extractLocs(xml: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < max) {
    const u = cleanUrl(m[1]);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

// Token-based: URL pathname split on / - _ . ; a term scores +2 when its
// space-separated tokens appear as a contiguous run (a URL token matches when
// equal, or equal to the term token + "s"). −3 once for any negative word.
function sitemapRelevance(url: string, terms: string[]): number {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const toks = path.toLowerCase().split(/[\/\-_.]+/).filter(Boolean);
  const eq = (u: string, t: string) => u === t || u === t + 's';
  let score = 0;
  for (const t of terms) {
    const tt = t.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tt.length || tt.length > toks.length) continue;
    let hit = false;
    for (let i = 0; i + tt.length <= toks.length && !hit; i++) {
      hit = tt.every((x, j) => eq(toks[i + j], x));
    }
    if (hit) score += 2;
  }
  if (toks.some((u) => SITEMAP_NEGATIVE.some((w) => eq(u, w)))) score -= 3;
  return score;
}

const ROBOTS_MAX_SUBDOMAINS = 3; // subdomain robots.txt files read per mapSite run
const ROSTER_NEGATIVE = ['career', 'job', 'login', 'log in', 'sign in', 'recruit', 'press', 'news', 'investor relations', 'experienced professionals', 'students', 'graduates', 'internship', 'hiring', 'apply now', 'join our team', 'join us'];

// Host without a leading "www." — used as the site root for same-company checks.
function siteRootOf(url: string): string {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function textTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Relevance from the SUBDOMAIN part of a URL's host (e.g. "advisor" in
// advisor.example.com): +1 when any term's last word appears there (plural ok),
// −3 when a SITEMAP_NEGATIVE word does. 0 for the root host / www.
function hostRelevance(url: string, siteRoot: string, terms: string[]): number {
  let host = '';
  try { host = new URL(url).host.toLowerCase(); } catch { return 0; }
  if (!siteRoot || host === siteRoot || host === 'www.' + siteRoot) return 0;
  const sub = host.endsWith('.' + siteRoot) ? host.slice(0, -(siteRoot.length + 1)) : host;
  const toks = textTokens(sub);
  const eq = (u: string, t: string) => u === t || u === t + 's';
  if (toks.some((u) => SITEMAP_NEGATIVE.some((w) => eq(u, w)))) return -3;
  for (const t of terms) {
    const tt = textTokens(t);
    const last = tt[tt.length - 1];
    if (last && toks.some((u) => eq(u, last))) return 1;
  }
  return 0;
}

// Sitemap: lines from a robots.txt body.
function extractRobotsSitemaps(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (m) { const u = cleanUrl(m[1]); if (u && !out.includes(u)) out.push(u); }
  }
  return out;
}

// Every same-company link (same host or another subdomain of the same site root)
// scored as a roster candidate: +3 category-specific phrase (extraHints, from
// taxonomy), +1 generic ROSTER_HINTS phrase, −5 negative phrase. Sorted by score,
// then document order.
function normRosterText(s: string): string {
  return s.toLowerCase().replace(/(?:[-_\/.+?=&#]|%20)+/g, ' ');
}

function rankRosterLinks(
  html: string,
  base: string,
  extraHints: string[] = [],
): { href: string; text: string; score: number }[] {
  const root = siteRootOf(base);
  const out: { href: string; text: string; score: number; i: number }[] = [];
  const seen = new Set<string>();
  const extraN = extraHints.map(normRosterText);
  const hintsN = ROSTER_HINTS.map(normRosterText);
  const negN = ROSTER_NEGATIVE.map(normRosterText);
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const hm = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hm) continue;
    const abs = absolutize(hm[1], base);
    if (!abs || !/^https?:/.test(abs) || seen.has(abs)) continue;
    if (root && !isSameSite(abs, root)) continue;
    seen.add(abs);
    const inner = m[2]
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const aria = attrs.match(/\baria-label\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const title = attrs.match(/\btitle\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const label = [inner, aria, title].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const hay = normRosterText(`${label} ${abs}`);
    let score = 0;
    if (extraN.some((h) => hay.includes(h))) score += 3;
    if (hintsN.some((h) => hay.includes(h))) score += 1;
    if (negN.some((h) => hay.includes(h))) score -= 5;
    out.push({ href: abs, text: label.slice(0, 160), score, i: i++ });
  }
  return out.sort((a, b) => b.score - a.score || a.i - b.i).map(({ href, text, score }) => ({ href, text, score }));
}

// Host + first path segment + number of segments, e.g. "www.zillow.com/profile#2".
function hintShape(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    return `${u.host}/${(segs[0] ?? '').toLowerCase()}#${segs.length}`;
  } catch { return ''; }
}

// Fix (pattern coverage, 2026-10-05): the "parent" of a URL — host + every path segment
// except the last, plus depth ("www.compass.com/agents#2"). Pages with the same parent as
// the accepted profile page are the other candidates for that profile URL template.
function parentKey(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (!segs.length) return '';
    return `${u.host.toLowerCase()}/${segs.slice(0, -1).join('/').toLowerCase()}#${segs.length}`;
  } catch { return ''; }
}

// Share of `urls` a detail_pattern matches (invalid regex = 0).
function patternCoverage(pattern: unknown, urls: string[]): { matched: number; total: number; ratio: number; unmatched: string[] } {
  let re: RegExp | null = null;
  try { if (typeof pattern === 'string' && pattern) re = new RegExp(pattern); } catch { re = null; }
  const unmatched: string[] = [];
  let matched = 0;
  for (const u of urls) {
    if (re && re.test(u)) matched++;
    else unmatched.push(u);
  }
  return { matched, total: urls.length, ratio: urls.length ? matched / urls.length : 1, unmatched };
}

// Fix (code-built profile rule, 2026-10-06): the profile URL rule is built by code from the
// URLs this run actually saw (directory links, sitemap URLs, links on the profile page), not
// written by the AI from one example. Positions where the accepted profile's segment is shared
// by many URLs (or by all of them) stay fixed; the last segment and positions that vary become
// a character class covering every value seen. Value forms other than the accepted one
// (numeric ids, dotted names, other words) are returned so the caller can spot-check them by
// fetching; only forms that pass are added.
type UrlParts = { url: string; host: string; segs: string[] };
const RULE_FIX_MIN = 5;

function urlParts(u: string): UrlParts | null {
  try {
    const x = new URL(u);
    if (x.search) return null;
    return { url: u, host: x.host.toLowerCase(), segs: x.pathname.split('/').filter(Boolean) };
  } catch { return null; }
}

function valueForm(v: string): 'digits' | 'dotted' | 'word' {
  if (/^\d+$/.test(v)) return 'digits';
  if (v.includes('.')) return 'dotted';
  return 'word';
}

function charClassFor(values: string[], noDot: boolean): string {
  let lower = false, upper = false, digit = false, other = false;
  const punct = new Set<string>();
  for (const v of values) {
    for (const ch of v) {
      if (ch >= 'a' && ch <= 'z') lower = true;
      else if (ch >= 'A' && ch <= 'Z') upper = true;
      else if (ch >= '0' && ch <= '9') digit = true;
      else if ('-_.%+~,'.includes(ch)) punct.add(ch);
      else other = true;
    }
  }
  if (other) return noDot ? '[^/?#.]' : '[^/?#]';
  // Names and usernames: letters seen → digits allowed too (a later profile may carry one).
  if (lower || upper) digit = true;
  if (noDot) punct.delete('.');
  const parts = [lower ? 'a-z' : '', upper ? 'A-Z' : '', digit ? '0-9' : '',
    ...[...punct].filter((c) => c !== '-').map((c) => reEsc(c)), punct.has('-') ? '\\-' : ''];
  return `[${parts.join('')}]`;
}

type ProfileRule = {
  pattern: string | null;
  candidates: number;
  matched: number;
  thin: boolean;
  fixed: Array<string | null>;
  forms: Record<string, string[]>;
  otherForms: Array<{ pos: number; form: string; urls: string[] }>;
};

function buildProfileRule(
  acceptedUrl: string,
  poolUrls: string[],
  extraForms: Set<string> = new Set(),
  failedForms: Set<string> = new Set(),
): ProfileRule {
  const empty: ProfileRule = { pattern: null, candidates: 0, matched: 0, thin: true, fixed: [], forms: {}, otherForms: [] };
  const a = urlParts(acceptedUrl);
  if (!a || !a.segs.length) return empty;
  const bare = a.host.replace(/^www\./, '');
  const depth = a.segs.length;
  const seen = new Set<string>([a.url]);
  const cands: UrlParts[] = [a];
  for (const u of poolUrls) {
    if (seen.has(u)) continue;
    seen.add(u);
    const p = urlParts(u);
    if (p && p.host.replace(/^www\./, '') === bare && p.segs.length === depth) cands.push(p);
  }
  const thin = cands.length < RULE_FIX_MIN;
  let cur = cands;
  const fixed: Array<string | null> = [];
  for (let i = 0; i < depth; i++) {
    if (i === depth - 1) { fixed.push(null); continue; }
    const lit = a.segs.at(i) ?? '';
    const share = cur.filter((c) => c.segs.at(i) === lit).length;
    // Fix (section-like positions, 2026-10-07): a position whose values are a few repeated words
    // (site sections: profile, mortgage-rates, learn …) stays fixed to the profile's word even when
    // other sections outnumber it; it becomes variable only when most values are unique (names, ids).
    const distinct = new Set(cur.map((c) => c.segs.at(i))).size;
    const sectionLike = cur.length >= RULE_FIX_MIN && share >= 2 && distinct / cur.length < 0.5;
    const isFixed = (share >= RULE_FIX_MIN || share === cur.length || sectionLike) && !(thin && /\d/.test(lit));
    if (isFixed) { fixed.push(lit); cur = cur.filter((c) => c.segs.at(i) === lit); }
    else fixed.push(null);
  }
  const forms: Record<string, string[]> = {};
  const otherForms: ProfileRule['otherForms'] = [];
  const segRes: string[] = [];
  for (let i = 0; i < depth; i++) {
    const lit = fixed.at(i);
    if (lit != null) { segRes.push(reEsc(lit)); continue; }
    const accForm = valueForm(a.segs.at(i) ?? '');
    const groups = new Map<string, string[]>();
    for (const c of cur) {
      const f = valueForm(c.segs.at(i) ?? '');
      groups.set(f, [...(groups.get(f) ?? []), c.url]);
    }
    const included = new Set<string>([accForm]);
    for (const [f, urls] of groups) {
      if (f === accForm) continue;
      if (extraForms.has(`${i}:${f}`)) included.add(f);
      else if (urls.length >= 3) otherForms.push({ pos: i, form: f, urls });
    }
    forms[String(i)] = [...included];
    const values = cur.filter((c) => included.has(valueForm(c.segs.at(i) ?? ''))).map((c) => c.segs.at(i) ?? '');
    if (included.size === 1 && included.has('digits')) segRes.push('\\d+');
    else if (included.size === 1 && included.has('dotted')) {
      const cls = charClassFor(values, true);
      segRes.push(`${cls}+(?:\\.${cls}+)+`);
    } else {
      // A numeric-id form that failed its spot check stays out even though the class allows digits.
      const noDigits = failedForms.has(`${i}:digits`) && !included.has('digits') ? '(?!\\d+(?:/|$))' : '';
      segRes.push(`${noDigits}${charClassFor(values, false)}+`);
    }
  }
  const hosts = new Set(cur.map((c) => c.host));
  const hostRe = [...hosts].some((h) => h !== a.host) ? `(?:www\\.)?${reEsc(bare)}` : reEsc(a.host);
  const pattern = `^https?://${hostRe}/${segRes.join('/')}/?$`;
  let matched = 0;
  try { const re = new RegExp(pattern); matched = cands.filter((c) => re.test(c.url)).length; } catch { return empty; }
  return { pattern, candidates: cands.length, matched, thin, fixed, forms, otherForms };
}

// Fix (hard deadline, 2026-10-07): a step that has started must still finish inside the
// worker's 300 s limit; slow fetches and calls resolve to a fallback instead of running on.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), Math.max(0, ms)))]);
}

/** One rule for several URL forms of the same profile (e.g. a redirect from a shorter path). */
function combineRules(patterns: string[]): string | null {
  const uniq = [...new Set(patterns.filter(Boolean))];
  if (!uniq.length) return null;
  if (uniq.length === 1) return uniq.at(0) ?? null;
  return `^(?:${uniq.map((x) => x.replace(/^\^/, '').replace(/\$$/, '')).join('|')})$`;
}

// URL "shape" used to diversify candidates: host + one symbol per path segment
// (D = contains a dot, N = contains a digit, S = other).
function urlTemplate(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).map((s) => (s.includes('.') ? 'D' : /\d/.test(s) ? 'N' : 'S'));
    return `${u.host}/${segs.join('/')}`;
  } catch { return url; }
}

// A sitemap file that is one numbered shard of a set (sitemap.xml.0, sitemap-3.xml, sitemap2.xml).
function isShardSitemap(url: string): boolean {
  try { const p = new URL(url).pathname.toLowerCase(); return /\.xml\.\d+$/.test(p) || /\d+\.xml(\.gz)?$/.test(p); } catch { return false; }
}

// Deterministic post-check of the AI-emitted detail_pattern: it must test true
// on every URL we know IS a detail page and false on every URL we know is NOT
// (home, roster, and candidate pages the model itself rejected). Catches
// over-broad patterns like ^https?://host/[a-z0-9-]+/?$ that also match
// /search, /contact, /disclosures.
function checkDetailPattern(
  pattern: unknown,
  mustMatch: string[],
  mustNotMatch: string[],
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (typeof pattern !== 'string' || pattern.length === 0) {
    problems.push('invalid regex');
    return { ok: false, problems };
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    problems.push('invalid regex');
    return { ok: false, problems };
  }
  for (const u of mustMatch) {
    if (!re.test(u)) problems.push(`does not match detail page ${u}`);
  }
  for (const u of mustNotMatch) {
    // A non-detail URL can also arrive with a query string or fragment
    // (e.g. /search?icid=...). Test both the raw URL and a stripped form so
    // the pattern cannot slip past the check on a technical variant.
    let stripped: string | null = null;
    try {
      const parsed = new URL(u);
      parsed.search = '';
      parsed.hash = '';
      stripped = parsed.toString();
    } catch {
      stripped = null;
    }
    if (re.test(u) || (stripped !== null && re.test(stripped))) {
      problems.push(`also matches non-detail page ${u}`);
    }
  }
  return { ok: problems.length === 0, problems };
}



// ---- P0 site mapper (2026-10-05): verified hints + candidate ranking --------
// Additive: with no hints and no taxonomy rows the mapper behaves as before,
// except that candidate pages are ordered by URL shape (below) instead of
// "positive sitemap URLs, then roster links, then the rest".
type SourceHints = {
  source: 'proposal' | 'ai';
  directory_url?: string;
  profile_url_example?: string;
};

const MAP_DETAIL_TRIES = 6; // candidate pages fetched and judged per map (unchanged)
const MAP_TEMPLATE_FIRST_PASS = 2; // first pass: at most 2 tries per URL shape
const LINK_CANDIDATE_CAP = 300; // roster-page links read before ranking (was 40, deepest first)
const DIRECTORY_MIN_LINKS = 5; // a hinted directory page must link to at least this many deeper pages
const GENERIC_PERSON_TOKENS = ['profile', 'profiles', 'bio', 'bios', 'people', 'staff', 'member', 'members'];
const GENERIC_PLACE_TOKENS = ['location', 'locations', 'store', 'stores', 'office', 'offices', 'branch', 'branches'];
// Site utility pages that are never a profile (account, login, cart, tools).
const UTILITY_NEGATIVE = [
  'account', 'login', 'logon', 'signin', 'signon', 'signup', 'register', 'cart', 'checkout',
  'saved', 'dashboard', 'password', 'faq', 'calculator',
];
const TERM_STOPWORDS = new Set([
  'near', 'how', 'the', 'for', 'and', 'with', 'from', 'your', 'you', 'our', 'best', 'free', 'cost',
  'what', 'who', 'when', 'become', 'about', 'find', 'sale', 'open', 'top', 'new', 'get', 'buy',
  'sell', 'not', 'this', 'that',
]);
const GENERIC_HEAD_WORDS = new Set([
  'group', 'company', 'firm', 'agency', 'establishment', 'room', 'joint', 'associate', 'professional',
  'specialist', 'leader', 'coordinator',
]);

function urlPathTokens(url: string): string[] {
  try {
    return new URL(url).pathname.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  } catch {
    return [];
  }
}

// URL token u matches word t: equal, or a plural of it; a plural word (length > 4)
// also matches its singular (careers → career), but short ones do not (news ≠ new).
function tokEq(u: string, t: string): boolean {
  return u === t || u === t + 's' || (t.length > 4 && u + 's' === t);
}

// Last word of each taxonomy name ("Real Estate Agent" → "agent", "Italian Restaurant" → "restaurant").
function headTokens(terms: string[]): string[] {
  const out = new Set<string>();
  for (const t of terms) {
    const tt = textTokens(t.replace(/[®™]/g, ''));
    const last = tt[tt.length - 1];
    if (last && last.length >= 3 && !GENERIC_HEAD_WORDS.has(last) && !TERM_STOPWORDS.has(last)) out.add(last);
  }
  return [...out];
}

// Words from negative_keyword phrases that never appear in the category's own names
// ("real estate jobs" → "jobs"; "mortgage lender" → "mortgage", "lender").
function negativeTokens(negatives: string[], positive: string[]): string[] {
  const pos = new Set<string>();
  for (const t of positive) for (const w of textTokens(t)) pos.add(w);
  const isPos = (w: string) => [...pos].some((p) => tokEq(w, p));
  const out = new Set<string>();
  for (const n of negatives) {
    for (const w of textTokens(n)) {
      if (w.length < 4 || TERM_STOPWORDS.has(w) || isPos(w)) continue;
      out.add(w);
    }
  }
  return [...out];
}

type CandidateScorer = (url: string) => number;

// URL-shape score for a candidate profile page:
//  +2 path has a category head word (taxonomy), else +1 for a generic profile/location word;
//  +2 path sits under the roster page's path (e.g. /agent → /agent/jane-doe);
//  +2 same URL shape as the hinted profile page;
//  −3 once for a non-profile word (SITEMAP_NEGATIVE, site utility pages, taxonomy negatives).
function makeCandidateScorer(opts: {
  heads: string[];
  generic: string[];
  negatives: string[];
  rosterUrl: string | null;
  profileHint?: string;
}): CandidateScorer {
  let rosterHost = '';
  let rosterPath = '';
  try {
    const r = new URL(opts.rosterUrl ?? '');
    rosterHost = r.host;
    rosterPath = r.pathname.replace(/\/+$/, '');
  } catch {
    /* no roster */
  }
  // Fix (hint shape, 2026-10-05): a hinted profile URL is often a made-up example
  // (/profile/RealtorExample), so it is compared by host + first path segment + depth,
  // not by letters vs digits (real /profile/hheppe5 has a digit).
  const hintTpl = opts.profileHint ? hintShape(opts.profileHint) : '';
  const neg = [...SITEMAP_NEGATIVE, ...UTILITY_NEGATIVE, ...opts.negatives];
  return (url: string) => {
    const toks = urlPathTokens(url);
    let s = 0;
    if (opts.heads.some((h) => toks.some((u) => tokEq(u, h)))) s += 2;
    else if (opts.generic.some((g) => toks.some((u) => tokEq(u, g)))) s += 1;
    if (rosterPath) {
      try {
        const u = new URL(url);
        if (u.host === rosterHost && u.pathname.startsWith(rosterPath + '/')) s += 2;
      } catch {
        /* ignore */
      }
    }
    if (hintTpl && hintShape(url) === hintTpl) s += 2;
    if (toks.some((u) => neg.some((w) => tokEq(u, w)))) s -= 3;
    return s;
  };
}

// Orders candidates by score (ties keep the incoming order), in three bands
// (positive, zero, negative). Within each band the first pass takes at most
// MAP_TEMPLATE_FIRST_PASS URLs per URL shape, so a run of same-shaped pages
// (e.g. property listings) cannot use up every try. Pinned URLs go first.
function rankDetailCandidates(
  urls: string[],
  score: CandidateScorer,
  pinned: string[] = [],
): { url: string; score: number }[] {
  const seen = new Set<string>();
  const scored: { url: string; score: number; i: number }[] = [];
  let i = 0;
  for (const u of [...pinned, ...urls]) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    scored.push({ url: u, score: pinned.includes(u) ? 100 : score(u), i: i++ });
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const band = (c: { score: number }) => (c.score > 0 ? 0 : c.score === 0 ? 1 : 2);
  const out: { url: string; score: number }[] = [];
  for (const b of [0, 1, 2]) {
    const inBand = scored.filter((c) => band(c) === b);
    const first: typeof inBand = [];
    const rest: typeof inBand = [];
    const perTpl = new Map<string, number>();
    for (const c of inBand) {
      const t = urlTemplate(c.url);
      const n = perTpl.get(t) ?? 0;
      if (n < MAP_TEMPLATE_FIRST_PASS) {
        perTpl.set(t, n + 1);
        first.push(c);
      } else rest.push(c);
    }
    for (const c of [...first, ...rest]) out.push({ url: c.url, score: c.score });
  }
  return out;
}

// Hints saved by discovery in the category's company lists (newest first).
async function loadSourceHints(db: any, domain: string, category: string): Promise<SourceHints | null> {
  try {
    const { data, error } = await db
      .from('disco_proposals')
      .select('proposal_id, payload')
      .eq('category_slug', category)
      .eq('kind', 'company_list')
      .order('proposal_id', { ascending: false })
      .limit(20);
    if (error || !data) return null;
    const d = normalizeDomain(domain);
    for (const p of data as any[]) {
      for (const c of (p?.payload?.companies ?? []) as any[]) {
        if (normalizeDomain(String(c?.domain ?? '')) !== d) continue;
        const dir = sameSiteUrl(c?.directory_url, d);
        const prof = sameSiteUrl(c?.profile_url_example, d);
        if (dir || prof) return { source: 'proposal', directory_url: dir, profile_url_example: prof };
      }
    }
  } catch {
    /* enhancement only */
  }
  return null;
}

// One AI call when discovery left no hint. Never throws; null when nothing usable.
async function askSourceHints(
  apiKey: string,
  model: string,
  catBlock: string,
  domain: string,
  homeLinks: { href: string; text: string }[],
): Promise<SourceHints | null> {
  try {
    const input = await callClaudeMap(
      apiKey,
      model,
      catBlock +
        `\nWEBSITE: ${domain}\n\n` +
        `If this website publishes individual profile pages for the category above, give ` +
        `(1) directory_url: the page on this website that lists or searches those profiles, and ` +
        `(2) profile_url_example: the URL of one real profile page. Use the homepage links below where they help. ` +
        `Leave a field empty if you are not sure; do not guess.\n\n` +
        `HOMEPAGE LINKS:\n${homeLinks.map((l) => `- ${l.href} ${l.text}`).join('\n')}`,
      SOURCE_HINTS_TOOL,
      300,
    );
    const dir = sameSiteUrl(input?.directory_url, domain);
    const prof = sameSiteUrl(input?.profile_url_example, domain);
    return dir || prof ? { source: 'ai', directory_url: dir, profile_url_example: prof } : null;
  } catch {
    return null;
  }
}

// A hinted directory is used as the roster page only when it loads on the same
// site, is not just the homepage, and links to enough deeper pages.
function verifyDirectoryPage(r: FetchResult, domain: string, homeUrl: string): { ok: boolean; reason: string } {
  if (!r.ok) return { ok: false, reason: `fetch failed (${r.status}${r.networkError ? ' ' + r.networkError : ''})` };
  if (!isSameSite(r.url, domain)) return { ok: false, reason: `redirected off site to ${r.url}` };
  const strip = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (strip(r.url) === strip(homeUrl)) return { ok: false, reason: 'redirected to the homepage' };
  const n = collectDetailUrls(r.body, r.url, LINK_CANDIDATE_CAP).length;
  if (n < DIRECTORY_MIN_LINKS) return { ok: false, reason: `only ${n} deeper links on the page` };
  return { ok: true, reason: `${n} deeper links on the page` };
}

/** C10: the domain's latest site contract for this category (read only; null when none or version < 3). */
async function loadPreviousContract(db: any, domain: string, category: string): Promise<SiteContract | null> {
  try {
    const { data } = await db
      .from('disco_site_contract')
      .select('extraction, learned_at')
      .eq('domain', domain)
      .eq('category_slug', category)
      .order('learned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sc = (data?.extraction as { site_contract?: SiteContract } | null)?.site_contract;
    return sc && Number(sc.version ?? 0) >= 3 ? sc : null;
  } catch {
    return null;
  }
}

async function mapSite(
  apiKey: string,
  model: string,
  category: string,
  domain: string,
  boundary: Boundary | undefined,
  crawlMethod: CrawlMethod = 'server_crawl',
  retry?: { host: string; rosterUrl: string; reason: string; hints?: SourceHints | null; hintsDiag?: Record<string, unknown> | null },
  opts?: { forceNetwork?: boolean; forceSearch?: boolean; progress?: Record<string, unknown>; profileUrls?: string[]; v2Led?: { pattern: string | null } },
): Promise<Record<string, unknown>> {
  const mapStartedAt = Date.now();
  // Fix (fields only after version 2, 2026-10-14): when site mapper version 2 has proven the list route and
  // handed over its profile pages (opts.v2Led), this run only checks those pages and learns the fields. The
  // steps version 2 already did are skipped: subdomain robots.txt, the sitemap walk, the directory page pick,
  // listing navigation, the profile-rule form checks (version 2's validated profile pattern is used when it
  // matches the accepted page and 90% of the handed-over pages), the background-call capture and the search
  // route. A homepage that does not load no longer stops the run (brand names then come from the samples only).
  // Without version 2 (it failed or stopped) the run is unchanged.
  const v2Led = !!opts?.v2Led && (opts?.profileUrls ?? []).length > 0;
  // Fix (early fetch caps, 2026-10-07): the first fetches (homepage, robots.txt, directory page,
  // candidate profile pages) and the candidate AI check are capped against the run clock as well,
  // like the later steps. One page fetch may otherwise take 60 s plus a 180 s render retry, which
  // can push a run past the worker's 300 s limit on a slow day (kw.com dry run 1309).
  const runLeft = () => 270_000 - (Date.now() - mapStartedAt);
  const cappedFetch = (url: string, capMs: number, method: CrawlMethod = crawlMethod): Promise<FetchResult> => {
    const miss: FetchResult = { ok: false, status: 0, body: '', url, networkError: 'time cap' };
    return withTimeout(fetchPage(url, method).catch(() => miss), Math.max(1_000, Math.min(capMs, runLeft())), miss);
  };
  // Fix (plain fetch for sitemaps, 2026-10-08): robots.txt and sitemap XML are fetched without the
  // browser even when the site's pages need rendering (the scraper still renders when a plain fetch
  // is blocked). elliman.com (rendered) spent ~210 s on 10 rendered sitemap fetches (dry run 2648).
  const plainMethod: CrawlMethod = crawlMethod === 'needs_js_api' ? 'server_crawl' : crawlMethod;
  // Fix (report before the limit, 2026-10-08): what the run has learned so far, returned when the
  // run is stopped at MAP_RUN_LIMIT_MS (mapSiteWithLimit) instead of being cut off with nothing.
  const progress: Record<string, unknown> = opts?.progress ?? {};
  const mark = (step: string, extra: Record<string, unknown> = {}) => { Object.assign(progress, extra, { step, at_ms: Date.now() - mapStartedAt }); };
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const extraHints = await getDynamicRosterHints(db, category);
  const profTerms = extraHints.filter(
    (h) =>
      !h.startsWith('find ') &&
      !h.startsWith('our ') &&
      !h.startsWith('meet ') &&
      !h.endsWith(' directory'),
  );

  // Category context, loaded once for every category-fit judgement below.
  const { data: catRow } = await db.from('gbp_categories').select('display_name, entity_type').eq('gcid', category).maybeSingle();
  let catBoundary = boundary;
  if (!catBoundary?.definition) {
    const { data: b } = await db.from('exp_category_boundary').select('definition, includes, excludes').eq('gcid', category).maybeSingle();
    if (b) catBoundary = b as Boundary;
  }
  const catName = (catRow as any)?.display_name ?? category;
  const catBlock =
    `CATEGORY: ${catName} (${category})\n` +
    (catBoundary?.definition ? `DEFINITION: ${catBoundary.definition}\n` : '') +
    (catBoundary?.includes?.length ? `INCLUDES: ${catBoundary.includes.join('; ')}\n` : '') +
    (catBoundary?.excludes?.length ? `EXCLUDES: ${catBoundary.excludes.map((e) => e?.type).filter(Boolean).join('; ')}\n` : '');

  // Homepage first — probed with the already-known crawl method so a site
  // already classified as needs_js_api doesn't waste a doomed plain fetch.
  mark('homepage');
  const homeFetched = await cappedFetch(`https://${domain}/`, 60_000);
  if (!homeFetched.ok && !v2Led) throw new Error(`homepage fetch failed (${homeFetched.status}${homeFetched.networkError ?? ''})`);
  const homeMissing = !homeFetched.ok;
  const home: FetchResult = homeFetched.ok ? homeFetched : { ...homeFetched, body: '', url: `https://${domain}/` };
  // The site's own brand/firm entity names — present on every page, so they
  // never count as page-specific evidence in step 2.
  const siteEntityNames = collectSiteEntityNames(home.body);

  const siteRoot = domain.toLowerCase().replace(/^www\./, '');
  const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
  const homeHost = hostOf(home.url);
  const rosterRanked = rankRosterLinks(home.body, home.url, extraHints);
  const bestRoster = rosterRanked.length && rosterRanked[0].score > 0 ? rosterRanked[0].href : null;

  // P0 (2026-10-05): hints — saved by discovery, else one AI call; reused on self-heal.
  // Verified before use (directory below, profile page by the normal entity check).
  // Fix (no AI prediction, 2026-10-06): hints (a directory URL and an example profile URL
  // guessed by the AI, here or at discovery) are no longer used. Directory pages come from the
  // site's own links and sitemaps; profile pages from the candidates the site itself lists.
  const hints = null as SourceHints | null;
  void loadSourceHints; void askSourceHints;
  // On a self-heal pass the first pass's record is kept, so its directory check stays visible.
  const hintsDiag: Record<string, unknown> | null = retry?.hintsDiag ?? (hints
    ? { source: hints.source, directory_url: hints.directory_url ?? null, profile_url_example: hints.profile_url_example ?? null }
    : null);
  let hintDirectory: FetchResult | null = null;
  if (!retry && hints?.directory_url) {
    const r = await fetchPage(hints.directory_url, crawlMethod);
    const v = verifyDirectoryPage(r, siteRoot, home.url);
    hintsDiag!.directory_check = v.reason;
    hintsDiag!.directory_used = v.ok;
    if (v.ok) hintDirectory = r;
  }

  const rosterHost = hostOf(retry?.rosterUrl ?? hintDirectory?.url ?? bestRoster ?? '');
  // robots.txt of other same-site subdomains that positively-scored roster links point to
  const extraHosts: string[] = [];
  if (retry?.host && retry.host !== homeHost) extraHosts.push(retry.host);
  if (hintDirectory && hostOf(hintDirectory.url) !== homeHost && !extraHosts.includes(hostOf(hintDirectory.url))) {
    extraHosts.push(hostOf(hintDirectory.url));
  }
  for (const l of v2Led ? [] : rosterRanked) {
    if (extraHosts.length >= ROBOTS_MAX_SUBDOMAINS) break;
    if (l.score <= 0) break;
    const h = hostOf(l.href);
    if (!h) continue;
    if (h !== homeHost && !extraHosts.includes(h)) extraHosts.push(h);
    if (extraHosts.length >= ROBOTS_MAX_SUBDOMAINS) break;
  }
  const subdomainRobots: { host: string; status: number; sitemaps: string[] }[] = [];
  const subdomainSitemaps: string[] = [];
  const robotsFetched = await Promise.all(extraHosts.map((h) => cappedFetch(`https://${h}/robots.txt`, 20_000, plainMethod)));
  for (const [ri, h] of extraHosts.entries()) {
    const rb = robotsFetched[ri];
    const sms = rb.ok ? extractRobotsSitemaps(rb.body).filter((u) => isSameSite(u, siteRoot)) : [];
    subdomainRobots.push({ host: h, status: rb.status, sitemaps: sms });
    subdomainSitemaps.push(...sms);
  }

  const isPersonCategory = (catRow as any)?.entity_type !== 'location';
  const catTerms = await loadCategoryTerms(db, category, isPersonCategory ? 'person' : 'place');
  const genericTokens = isPersonCategory ? GENERIC_PERSON_TOKENS : GENERIC_PLACE_TOKENS;
  const headWords = headTokens([...catTerms.terms, ...profTerms]);
  // Fix (sitemap order, 2026-10-05): sitemaps are scored with the category's head words
  // (agent, advisor, restaurant, ...) as well as full titles, so e.g. /sitemaps/agents/
  // is read before /sitemaps/listings/. Used for top-level and child sitemaps.
  const sitemapPickScore = (u: string): number =>
    sitemapRelevance(u, profTerms) +
    hostRelevance(u, siteRoot, profTerms) +
    (headWords.length && urlPathTokens(u).some((t) => headWords.some((h) => tokEq(t, h))) ? 2 : 0);

  // 0. sitemap-derived candidates (highest-confidence per-entity URLs). Bounded
  // breadth-first walk over subdomain + recon + domain sitemaps, sampling index children.
  const sitemapCandidates: string[] = [];
  const sitemapTrace: SitemapTraceEntry[] = [];
  const parentOf = new Map<string, string>();
  const sitemapFamily = new Map<string, number>(); // sampled child sitemap → size of its file family
  const fromOf = new Map<string, string>();
  const sitemapScore = new Map<string, number>();
  // Full ranked sitemap page pool, hoisted so site-contract sampling can reuse it.
  const sitemapPoolUrls: string[] = [];
  try {
    // v2Led: version 2's list route already covers the sitemaps; the walk is skipped (caught below).
    if (v2Led) throw new Error('sitemap walk skipped: version 2 list route');
    const dom = domain.toLowerCase();
    const { data: domRow } = await db
      .from('exp_etl_domains')
      .select('sitemap_url')
      .eq('domain', dom)
      .maybeSingle();
    const { data: srcRow } = await db
      .from('exp_etl_sources')
      .select('recon')
      .eq('source_domain', dom)
      .eq('gcid', category)
      .maybeSingle();
    const reconSitemaps: unknown = (srcRow as any)?.recon?.sitemaps;
    const rawTop: string[] = [...subdomainSitemaps];
    if (typeof domRow?.sitemap_url === 'string') rawTop.push(domRow.sitemap_url);
    if (Array.isArray(reconSitemaps)) {
      for (const s of reconSitemaps) if (typeof s === 'string') rawTop.push(s);
    }
    const visited = new Set<string>();
    const top: string[] = [];
    for (const s of rawTop) {
      const u = cleanUrl(s);
      if (!u || !isSameSite(u, dom) || /\.gz$/i.test(u) || visited.has(u)) continue;
      visited.add(u);
      top.push(u);
    }
    // Most relevant top-level sitemaps first (stable: ties keep the site's order).
    const queue: { url: string; depth: number }[] = top
      .map((url, i) => ({ url, i, s: sitemapPickScore(url) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, SITEMAP_MAX_TOP)
      .map(({ url }) => ({ url, depth: 0 }));
    const pool: { url: string; from: string; fromScore: number }[] = [];
    let fetches = 0;
    while (queue.length && fetches < SITEMAP_MAX_FETCHES) {
      const { url, depth } = queue.shift()!;
      fetches++;
      const smFallback: FetchResult = { ok: false, status: 0, body: '', url } as FetchResult;
      let sm = await withTimeout(fetchPage(url, plainMethod), 25_000, smFallback);
      // Fix (sitemap retry, 2026-10-06): one retry when a sitemap file errors (a site can return
      // 404/5xx on a sitemap for a moment; edwardjones.com did on dry run 19206).
      if (!sm.ok || sm.status >= 400) {
        await new Promise((res) => setTimeout(res, 1500));
        sm = await withTimeout(fetchPage(url, plainMethod), 25_000, smFallback);
      }
      if (!sm.ok || sm.status >= 400) {
        sitemapTrace.push({ url, depth, kind: 'error', status: sm.status, locs: 0 });
        continue;
      }
      const locs = extractLocs(sm.body, SITEMAP_LOCS_READ).filter((l) => isSameSite(l, dom));
      if (isSitemapIndex(sm.body)) {
        const children = locs.filter((l) => !/\.gz$/i.test(l) && !visited.has(l));
        let sampled: string[] = [];
        if (depth + 1 <= SITEMAP_MAX_DEPTH) {
          sampled = children
            .map((c, i) => ({ c, i, s: sitemapPickScore(c) }))
            .sort((a, b) => b.s - a.s || a.i - b.i)
            .slice(0, SITEMAP_MAX_CHILDREN)
            .map((x) => x.c);
          // Fix (sitemap spread, 2026-10-07): when the best child belongs to a family of numbered or
          // dated files (sitemap-1..N, agent-sitemap-2026-09-09-1 …), read a spread of that family
          // (first, middle, last) instead of its best-named members, so the profile count per file
          // and the family size give an estimate for the whole index.
          const fam = (u: string) => u.replace(/\d+/g, '#');
          const top = sampled.at(0);
          if (top) {
            const family = children.filter((c) => fam(c) === fam(top));
            if (family.length >= 4) {
              sampled = [...new Set([family.at(0)!, family.at(Math.floor(family.length / 2))!, family.at(-1)!])];
            }
            for (const c of sampled) if (fam(c) === fam(top)) sitemapFamily.set(c, family.length);
          }
          for (const c of sampled) {
            visited.add(c);
            parentOf.set(c, url);
            queue.push({ url: c, depth: depth + 1 });
          }
        }
        sitemapTrace.push({ url, depth, kind: 'index', status: sm.status, locs: locs.length, sampled });
      } else {
        const fromScore = sitemapRelevance(url, profTerms) + hostRelevance(url, siteRoot, profTerms);
        for (const l of locs) pool.push({ url: l, from: url, fromScore });
        sitemapTrace.push({ url, depth, kind: 'urlset', status: sm.status, locs: locs.length });
      }
    }
    const ranked = pool
      .map((p, i) => ({
        u: p.url,
        from: p.from,
        i,
        s:
          sitemapRelevance(p.url, profTerms) +
          hostRelevance(p.url, siteRoot, profTerms) +
          (rosterHost && hostOf(p.url) === rosterHost ? 1 : 0),
        f: p.fromScore,
      }))
      .sort((a, b) => b.s - a.s || b.f - a.f || a.i - b.i);
    const seenC = new Set<string>();
    const sortedUnique: string[] = [];
    for (const r of ranked) {
      if (seenC.has(r.u)) continue;
      seenC.add(r.u);
      sitemapScore.set(r.u, r.s);
      sortedUnique.push(r.u);
      sitemapPoolUrls.push(r.u);
      fromOf.set(r.u, r.from);
    }
    // Diversify: round-robin across URL-shape groups, groups ordered by first appearance.
    const groups = new Map<string, string[]>();
    for (const u of sortedUnique) {
      const t = urlTemplate(u);
      const g = groups.get(t);
      if (g) g.push(u);
      else groups.set(t, [u]);
    }
    const lists = [...groups.values()];
    for (let k = 0; sitemapCandidates.length < SITEMAP_CANDIDATE_CAP; k++) {
      let any = false;
      for (const g of lists) {
        if (k < g.length) {
          any = true;
          sitemapCandidates.push(g[k]);
          if (sitemapCandidates.length >= SITEMAP_CANDIDATE_CAP) break;
        }
      }
      if (!any) break;
    }
  } catch {
    /* no sitemap — fall through to today's behavior */
  }

  // 1. roster / directory page
  mark('directory page', { sitemap_trace: sitemapTrace });
  let rosterPage = home;
  // P0: a verified hinted directory is the roster page; otherwise as before.
  let rosterUrl = v2Led ? null : retry ? retry.rosterUrl : hintDirectory ? hintDirectory.url : bestRoster;
  if (!rosterUrl && !v2Led) {
    const links = extractAllLinks(home.body, home.url);
    if (links.length > 0) {
      rosterUrl = await withTimeout(pickRosterLinkWithLLM(apiKey, model, category, catBoundary, links, MAP_TEMPERATURE), Math.max(1_000, Math.min(30_000, runLeft())), null);
    }
  }
  if (hintDirectory && rosterUrl === hintDirectory.url) {
    rosterPage = hintDirectory;
  } else if (rosterUrl) {
    const r = await cappedFetch(rosterUrl, 45_000);
    if (r.ok) rosterPage = r;
  }

  // 2. one detail page that fits this category (person pages preferred).
  // P0: all roster links are read (not just the 40 deepest) and every candidate is
  // ranked by URL shape; the hinted profile page (if any) is tried first.
  // P1 (2026-10-05): profile URLs of records embedded in the roster page's application state
  // (e.g. __NEXT_DATA__) come first; then the page's <a> links as before.
  const embeddedRosterUrls = embeddedEntityUrls(rosterPage.body, rosterPage.url);
  const linkCandidates = [
    ...embeddedRosterUrls,
    ...collectDetailUrls(rosterPage.body, rosterPage.url, LINK_CANDIDATE_CAP).filter((u) => !embeddedRosterUrls.includes(u)),
  ];
  // Fix (roster not a candidate, 2026-10-05): the roster page itself, the homepage and a
  // self-heal roster are never profile candidates (they were re-tried as "detail" pages).
  const pageKey = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  const notCandidate = new Set([rosterPage.url, home.url, retry?.rosterUrl ?? ''].filter(Boolean).map(pageKey));
  // Site mapper version 2 (dry runs): profile URLs version 2 discovered and validated come first,
  // as profile candidates and as sample / rule pool. Only pages on this site are taken.
  const givenProfiles = (opts?.profileUrls ?? []).filter((u) => {
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
      const d = domain.toLowerCase().replace(/^www\./, '');
      return h === d || h.endsWith(`.${d}`);
    } catch { return false; }
  }).slice(0, 60);
  for (const u of [...givenProfiles].reverse()) if (!sitemapPoolUrls.includes(u)) sitemapPoolUrls.unshift(u);
  if (givenProfiles.length) mark('profile urls from version 2', { given_profiles: givenProfiles.length });
  const preOrder = [
    ...givenProfiles,
    ...sitemapCandidates.filter((u) => (sitemapScore.get(u) ?? 0) > 0),
    ...linkCandidates.filter((u) => !sitemapCandidates.includes(u)),
    ...sitemapCandidates.filter((u) => (sitemapScore.get(u) ?? 0) <= 0),
  ].filter((u, i, all) => !notCandidate.has(pageKey(u)) && all.indexOf(u) === i);
  // Fix (search pages, 2026-10-08): pages whose search box the seed may use - the directory page,
  // up to 2 same-site pages linked from it or the homepage whose link text or path says search /
  // find / locator / lookup, then the homepage. A directory search often sits on its own page
  // (a "Find an advisor" link), not on the page the mapper picked as the directory.
  const SEARCH_PAGE_RE = /\b(search|find|locator|locate|lookup)\b/i;
  const searchSeedPages = async (): Promise<Array<{ html: string; url: string }>> => {
    const first = [{ html: rosterPage.body, url: rosterPage.url }];
    const last = rosterPage !== home ? [{ html: home.body, url: home.url }] : [];
    const seen = new Set([...first, ...last].map((p) => pageKey(p.url)));
    const linked: string[] = [];
    for (const l of [...first, ...last].flatMap((p) => extractAllLinks(p.html, p.url))) {
      if (linked.length >= 2) break;
      let path = '';
      try { path = new URL(l.href).pathname.replace(/[-_/.]+/g, ' '); } catch { continue; }
      if (!SEARCH_PAGE_RE.test(l.text) && !SEARCH_PAGE_RE.test(path)) continue;
      if (/\.(pdf|xml|jpe?g|png|gif|svg|css|js)(\?|$)/i.test(l.href) || seen.has(pageKey(l.href))) continue;
      seen.add(pageKey(l.href));
      linked.push(l.href);
    }
    const fetched = linked.length && runLeft() > 100_000 ? await Promise.all(linked.map((u) => cappedFetch(u, 30_000))) : [];
    const extra = fetched.filter((r) => r.ok && !pageDidNotLoad(r)).map((r) => ({ html: r.body, url: r.url }));
    return [...first, ...extra, ...last];
  };
  const runSearchSeed = (deadlineAt: number): Promise<{ urls: string[]; report: Record<string, unknown> }> =>
    withTimeout(
      (async () => searchSeedCandidates({ db, pages: await searchSeedPages(), siteRoot, crawlMethod, deadlineAt }))()
        .catch((e) => ({ urls: [] as string[], report: { status: 'error', error: String(e).slice(0, 200) } as Record<string, unknown> })),
      Math.max(1_000, deadlineAt + 5_000 - Date.now()),
      { urls: [] as string[], report: { status: 'time budget' } },
    );
  // Step 6 follow-up: no candidates at all → the site's own search box supplies them.
  let searchSeed: { urls: string[]; report: Record<string, unknown> } | null = null;
  mark('search seed', { roster_url: rosterPage.url, candidates_before_seed: preOrder.length });
  if (!preOrder.length && runLeft() > 120_000) {
    searchSeed = await runSearchSeed(mapStartedAt + 150_000);
  }
  const baseOrder = [...preOrder, ...(searchSeed?.urls ?? []).filter((u) => !notCandidate.has(pageKey(u)) && !preOrder.includes(u))];
  const scoreCandidate = makeCandidateScorer({
    heads: headWords,
    generic: genericTokens,
    negatives: negativeTokens(catTerms.negatives, [...catTerms.terms, ...profTerms, ...genericTokens]),
    rosterUrl: rosterPage === home ? null : rosterPage.url,
    profileHint: hints?.profile_url_example,
  });
  // Pinned on the first pass only; a self-heal pass already tried it.
  const pinned = [
    ...givenProfiles.slice(0, 3),
    ...(!retry && hints?.profile_url_example ? [hints.profile_url_example] : []),
  ];
  // Fix (keep sitemap/host evidence, 2026-10-05): the URL-shape score is added to the evidence
  // the mapper already had before P0 - the sitemap relevance of a sitemap URL (incl. a
  // category-named subdomain such as advisor.<site>), or for page links the subdomain relevance -
  // so profiles on a category subdomain are not out-ranked by same-site pages elsewhere.
  // A category-named subdomain counts +2, like a category word in the path.
  const rosterLinkSet = new Set(linkCandidates);
  const evidenceScore = (u: string): number => {
    const host = Math.max(0, hostRelevance(u, siteRoot, profTerms));
    const sitemap = sitemapScore.has(u) ? Math.max(0, (sitemapScore.get(u) ?? 0) - host) : 0;
    // Fix (directory links first, 2026-10-05): links found on the chosen directory page (not the
    // homepage) get +1, so they win ties against sitemap pages from unrelated site sections.
    const onRoster = rosterPage !== home && rosterLinkSet.has(u) ? 1 : 0;
    return scoreCandidate(u) + sitemap + 2 * host + onRoster;
  };
  const rankedCandidates = rankDetailCandidates(baseOrder, evidenceScore, pinned);
  const candidates = rankedCandidates.map((c) => c.url);
  let detail: FetchResult | null = null;
  let detailCandidateUrl: string | null = null;
  let detailEntityType: PageEntityKind | null = null;
  let detailEntityTypeSource: 'jsonld' | 'url_match' | 'llm' | null = null;
  let fallback: { url: string; r: FetchResult; kind: PageEntityKind | null; source: 'jsonld' | 'url_match' | 'llm' | null } | null = null;
  const tried: Array<{ url: string; ok: boolean; status: number; jsonld_entity: boolean; llm_entity: boolean | null; reason: string; error?: string | null; body_len?: number; rendered?: boolean | null }> = [];
  mark('profile page check', { ...(searchSeed ? { search_seed: searchSeed.report } : {}), tried });
  // The AI-guessed profile page (pinned) does not use up one of the regular tries.
  let candidateBatch = candidates.slice(0, MAP_DETAIL_TRIES + pinned.length);
  for (let round = 0; round < 2 && candidateBatch.length; round++) {
    for (const url of candidateBatch) {
      if (runLeft() < 60_000) {
        tried.push({ url, ok: false, status: 0, jsonld_entity: false, llm_entity: null, reason: 'skipped (time budget)' });
        break;
      }
      const r = await cappedFetch(url, 45_000);
      if (!r.ok) {
        tried.push({ url, ok: false, status: r.status, jsonld_entity: false, llm_entity: null, reason: 'fetch failed', error: r.networkError ?? null, body_len: r.body.length, rendered: r.rendered ?? null });
        continue;
      }
      if (pageDidNotLoad(r)) {
        tried.push({ url, ok: false, status: r.status, jsonld_entity: false, llm_entity: null, reason: `did not load (status ${r.status})`, body_len: r.body.length, rendered: r.rendered ?? null });
        continue;
      }
      // Fix (profile-page check, 2026-10-06): several entities with none tied to the page = a
      // listing page, never a profile; only an entity tied to the page counts as JSON-LD evidence.
      // A single untied entity no longer skips the AI page check.
      const pageEv = pageEntityEvidence(r.body, r.url, siteEntityNames, isPersonCategory ? 'person' : 'location');
      if (pageEv.kind === 'listing') {
        tried.push({ url, ok: true, status: r.status, jsonld_entity: false, llm_entity: null, reason: `listing page: ${pageEv.entities} entities, none tied to the page` });
        continue;
      }
      const jsonldOk = pageEv.kind === 'profile';
      void hasPageSpecificEntityJsonLd;
      // P1: the page's own record from embedded application state, shown to the AI below
      // because it usually sits past the 12,000 characters of HTML the AI sees.
      const embedded = jsonldOk ? [] : collectEmbeddedEntities(r.body).slice(0, 3);
      if (!jsonldOk && !embedded.length && !hasEntityData(r.body)) {
        tried.push({ url, ok: true, status: r.status, jsonld_entity: false, llm_entity: null, reason: 'no page-specific JSON-LD entity and no entity data' });
        continue;
      }
      let verdict: any = null;
      try {
        verdict = await withTimeout(callClaudeMap(
          apiKey,
          model,
          catBlock +
            `\nDoes this page describe ONE identifiable person, professional, or business, or is it a ` +
            `directory / search-form / marketing page? Answer via the return_entity_page tool with ` +
            `is_entity_page, entity_kind ("person" if the page describes one person, "business" if one business/office), ` +
            `and fits_category (true only if the page's subject belongs to the category above as defined).\n\n` +
            `URL: ${r.url}\n\n` +
            (embedded.length
              ? `RECORDS EMBEDDED IN THE PAGE DATA (first ${embedded.length}):\n${JSON.stringify(embedded).slice(0, 3000)}\n\n`
              : '') +
            `HTML (truncated):\n${r.body.slice(0, 12000)}`,
          ENTITY_PAGE_TOOL,
          256,
        ), Math.max(1_000, Math.min(30_000, runLeft())), null);
      } catch (e) {
        if (!jsonldOk) throw e;
      }
      if (!jsonldOk && verdict?.is_entity_page !== true) {
        tried.push({ url, ok: true, status: r.status, jsonld_entity: false, llm_entity: false, reason: verdict == null ? 'page check timed out' : `LLM: not an entity page — ${verdict?.reason ?? ''}` });
        continue;
      }
      const llmEntity = jsonldOk ? null : true;
      if (verdict?.fits_category !== true) {
        tried.push({ url, ok: true, status: r.status, jsonld_entity: jsonldOk, llm_entity: llmEntity, reason: `not this category: ${verdict?.reason ?? ''}` });
        continue;
      }
      let kind: PageEntityKind | null;
      let source: 'jsonld' | 'url_match' | 'llm' | null;
      if (verdict?.entity_kind === 'person') {
        kind = 'professional';
        source = 'llm';
      } else if (verdict?.entity_kind === 'business') {
        kind = 'location';
        source = 'llm';
      } else {
        const detected = detectPageEntityKindDetailed(r.body, siteEntityNames, r.url);
        kind = detected.kind;
        source = detected.source;
      }
      if (profTerms.length > 0 && kind !== 'professional') {
        if (!fallback) fallback = { url, r, kind, source };
        tried.push({ url, ok: true, status: r.status, jsonld_entity: jsonldOk, llm_entity: llmEntity, reason: 'accepted (business page; still looking for a person page)' });
        continue;
      }
      tried.push({ url, ok: true, status: r.status, jsonld_entity: jsonldOk, llm_entity: llmEntity, reason: 'accepted' });
      detail = r;
      detailCandidateUrl = url;
      detailEntityType = kind;
      detailEntityTypeSource = source;
      break;
    }
    // Fix (search after failed candidates, 2026-10-08): every candidate failed and the search seed
    // has not run yet -> the site's own search box (directory page, linked search pages, homepage)
    // supplies new candidates once, judged by the same checks. Needs 120 s left; the seed stops
    // at least 70 s before the run limit so its candidates can still be checked.
    // wellsfargoadvisors.com dry run 2650: 6 marketing pages rejected and the seed never ran.
    // v2Led: no search fallback; if version 2's pages all fail the profile check the run ends with that reason.
    if (v2Led || detail || fallback || round > 0 || searchSeed || runLeft() < 120_000) break;
    mark('search after failed candidates', { tried });
    searchSeed = await runSearchSeed(Math.min(mapStartedAt + 200_000, Date.now() + 100_000));
    const triedKeys = new Set(tried.map((t) => pageKey(t.url)));
    const seedUrls = searchSeed.urls.filter((u) => !notCandidate.has(pageKey(u)) && !triedKeys.has(pageKey(u)));
    candidateBatch = rankDetailCandidates(seedUrls, evidenceScore, []).map((c) => c.url).slice(0, MAP_DETAIL_TRIES);
  }
  if (!detail && fallback) {
    detail = fallback.r;
    detailCandidateUrl = fallback.url;
    detailEntityType = fallback.kind;
    detailEntityTypeSource = fallback.source;
  }
  if (!detail) {
    // P0: the message says what the tried pages were, not just how many candidates existed.
    const why = (t: { ok: boolean; reason: string }) =>
      !t.ok
        ? 'did not load'
        : t.reason.startsWith('not this category')
          ? 'another category'
          : t.reason.startsWith('no page-specific')
            ? 'no profile data'
            : 'not a profile page';
    const whyCounts = new Map<string, number>();
    for (const t of tried) whyCounts.set(why(t), (whyCounts.get(why(t)) ?? 0) + 1);
    const whyText = [...whyCounts.entries()].map(([k, n]) => `${n} ${k}`).join(', ');
    const noDetailMsg =
      `no fetchable entity detail page found from ${rosterPage.url} ` +
      `(${candidates.length} candidates; tried ${tried.length}${whyText ? `: ${whyText}` : ''})`;
    const okCount = tried.filter((t) => t.ok).length;
    const hasUrlset = sitemapTrace.some((t) => t.kind === 'urlset' && t.locs > 0);
    const gatePassed = okCount >= 3 && (hasUrlset || linkCandidates.length > 0);
    const diagnostics: Record<string, unknown> = {
      tried,
      sitemap_trace: sitemapTrace,
      subdomain_robots: subdomainRobots,
      roster_url: rosterPage.url,
      gate: gatePassed ? 'passed' : 'failed',
      ...(hintsDiag ? { mapper_hints: hintsDiag } : {}),
      candidate_scores: rankedCandidates.slice(0, MAP_DETAIL_TRIES + 4),
      embedded_roster_urls: embeddedRosterUrls.length,
      ...(searchSeed ? { search_seed: searchSeed.report } : {}),
    };
    let healUrl: string | null = null;
    let healVerdict: any = null;
    if (gatePassed) {
      try {
        const homeLinks = extractAllLinks(home.body, home.url).slice(0, 50);
        const boundaryText = boundary?.definition ? `\nCATEGORY DEFINITION: ${boundary.definition}` : '';
        const verdict = await callClaudeMap(
          apiKey,
          model,
          `CATEGORY: ${category}${boundaryText}\nDOMAIN: ${domain}\nROSTER PAGE URL: ${rosterPage.url}\n\n` +
            `PAGES TRIED:\n${tried.map((t) => `- ${t.url} (${t.reason})`).join('\n')}\n\n` +
            `HOMEPAGE LINKS (same-site, up to 50):\n${homeLinks.map((l) => `- ${l.href} ${l.text}`).join('\n')}\n\n` +
            `Does this website host individual profile pages for professionals in this category, one page per person or office? ` +
            `Pages on any subdomain of ${siteRoot} are part of this website. ` +
            `If not, where do those profiles live? Answer via the return_profile_availability tool.`,
          NO_PROFILES_TOOL,
          512,
        );
        diagnostics.ai_verdict = verdict?.hosts_profiles;
        diagnostics.where_profiles_live = verdict?.where_profiles_live;
        diagnostics.note = verdict?.note;
        diagnostics.profiles_url = verdict?.profiles_url ?? null;
        const pu = cleanUrl(String(verdict?.profiles_url ?? ''));
        let puOk = false;
        try { new URL(pu); puOk = true; } catch { /* not a URL */ }
        // P0: self-heal also when the profiles URL is on the same host or an already-read
        // subdomain — what matters is that it is a different page from the roster just used.
        const samePage = (a: string, b: string) =>
          a.replace(/[?#].*$/, '').replace(/\/+$/, '') === b.replace(/[?#].*$/, '').replace(/\/+$/, '');
        if (
          !retry &&
          puOk &&
          isSameSite(pu, siteRoot) &&
          !samePage(pu, rosterPage.url) &&
          !samePage(pu, home.url) &&
          !tried.some((t) => samePage(t.url, pu))
        ) {
          diagnostics.self_heal = { profiles_url: pu };
          healUrl = pu;
          healVerdict = verdict;
        }
        if (!healUrl && verdict?.hosts_profiles === 'no') {
          return {
            outcome: 'no_profiles_on_site',
            evidence: {
              ai_verdict: 'no',
              where_profiles_live: verdict?.where_profiles_live ?? null,
              note: verdict?.note ?? null,
              roster_url: rosterPage.url,
              tried,
              sitemap_trace: sitemapTrace,
              subdomain_robots: subdomainRobots,
              profiles_url: verdict?.profiles_url ?? null,
              ...(retry ? { self_heal: { from_host: retry.host, roster_url: retry.rosterUrl, reason: retry.reason } } : {}),
            },
          };
        }
      } catch (e) {
        diagnostics.llm_error = String(e);
      }
    }
    // Fix (self-heal time guard, 2026-10-08): the second pass starts only with 90 s left; with less
    // it cannot finish and the run was stopped at the worker limit (wellsfargoadvisors.com dry run 2650).
    if (healUrl && runLeft() < 90_000) {
      diagnostics.self_heal = { profiles_url: healUrl, skipped: `time budget (${Math.round(runLeft() / 1000)} s left)` };
      healUrl = null;
    }
    if (healUrl) {
      // Self-heal once: profiles live on another subdomain of this same company site.
      try {
        return await mapSite(apiKey, model, category, domain, boundary, crawlMethod, {
          host: hostOf(healUrl),
          rosterUrl: healUrl,
          reason: String(healVerdict?.where_profiles_live ?? ''),
          hints,
          hintsDiag,
        });
      } catch (e) {
        if (e instanceof MapSiteError) {
          e.diagnostics.first_pass = {
            tried,
            roster_url: rosterPage.url,
            ai_verdict: healVerdict?.hosts_profiles,
            profiles_url: healUrl,
          };
        }
        throw e;
      }
    }
    throw new MapSiteError(noDetailMsg, diagnostics);
  }

  // Taxonomy layer: the category's registry keys, loaded once. Only keys a
  // firm's own profile page could show (website lane or unowned, no Questions).
  const { data: registryRows } = await db
    .from('exp_vertical_node_registry')
    .select('node_slug, node_name, node_description, schema_type, schema_property, entity_scope, owns_lane')
    .eq('gcid', category)
    .eq('is_active', true);
  const taxonomyRows = (registryRows ?? []) as TaxonomyRow[];

  // 3. Sonnet emits the contract, with the boundary for field relevance
  const boundaryBlock = boundary?.definition
    ? `CATEGORY BOUNDARY (use it to judge which fields matter):\n${boundary.definition}\n` +
      (boundary.includes?.length ? `Includes: ${boundary.includes.join('; ')}\n` : '')
    : '';

  // Fix (pattern coverage, 2026-10-05): other links with the same parent path as the accepted
  // profile page (directory links, sitemap pool, links on the profile page). The AI sees a few,
  // and the final pattern is checked against all of them below, so detail_pattern is not
  // generalised from one example only (e.g. digits-only when the site also uses name slugs).
  const detailParent = parentKey(detail.url);
  const knownNonDetail = new Set<string>([home.url, rosterPage.url, ...(retry?.rosterUrl ? [retry.rosterUrl] : [])]);
  const sameParentPool: string[] = [];
  {
    const seenPool = new Set<string>([detail.url, ...(detailCandidateUrl ? [detailCandidateUrl] : [])]);
    for (const u of [...linkCandidates, ...sitemapPoolUrls, ...collectDetailUrls(detail.body, detail.url, LINK_CANDIDATE_CAP)]) {
      if (sameParentPool.length >= 200) break;
      if (seenPool.has(u) || knownNonDetail.has(u)) continue;
      seenPool.add(u);
      if (detailParent && parentKey(u) === detailParent) sameParentPool.push(u);
    }
  }
  const samePathBlock = sameParentPool.length
    ? `OTHER LINKS WITH THE SAME PATH AS THE DETAIL PAGE (from the directory page and sitemaps; most are usually other profiles, a few may be listing pages):\n${sameParentPool.slice(0, 12).join('\n')}\n\n`
    : '';

  const contractPrompt =
    `You are writing a deterministic parser contract for ${domain} (category "${category}").\n` +
    boundaryBlock +
    `\nROSTER PAGE URL: ${rosterPage.url}\nDETAIL PAGE URL: ${detail.url}\n\n` +
    samePathBlock +
    `From the detail-page markup below, enumerate EVERY field it exposes (JSON-LD keys, ` +
    `__NEXT_DATA__ paths, or stable CSS selectors) and emit a contract via the return_site_contract tool:\n` +
    `- roster_pattern: a REGULAR EXPRESSION matched against a URL, true for roster/listing pages on this site (e.g. "/agents/[a-z-]+/?$")\n` +
    `- detail_pattern: a REGULAR EXPRESSION matched against a URL, true for entity detail pages, generalised from the URL above (REQUIRED). ` +
    `Its variable part must accept every profile URL form seen in the same-path links (e.g. both numeric ids and name slugs), not only the characters of one example\n` +
    `- field_floor: how many distinct fields the detail page offers (must be at least 5, count honestly)\n` +
    `- extraction: if the detail page has application/ld+json script tags containing the entity's data, ` +
    `set list_source to "jsonld", json_path to the array of keys from the JSON-LD root down to the entity ` +
    `object (or list of entity objects), and field_map to our field names mapped to the JSON-LD's own key ` +
    `names, e.g. { "list_source": "jsonld", "json_path": ["mainEntity"], "field_map": { "bio": "description", "phone": "telephone" } }. ` +
    `If there is no JSON-LD entity data, set list_source to "none".\n\n` +
    `DETAIL PAGE MARKUP (truncated):\n${detail.body.slice(0, 40000)}`;

  let input = await callClaudeMap(apiKey, model, contractPrompt, CONTRACT_TOOL, 4096);

  // Deterministic URL-pattern check with one corrective retry. The sets below
  // are ground truth we established by fetching: `mustMatch` are pages that ARE
  // entity detail pages, `mustNotMatch` are pages the pipeline itself proved
  // are not (home, roster, and candidates rejected by the LLM/JSON-LD checks).
  const mustMatch: string[] = [detail.url];
  if (detailCandidateUrl && detailCandidateUrl !== detail.url) mustMatch.push(detailCandidateUrl);
  const mustNotSet = new Set<string>();
  const ambiguousSamePath: string[] = [];
  const addMustNot = (u?: string | null) => { if (u) mustNotSet.add(u); };
  addMustNot(home.url);
  addMustNot(rosterPage.url);
  addMustNot(retry?.rosterUrl);
  for (const t of tried) {
    // Fix (hint guess, 2026-10-05): the AI-guessed profile URL is a guess; when it fails it
    // proves nothing about the site's URL shape (a guessed name often returns a generic page
    // with the real profile URL shape), so it never constrains detail_pattern.
    if (pinned.includes(t.url)) continue;
    // Fix (pattern coverage, 2026-10-05): a same-path page that IS an entity page of another
    // kind (team, brokerage, other role) shares the profile URL template, so it cannot be
    // excluded by URL; the harvest's per-record checks handle it. Recorded, not enforced.
    if (t.reason.startsWith('not this category') && detailParent && parentKey(t.url) === detailParent) {
      ambiguousSamePath.push(t.url);
      continue;
    }
    if (INCONCLUSIVE_REASON_RE.test(t.reason)) continue;
    if (
      t.reason.startsWith('LLM: not an entity page') ||
      t.reason.startsWith('not this category') ||
      t.reason.startsWith('no page-specific JSON-LD') ||
      t.reason.startsWith('listing page')
    ) {
      addMustNot(t.url);
    }
  }
  const mustMatchSet = new Set(mustMatch);
  const mustNotMatch = [...mustNotSet].filter((u) => !mustMatchSet.has(u)).slice(0, 20);

  // Fix (code-built profile rule, 2026-10-06): detail_pattern is built by code from the URLs
  // this run saw; other URL forms are included only when fetched pages of that form pass the
  // same page check. Known non-profile pages that still match are excluded by exact URL.
  // The AI's detail_pattern is not used (kept only as a fallback when no rule can be built).
  const overTime = (ms: number) => Date.now() - mapStartedAt > ms;
  const rejectedTried = new Set(tried.filter((t) => !t.reason.startsWith('accepted')).map((t) => t.url));
  const entityPrompt = (r: FetchResult, embedded: unknown[]) =>
    catBlock +
    `\nDoes this page describe ONE identifiable person, professional, or business, or is it a ` +
    `directory / search-form / marketing page? Answer via the return_entity_page tool with ` +
    `is_entity_page, entity_kind ("person" if the page describes one person, "business" if one business/office), ` +
    `and fits_category (true only if the page's subject belongs to the category above as defined).\n\n` +
    `URL: ${r.url}\n\n` +
    (embedded.length ? `RECORDS EMBEDDED IN THE PAGE DATA (first ${embedded.length}):\n${JSON.stringify(embedded).slice(0, 3000)}\n\n` : '') +
    `HTML (truncated):\n${r.body.slice(0, 12000)}`;
  type Verdict = { url: string; ok: boolean; reason: string; r?: FetchResult; inconclusive?: boolean };
  const timeLeft = () => 270_000 - (Date.now() - mapStartedAt);
  const judgeUrl = async (url: string): Promise<Verdict> => {
    if (timeLeft() < 5_000) return { url, ok: false, reason: 'skipped (time budget)', inconclusive: true };
    const r = await withTimeout(fetchPage(url, crawlMethod).catch(() => null), Math.min(30_000, timeLeft()), null);
    if (pageDidNotLoad(r)) return { url, ok: false, reason: `did not load (status ${r?.status ?? 0})`, inconclusive: true };
    if (!r) return { url, ok: false, reason: 'did not load', inconclusive: true };
    const ev = pageEntityEvidence(r.body, r.url, siteEntityNames, isPersonCategory ? 'person' : 'location');
    if (ev.kind === 'listing') return { url, ok: false, reason: `listing page (${ev.entities} entities, none tied)`, r };
    const embedded = ev.kind === 'profile' ? [] : collectEmbeddedEntities(r.body).slice(0, 3);
    let v: any = null;
    try {
      v = await withTimeout(callClaudeMap(apiKey, model, entityPrompt(r, embedded), ENTITY_PAGE_TOOL, 256), Math.min(30_000, timeLeft()), null);
    } catch { return { url, ok: false, reason: 'check failed', r, inconclusive: true }; }
    if (v == null) return { url, ok: false, reason: 'check timed out', r, inconclusive: true };
    if (v?.is_entity_page !== true) {
      const why = `not an entity page: ${v?.reason ?? ''}`.slice(0, 200);
      return { url, ok: false, reason: why, r, inconclusive: INCONCLUSIVE_REASON_RE.test(String(v?.reason ?? '')) };
    }
    if (v?.fits_category !== true) return { url, ok: false, reason: `not this category: ${v?.reason ?? ''}`.slice(0, 200), r };
    const kind = v?.entity_kind === 'person' ? 'professional' : v?.entity_kind === 'business' ? 'location' : null;
    if (detailEntityType && kind && kind !== detailEntityType) return { url, ok: false, reason: `${v.entity_kind} page; the profile is ${detailEntityType}`, r };
    return { url, ok: true, reason: 'passed', r };
  };
  // Judge URLs in parallel batches until `want` conclusive verdicts (or the list runs out).
  const judgeUntil = async (urls: string[], want: number, cap: number, stopAtOk = false): Promise<Verdict[]> => {
    const out: Verdict[] = [];
    let i = 0;
    const done = () => (stopAtOk ? out.filter((v) => v.ok).length : out.filter((v) => !v.inconclusive).length) >= want;
    while (!done() && i < Math.min(urls.length, cap) && !overTime(240_000)) {
      const have = stopAtOk ? out.filter((v) => v.ok).length : out.filter((v) => !v.inconclusive).length;
      const batch = urls.slice(i, Math.min(i + Math.max(1, want - have), cap));
      i += batch.length;
      out.push(...(await Promise.all(batch.map((u) => judgeUrl(u)))));
    }
    return out;
  };
  const rulePool = [...new Set([...linkCandidates, ...sitemapPoolUrls, ...collectDetailUrls(detail.body, detail.url, LINK_CANDIDATE_CAP)])]
    .filter((u) => !rejectedTried.has(u));
  let ruleMain = buildProfileRule(detail.url, rulePool);
  // v2Led: version 2's validated profile pattern is used when it matches the accepted profile page and at least
  // 90% of the pages version 2 handed over; the form checks (extra AI page checks) are then not needed.
  let v2PatternUsed: string | null = null;
  if (v2Led && opts?.v2Led?.pattern) {
    try {
      const vre = new RegExp(opts.v2Led.pattern);
      const given = givenProfiles.length ? givenProfiles : (opts.profileUrls ?? []);
      const hit = given.length ? given.filter((u) => vre.test(u)).length / given.length : 0;
      if ((vre.test(detail.url) || (detailCandidateUrl ? vre.test(detailCandidateUrl) : false)) && hit >= 0.9) v2PatternUsed = opts.v2Led.pattern;
    } catch { v2PatternUsed = null; }
  }
  const formChecks: Array<{ pos: number; form: string; included: boolean; urls: Array<{ url: string; ok: boolean; reason: string }> }> = [];
  if (!v2PatternUsed && ruleMain.otherForms.length && !overTime(200_000)) {
    const groups = [...ruleMain.otherForms].sort((x, y) => y.urls.length - x.urls.length).slice(0, 2);
    // Fix (inconclusive pages, 2026-10-06): pages that did not load are skipped; up to 4 URLs
    // per form are tried for 2 conclusive verdicts. A form with no conclusive verdict is neither
    // added nor excluded.
    const results = await Promise.all(groups.map(async (g) => ({
      g,
      verdicts: await judgeUntil(g.urls.filter((u) => !rejectedTried.has(u)), 2, 4),
    })));
    const extra = new Set<string>();
    const failed = new Set<string>();
    for (const { g, verdicts } of results) {
      const conclusive = verdicts.filter((v) => !v.inconclusive);
      const pass = conclusive.length > 0 && conclusive.every((v) => v.ok);
      formChecks.push({ pos: g.pos, form: g.form, included: pass, urls: verdicts.map((v) => ({ url: v.url, ok: v.ok, reason: v.inconclusive ? `inconclusive: ${v.reason}` : v.reason })) });
      if (pass) extra.add(`${g.pos}:${g.form}`);
      else if (conclusive.length) failed.add(`${g.pos}:${g.form}`);
    }
    ruleMain = buildProfileRule(detail.url, rulePool, extra, failed);
  }
  // A redirect (candidate URL → longer resolved URL with the same tail): URLs seen in the short
  // form are also evidence for the long form, so the long-form rule is not built from one URL.
  let ruleAlt: ProfileRule | null = null;
  if (detailCandidateUrl && detailCandidateUrl !== detail.url) {
    ruleAlt = buildProfileRule(detailCandidateUrl, rulePool);
    try {
      const longP = new URL(detail.url).pathname.replace(/\/+$/, '');
      const shortP = new URL(detailCandidateUrl).pathname.replace(/\/+$/, '');
      if (ruleMain.thin && shortP && longP.endsWith(shortP) && longP !== shortP) {
        const extraPrefix = longP.slice(0, longP.length - shortP.length);
        const origin = new URL(detail.url).origin;
        const shortDepth = shortP.split('/').filter(Boolean).length;
        const mapped = rulePool
          .map((u) => { try { const x = new URL(u); return !x.search && x.pathname.split('/').filter(Boolean).length === shortDepth ? `${origin}${extraPrefix}${x.pathname}` : null; } catch { return null; } })
          .filter((u): u is string => !!u);
        if (mapped.length) ruleMain = buildProfileRule(detail.url, [...rulePool, ...mapped]);
      }
    } catch { /* keep the rule as built */ }
  }
  let codePattern = v2PatternUsed ?? combineRules([ruleMain.pattern ?? '', ruleAlt?.pattern ?? '']);
  const excludedNonDetail: string[] = [];
  if (codePattern && !v2PatternUsed) {
    let re: RegExp | null = null;
    try { re = new RegExp(codePattern); } catch { codePattern = null; }
    if (re) {
      for (const u of mustNotMatch) {
        const bareU = u.replace(/[?#].*$/, '');
        if (re.test(u) || re.test(bareU)) excludedNonDetail.push(bareU.replace(/^https?:\/\//, '').replace(/\/+$/, ''));
      }
      if (excludedNonDetail.length) {
        codePattern = `^(?!https?://(?:${[...new Set(excludedNonDetail)].map((x) => reEsc(x)).join('|')})/?(?:[?#]|$))` + re.source.slice(1);
      }
    }
  }
  const ruleSource: 'code' | 'ai_fallback' = codePattern ? 'code' : 'ai_fallback';
  if (codePattern) input = { ...(input ?? {}), detail_pattern: codePattern };

  const firstCheck = checkDetailPattern(input?.detail_pattern, mustMatch, mustNotMatch);
  let retried = false;
  let finalProblems = firstCheck.problems;
  if (ruleSource === 'ai_fallback' && firstCheck.problems.length > 0) {
    retried = true;
    try {
      const second = await callClaudeMap(
        apiKey,
        model,
        contractPrompt +
          `\n\nYOUR PREVIOUS detail_pattern WAS: ${input?.detail_pattern}\n` +
          `IT IS WRONG: ${firstCheck.problems.join('; ')}.\n` +
          `Return a corrected contract. detail_pattern must match every DETAIL PAGE URL above and must NOT match any of these non-detail URLs:\n` +
          `${mustNotMatch.join('\n')}\n` +
          `Prefer a pattern built from the structural feature that distinguishes profile URLs from the non-detail URLs (path depth, a fixed path segment, a dot or an id) — ` +
          `only a feature that every detail URL and the same-path links share; never narrow the variable part to the characters of one example. Avoid a bare one-word slug.`,
        CONTRACT_TOOL,
        4096,
      );
      const secondCheck = checkDetailPattern(second?.detail_pattern, mustMatch, mustNotMatch);
      if (secondCheck.ok || secondCheck.problems.length < firstCheck.problems.length) {
        input = second;
        finalProblems = secondCheck.problems;
      }
    } catch {
      // Keep the first contract when the corrective call fails.
    }
  }

  // Fix (pattern coverage, 2026-10-05): when the pattern matches under half of the same-path
  // links, one small corrective call widens it. The widened pattern is kept only if it still
  // matches every known detail page, excludes home/roster/different-path rejected pages, and
  // covers more of the same-path links. Same-path pages that failed one check are not enforced.
  let patternCoverageDiag: Record<string, unknown> | null = ruleSource === 'code'
    ? { source: 'code', pool: ruleMain.candidates, matched_before: ruleMain.matched, widened: false, thin: ruleMain.thin }
    : null;
  if (ruleSource === 'ai_fallback' && sameParentPool.length >= 5) {
    const before = patternCoverage(input?.detail_pattern, sameParentPool);
    patternCoverageDiag = { pool: before.total, matched_before: before.matched, widened: false };
    if (before.ratio < 0.5) {
      const relaxedMustNot = mustNotMatch.filter((u) => parentKey(u) !== detailParent);
      const samePathRejected = mustNotMatch.filter((u) => parentKey(u) === detailParent);
      try {
        const w = await callClaudeMap(
          apiKey,
          model,
          `Site ${domain}. detail_pattern is a regular expression that must be true for profile (detail) page URLs.\n` +
            `CURRENT detail_pattern: ${input?.detail_pattern}\n` +
            `It matches only ${before.matched} of ${before.total} links that share the detail page's path, so it is probably too narrow.\n\n` +
            `KNOWN DETAIL PAGES (must match):\n${mustMatch.join('\n')}\n\n` +
            `SAME-PATH LINKS IT DOES NOT MATCH (from the directory page and sitemaps; most are usually profiles, a few may be listing or search pages):\n${before.unmatched.slice(0, 15).join('\n')}\n\n` +
            `KNOWN NON-DETAIL PAGES (must NOT match):\n${relaxedMustNot.join('\n') || '(none)'}\n\n` +
            (samePathRejected.length
              ? `These same-path pages failed a single profile check (team or business profiles, or failed loads); they do not have to be excluded:\n${samePathRejected.join('\n')}\n\n`
              : '') +
            `Return a detail_pattern that accepts every profile URL form seen above (for example both numeric ids and name slugs), keeps the fixed host and path prefix, and still excludes the non-detail pages and obvious listing, search or utility paths.`,
          PATTERN_TOOL,
          512,
        );
        const wCheck = checkDetailPattern(w?.detail_pattern, mustMatch, relaxedMustNot);
        const after = wCheck.ok ? patternCoverage(w.detail_pattern, sameParentPool) : null;
        patternCoverageDiag.proposed = w?.detail_pattern ?? null;
        patternCoverageDiag.proposed_problems = wCheck.problems;
        if (wCheck.ok && after && after.matched > before.matched) {
          patternCoverageDiag.narrow_pattern = input?.detail_pattern ?? null;
          input = { ...(input ?? {}), detail_pattern: w.detail_pattern };
          patternCoverageDiag.widened = true;
          patternCoverageDiag.matched_after = after.matched;
          if (samePathRejected.length) patternCoverageDiag.not_enforced = samePathRejected;
        }
      } catch {
        // Keep the current pattern when the corrective call fails.
      }
    }
  }

  // ---- site contract (universal keys) ----------------------------------------
  // Step 1 — samples: accepted detail page + up to 4 more pages matching the
  // final detail_pattern (sitemap pool first, then roster links). No AI here.
  const primarySubject: PrimarySubject = detailEntityType === 'professional' ? 'person' : 'location';
  // Fix 6: time budget — past 60 s the corrective must-have call is skipped.
  let contractStartedAt = Date.now();
  const CONTRACT_BUDGET_MS = 60_000;
  let detailRe: RegExp | null = null;
  try {
    if (typeof input?.detail_pattern === 'string' && input.detail_pattern) detailRe = new RegExp(input.detail_pattern);
  } catch {
    detailRe = null;
  }
  const sampleSeen = new Set<string>([detail.url, ...(detailCandidateUrl ? [detailCandidateUrl] : [])]);
  const extraSampleUrls: string[] = [];
  // Fix (profile-page check, 2026-10-06): sample candidates exclude pages this run rejected and
  // are fetched and judged like the profile page (up to 6 judged, the first 4 that pass kept).
  // Fix (10 samples, 2026-10-06): the contract is learned from 10 accepted profile pages (the
  // profile page + 9 that pass the same page check); up to 16 candidates are judged in parallel
  // batches. Past 200 s the run falls back to 4 extra pages (5 in all), fetched without judging.
  const SAMPLE_EXTRA_WANTED = 9;
  const SAMPLE_CANDIDATES_MAX = 16;
  const sampleShort = overTime(200_000);
  const sampleTarget = sampleShort ? 4 : SAMPLE_CANDIDATES_MAX;
  // Listing navigation first (needs a real directory page): the profile links it finds on page 2
  // and on a sub-listing are sample candidates too.
  // Fix (time guard, 2026-10-06): navigation is skipped once the run is past 180 s.
  // Fix (no AI prediction, 2026-10-07): sub-listings are found from the page's own link groups,
  // not from the AI's roster_pattern.
  mark('listing navigation and samples', { detail_url: detail.url, detail_pattern: input?.detail_pattern ?? null });
  const navigation: ListingNavigation | null =
    rosterPage !== home && detailRe && overTime(180_000)
      ? { listing_url: rosterPage.url, page1_detail_links: 0, next_page: null, sub_listings: null, profile_links: [], skipped: 'time budget (run past 180 s)' }
      : rosterPage !== home && detailRe
      ? await withTimeout(
          learnNavigation(rosterPage, home.url, detailRe, null, crawlMethod).catch((e) => ({
            listing_url: rosterPage.url, page1_detail_links: 0, next_page: null, sub_listings: null, profile_links: [], skipped: `error: ${String(e).slice(0, 200)}`,
          })),
          Math.max(0, Math.min(45_000, 240_000 - (Date.now() - mapStartedAt))),
          { listing_url: rosterPage.url, page1_detail_links: 0, next_page: null, sub_listings: null, profile_links: [], skipped: 'time budget (navigation took too long)' } as ListingNavigation,
        )
      : null;
  // Route measures (moved up for step 5, 2026-10-07: they decide whether background calls are
  // captured; computed from pages and sitemaps already fetched).
  // Best route = most profiles reachable (sitemap estimate vs listing pages); sitemap on a tie
  // or when the listing reach cannot be measured. Only the best route is stored.
  const listingReach = navigation
    ? navigation.page1_detail_links * (navigation.next_page?.verified ? (navigation.next_page.max_page_seen ?? 2) : 1)
      + (navigation.sub_listings?.verified ? navigation.sub_listings.count_on_listing * navigation.sub_listings.new_detail_links : 0)
    : 0;

  // Fix (route-based mapper step 1, 2026-10-06): the same measures for every route on every run,
  // read-only (no extra fetches; counts come from pages and sitemaps this run already fetched).
  // Regression compares these numbers instead of patterns. Nothing reads this yet.
  const matchesRule = (u: string): boolean => {
    try { return !!detailRe && detailRe.test(u); } catch { return false; }
  };
  const sitemapProfileUrls = sitemapPoolUrls.filter(matchesRule).length;
  // Estimate for the profile sitemap: profile URLs per file read × files in its family; a single
  // file read in full counts as read (a file capped at the read limit is a lower bound).
  const perFile = new Map<string, number>();
  for (const u of sitemapPoolUrls) {
    if (!matchesRule(u)) continue;
    const f = fromOf.get(u);
    if (f) perFile.set(f, (perFile.get(f) ?? 0) + 1);
  }
  let sitemapEstimate = sitemapProfileUrls;
  let sitemapBasis = 'profile URLs read';
  const famFiles = [...perFile.keys()].filter((f) => sitemapFamily.has(f));
  if (famFiles.length) {
    const avg = famFiles.reduce((a, f) => a + (perFile.get(f) ?? 0), 0) / famFiles.length;
    const size = Math.max(...famFiles.map((f) => sitemapFamily.get(f) ?? 1));
    const familyEst = Math.round(avg * size);
    if (familyEst > sitemapEstimate) { sitemapEstimate = familyEst; sitemapBasis = `${famFiles.length} of ${size} files read, ${Math.round(avg)} profiles per file`; }
  }
  if ([...perFile.values()].some((n) => n >= SITEMAP_LOCS_READ)) sitemapBasis += ` (a file hit the ${SITEMAP_LOCS_READ}-URL read limit: lower bound)`;
  // ---- route-based plan step 5 (2026-10-07): background calls (XHR / fetch) ----
  // Captured only when the sitemap and listing routes reach fewer than NETWORK_TRIGGER_REACH
  // profiles, or when a dry run asks for it (force_network). The page used is the directory page,
  // or its first sub-listing when the directory page itself shows no profile links and the
  // sub-listing showed none either. Runs alongside the sample checks below; awaited before the
  // best route is chosen.
  const staticReach = Math.max(sitemapEstimate, listingReach);
  // Coverage rule: a total the site states on the directory page (or later in a background call)
  // against the best proven reach; without one, only no reach or a lower-bound reach asks for more.
  const staticLowerBound = sitemapEstimate >= listingReach && /lower bound/.test(sitemapBasis);
  const countWords = isPersonCategory ? headWords : [...headWords, ...GENERIC_PLACE_TOKENS];
  const pageStated = statedTotalInText(rosterPage.body, countWords);
  const coverageStatic = needsMoreRoutes(staticReach, staticLowerBound, pageStated?.total ?? null);
  const networkScope: 'listing' | 'sub_listing' =
    navigation?.sub_listings && !navigation.sub_listings.verified && navigation.page1_detail_links < 3 ? 'sub_listing' : 'listing';
  const networkPage: string | null =
    rosterPage === home ? null : networkScope === 'sub_listing' ? navigation!.sub_listings!.example_checked : rosterPage.url;
  const networkWhyNot: string | null =
    v2Led ? 'not needed: version 2 list route'
    : !detailRe ? 'no profile rule'
    : !networkPage ? 'no directory page (homepage used)'
    : !opts?.forceNetwork && !coverageStatic.more ? `not needed: ${coverageStatic.why}`
    : runLeft() < 60_000 ? 'time budget (under 60 s left)'
    : null;
  const networkKnown = [...new Set([
    detail.url,
    ...(searchSeed?.urls ?? []).filter(matchesRule),
    ...linkCandidates.filter(matchesRule),
    ...(navigation?.profile_links ?? []),
    ...sitemapPoolUrls.filter(matchesRule).slice(0, 50),
  ])];
  const networkDeadline = mapStartedAt + 255_000;
  const networkPromise: Promise<NetworkRouteReport> = networkWhyNot
    ? Promise.resolve({ status: 'skipped', reason: networkWhyNot } as NetworkRouteReport)
    : withTimeout(
        learnNetworkRoute({
          pageUrl: networkPage!,
          scope: networkScope,
          subListingCount: navigation?.sub_listings?.count_on_listing ?? 0,
          matches: matchesRule,
          knownProfiles: networkKnown,
          crawlMethod,
          deadlineAt: networkDeadline,
          judge: judgeUrl,
          forced: !!opts?.forceNetwork && !coverageStatic.more,
          triggerWhy: coverageStatic.why,
        }).catch((e) => ({ status: 'error', reason: String(e).slice(0, 200) } as NetworkRouteReport)),
        Math.max(1_000, networkDeadline - Date.now()),
        { status: 'skipped', reason: 'time budget (did not finish in time)' } as NetworkRouteReport,
      );
  if (detailRe) {
    // P0: links on the accepted profile page itself come last (other profiles are
    // often linked from it when the roster page was not the real directory).
    for (const u of [...sitemapPoolUrls, ...linkCandidates, ...(navigation?.profile_links ?? []), ...collectDetailUrls(detail.body, detail.url, LINK_CANDIDATE_CAP)]) {
      if (extraSampleUrls.length >= sampleTarget) break;
      if (sampleSeen.has(u) || rejectedTried.has(u)) continue;
      let hit = false;
      try { hit = detailRe.test(u); } catch { hit = false; }
      if (!hit) continue;
      sampleSeen.add(u);
      extraSampleUrls.push(u);
    }
  }
  const sampleJudged: Verdict[] = !sampleShort
    ? await judgeUntil(extraSampleUrls, SAMPLE_EXTRA_WANTED, sampleTarget, true)
    : await Promise.all(extraSampleUrls.map(async (u) => {
        const r0 = await cappedFetch(u, 30_000);
        const r = r0.ok || r0.status ? r0 : null;
        const ev = r && r.ok && r.body ? pageEntityEvidence(r.body, r.url, siteEntityNames, isPersonCategory ? 'person' : 'location') : null;
        return { url: u, ok: !!ev && ev.kind !== 'listing', reason: ev ? (ev.kind === 'listing' ? 'listing page' : 'not judged (time budget)') : 'did not load', r: r ?? undefined };
      }));
  const samples: Sample[] = [
    { url: detail.url, html: detail.body, primary: primarySubject },
    ...sampleJudged
      .filter((j) => j.ok && !!j.r && j.r.ok && j.r.body.length > 0)
      .slice(0, sampleShort ? 4 : SAMPLE_EXTRA_WANTED)
      .map((j) => ({ url: j.r!.url, html: j.r!.body, primary: primarySubject })),
  ];
  // The 60 s budget for the corrective must-have call starts once the samples are in.
  contractStartedAt = Date.now();

  // Step 2 — JSON-LD tier.
  const { fields: universalJsonldFields, firmSignatures } = buildJsonLdFields(samples, primarySubject, siteEntityNames);
  // Taxonomy keys: JSON-LD tier on the same samples.
  let taxKeys = resolveTaxonomyKeys(taxonomyRows, primarySubject);
  const allTaxKeys = taxKeys;
  const contractOpts: ApplyOptions = {
    firmSignatures,
    taxSubjects: taxonomySubjectMap(taxKeys),
    actionIds: taxonomyActionIds(taxKeys),
    logoIds: taxonomyLogoIds(taxKeys),
  };
  let taxonomyRoles: Record<string, TaxonomyRole> = {};
  let ownPageKey: string | null = null;
  const taxTypes = taxonomyTypes(taxKeys);
  const taxItemWords = taxonomyItemWords(taxKeys);
  const jsonldFields = buildTaxonomyJsonLdFields(universalJsonldFields, taxKeys, samples, siteEntityNames, contractOpts);

  // Step 3 — CSS tier (one AI call) for every id JSON-LD did not produce.
  const typedIds = (ids: string[]) => ids.map((id) => `${id} (${fieldType(id)})${FIELD_MEANINGS[id] ? ` — ${FIELD_MEANINGS[id]}` : ''}`).join('\n');
  const sampleMarkup = samples
    .slice(0, 2)
    .map((s, i) => `SAMPLE ${i + 1} — ${s.url}\n${cleanHtmlForPrompt(s, 30_000)}`)
    .join('\n\n');
  // Fix (page-specific footer values, 2026-10-22): when the header / footer differs between samples 1 and 2, sample 1's
  // header / footer is shown too, so page-specific data placed there (a branch address in the footer) can get a rule;
  // mergeCssRules keeps such a rule only when its value differs between the samples.
  const pageChromeMarkup = ((): string => {
    if (samples.length < 2) return '';
    const c1 = chromeHtmlForPrompt(samples[0], 6_000);
    const c2 = chromeHtmlForPrompt(samples[1], 6_000);
    return c1 && c1 !== c2 ? `\n\nSAMPLE 1 HEADER / FOOTER (it differs from sample 2's; parts that change between pages may hold this page's fields) — ${samples[0].url}\n${c1}` : '';
  })();
  // Fix (all samples for rule proposals, 2026-10-14): the AI saw only samples 1-2, so a field missing from those two
  // pages (a licence block, languages) was never proposed even when the other samples showed it. The other samples
  // are now summarised: text blocks whose structure (parent > element: tag, id, stable classes, itemprop) is not on
  // samples 1-2, with how many samples show them. The rules are still checked on every sample (mergeCssRules).
  const otherSamplesDigest = ((): string => {
    if (samples.length <= 2) return '';
    const sig = (e: any): string => {
      if (!e || e.type !== 'tag') return '';
      const id = e.attribs?.id && !/\d{3,}/.test(e.attribs.id) ? `#${e.attribs.id}` : '';
      const cls = String(e.attribs?.class ?? '').split(/\s+/).filter((c: string) => c && !/\d{3,}/.test(c) && c.length < 30).sort().map((c: string) => `.${c}`).join('');
      const ip = e.attribs?.itemprop ? `[itemprop=${e.attribs.itemprop}]` : '';
      return `${e.name}${id}${cls}${ip}`;
    };
    const blocks = (smp: Sample): Array<{ key: string; text: string }> => {
      const $ = docOf(smp).$ as any;
      if (!$) return [];
      const out: Array<{ key: string; text: string }> = [];
      $('body *').each((_: number, el: any) => {
        if (['script', 'style', 'noscript', 'svg', 'header', 'nav', 'footer', 'head'].includes(el.name)) return;
        if ($(el).closest('header,nav,footer,[role=navigation],[role=banner],[role=contentinfo]').length) return;
        const own = $(el).contents().filter((_i: number, n: any) => n.type === 'text').text().replace(/\s+/g, ' ').trim();
        if (!own || own.length > 300) return;
        out.push({ key: `${sig(el.parent?.parent)} > ${sig(el.parent)} > ${sig(el)}`, text: own });
      });
      return out;
    };
    const shownKeys = new Set(samples.slice(0, 2).flatMap((x) => blocks(x).map((b) => b.key)));
    const extra = new Map<string, { n: number; text: string; url: string }>();
    for (const smp of samples.slice(2)) {
      const seen = new Set<string>();
      for (const b of blocks(smp)) {
        if (shownKeys.has(b.key) || seen.has(b.key)) continue;
        seen.add(b.key);
        const e = extra.get(b.key);
        if (e) e.n++; else extra.set(b.key, { n: 1, text: b.text.slice(0, 160), url: smp.url });
      }
    }
    const lines = [...extra.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 80)
      .map(([k, e]) => `${k}  (on ${e.n} of ${samples.length - 2} other samples): "${e.text}"  — ${e.url}`);
    return lines.join('\n').slice(0, 10_000);
  })();
  // C9 brand pass input: homepage chrome + main-content head, and ONE sample's chrome.
  const homeSample: Sample = { url: home.url, html: home.body };
  const firmMarkup =
    `HOMEPAGE CHROME — ${home.url}\n${chromeHtmlForPrompt(homeSample, 12_000)}\n\n` +
    `HOMEPAGE MAIN CONTENT (head)\n${cleanHtmlForPrompt(homeSample, 6_000)}\n\n` +
    `SAMPLE 1 CHROME — ${samples[0].url}\n${chromeHtmlForPrompt(samples[0], 12_000)}`;
  // C14: shared extra-key list (this gcid first, then the most-seen keys of other gcids).
  // Fix (extra key dictionary, 2026-10-22): the defined keys (exp_field_discovery element_kind 'extra_key', one row
  // per key name across all categories, with meaning, format and subject) come first and in full; the older
  // per-category rows without a definition follow, so keys from before the dictionary are still reused.
  type ExtraKeyRow = {
    normalized: string; raw_label: string | null; gcid: string; first_source: string | null;
    definition?: string | null; value_type?: string | null; subject?: string | null; examples?: unknown;
  };
  let extraKeyRows: ExtraKeyRow[] = [];
  try {
    const [dict, own, other] = await Promise.all([
      (db as any).from('exp_field_discovery').select('normalized, raw_label, gcid, first_source, definition, value_type, subject, examples')
        .eq('element_kind', 'extra_key').limit(2000),
      db.from('exp_field_discovery').select('normalized, raw_label, gcid, first_source').eq('element_kind', 'extra_field').eq('gcid', category),
      db.from('exp_field_discovery').select('normalized, raw_label, gcid, first_source').eq('element_kind', 'extra_field').neq('gcid', category)
        .order('seen_count', { ascending: false }).limit(100),
    ]);
    const defined = ((dict.data ?? []) as ExtraKeyRow[]).filter((r) => r?.normalized);
    const definedNames = new Set(defined.map((r) => r.normalized));
    const legacy = [...((own.data ?? []) as ExtraKeyRow[]), ...((other.data ?? []) as ExtraKeyRow[])]
      .filter((r) => r?.normalized && !definedNames.has(r.normalized));
    const legacySeen = new Set<string>();
    extraKeyRows = [...defined, ...legacy.filter((r) => !legacySeen.has(r.normalized) && legacySeen.add(r.normalized))];
  } catch (e) {
    console.error('extra key list load failed', e);
  }
  const extraKeyLine = (r: ExtraKeyRow): string => {
    if (!r.definition) return `${r.normalized} — ${r.raw_label ?? ''}`;
    const ex = Array.isArray(r.examples) && r.examples.length ? ` — e.g. ${String(r.examples[0]).slice(0, 60)}` : '';
    return `${r.normalized} — ${r.definition} (${r.value_type ?? 'text'}, ${r.subject ?? '?'})${ex}`;
  };
  const extraSection =
    `\nEXTRA FIELDS\n` +
    `EXISTING EXTRA KEYS (reuse the key whenever the meaning is the same; never make a variant of an existing name): key — meaning (format, whose fact) or example label\n` +
    (extraKeyRows.length ? extraKeyRows.map(extraKeyLine).join('\n') : '(none yet)') +
    `\n- In unkeyed, list up to 20 labelled facts about this ${primarySubject} that none of the field ids or category keys cover. ` +
    `For each return label, sample, key (snake_case), match ('existing_extra' = key copied from EXISTING EXTRA KEYS; ` +
    `'taxonomy' = it is one of the category keys above, key = that slug; 'static' = it is one of the universal field ids; 'new'), ` +
    `and a rule (strategy css|label, css or label, attr, multi:true for lists). Every extra must come with a working rule (css required when strategy is css); omit facts you cannot write a rule for. ` +
    `Skip buttons, calls to action, images, navigation, legal/disclosure text and anything identical on every page of the site.\n`;
  const locatorPrompt = (ids: string[], extra = '', taxIds: string[] = [], firmIds: string[] = []) =>
    `You are writing extraction rules for ONE ${primarySubject === 'person' ? 'person' : 'location'} detail page layout on ${domain}.\n` +
    catBlock +
    `\nFIELD IDS TO LOCATE (id and value type):\n${typedIds(ids)}\n\n` +
    (allTaxKeys.length && taxIds.length
      ? `CATEGORY KEYS (roles) — every category key with its default subject (person = this professional, branch = this location/office, firm = the brand/company):\n` +
        `${taxonomyRoleLines(allTaxKeys)}\n\n` +
        `In taxonomy_roles, list ONLY keys whose correct subject differs from the default (e.g. a key that means the firm/brand but defaults to branch), ` +
        `plus at most ONE url key that means this professional's/location's own page URL on this site (role own_page_url).\n\n`
      : '') +
    (taxIds.length
      ? `CATEGORY FIELD IDS TO LOCATE (id (type) — name: description):\n` +
        `${taxonomyPromptLines(taxKeys.filter((k) => taxIds.includes(k.id)))}\n\n`
      : '') +
    (firmIds.length
      ? `FIRM IDS — locate in the SITE CHROME / HOMEPAGE below (the brand/company, not this ${primarySubject}); ` +
        `only these ids may target the header, footer or navigation:\n` +
        `${firmIds.map((id) => `${id} (${id.startsWith('tax.') ? taxTypes[id] : fieldType(id)})`).join('\n')}\n\n`
      : '') +
    `For url-type ids, point at an element with a real link attribute (href/src/content); never at button text.\n` +
    `For geo ids return both latitude and longitude, e.g. two rules with part:"latitude" and part:"longitude" (or one element holding "lat, lng").\n` +
    `For list ids: entries in separate elements are separate entries (multi:true). When ONE element lists several entries separated by commas, set split_commas:true only if each part is a complete entry on its own ("Annuities, 529 Plans", "Life & Health, Property & Casualty" as two lines of business); keep it false when the parts depend on each other ("Series 7, 63, 65").\n` +
    `For person.awards and person.education, when each entry is a block with separate parts (title, year, issuer, description, link / school, degree, year), give css for the block and item_fields with the css of each part relative to the block.\n` +
    `Return rules via the return_locator_rules tool. Each rule is either\n` +
    `  { id, strategy:"css", css:"<selector>", attr?:"content"|"href"|"src", multi?:true, part?:"latitude"|"longitude" }\n` +
    `  { id, strategy:"label", label:"<visible label text>", multi?:true }\n` +
    `Rules:\n` +
    `- Prefer itemprop / id / data-* / aria-* / semantic hooks (h1, a[href^="tel:"], a[href^="mailto:"]) and label-anchored rules.\n` +
    `- Avoid auto-generated / hashed class names.\n` +
    `- Only propose a rule when the value is visibly present on the samples.\n` +
    `- The page describes ONE ${primarySubject}; never target the site header, footer or navigation (except FIRM IDS), ` +
      `unless the part holds this page's own data that changes between pages (for example a branch address in the footer, shown under SAMPLE 1 HEADER / FOOTER).\n` +
    `- Never use the site's or firm's own name as a label.\n` +
    `- Never select by the text content itself (no :contains); select by structure (tags, classes, ids, attributes).\n` +
    extraSection +
    `- If the address is shown as one block (lines for street, city, state, ZIP), return a rule for location.address_block pointing at the element that contains the whole block.\n` +
    extra +
    `\n${sampleMarkup}` +
    pageChromeMarkup +
    (otherSamplesDigest
      ? `\n\nOTHER SAMPLES (${samples.length - 2} more pages of the same layout): text blocks they show whose structure is not on samples 1-2, ` +
        `as parent > element (tag#id.classes[itemprop]), with how many of them show it and one example. Propose rules for any field id or ` +
        `category key these blocks hold too (every rule is checked on all samples):\n${otherSamplesDigest}`
      : '') +
    (firmIds.length ? `\n\n=== SITE CHROME / HOMEPAGE (for FIRM IDS only) ===\n${firmMarkup}` : '');

  const allMissingIds = locatorTargetIds(jsonldFields, primarySubject);
  const allMissingTaxIds = taxonomyLocatorIds(jsonldFields, taxKeys);
  // C9: firm-subject category keys go to the brand-pass section.
  const firmIds = firmLocatorIds(jsonldFields, taxKeys, allMissingTaxIds);
  const firmIdSet = new Set(firmIds);
  let contractFields: Record<string, FieldSpec> = jsonldFields;
  let failedIds: string[] = [];
  // Fix (rejected rules kept, 2026-10-22): rejected fixed-field rules (rule, samples found, why), shown in unmapped.
  const rejectedRules: Record<string, RejectedRule> = {};
  let unkeyed: Array<{ label: string; sample: string }> = [];
  let extraItems: any[] = [];
  let prevContract: SiteContract | null = null;
  let lastRules: Rule[] = [];
  let firmDiagnostics: FirmDiagnostic[] = [];
  const homepageDiffers = new Set<string>();

  // C10 sticky rules: previous CSS/label rules that still validate on the new samples are kept.
  const keptIds = new Set<string>();
  {
    const prev = await loadPreviousContract(db, domain, category);
    prevContract = prev;
    const { rules: prevRules, backups } = previousContractRules(prev);
    if (prevRules.length) {
      const advTargets = new Set([...allMissingIds, ...allMissingTaxIds.filter((id) => !firmIdSet.has(id))]);
      const before = new Set(Object.keys(contractFields));
      const adv = mergeCssRules(
        contractFields, prevRules.filter((r) => advTargets.has(r.id)), samples, primarySubject, siteEntityNames, contractOpts, taxTypes, taxItemWords,
      );
      Object.assign(rejectedRules, adv.rejected);
      const firm = mergeFirmRules(adv.fields, prevRules.filter((r) => firmIdSet.has(r.id)), homeSample, samples, siteEntityNames, contractOpts, firmIds, taxTypes);
      firmDiagnostics = firm.diagnostics;
      firm.homepageDiffers.forEach((id) => homepageDiffers.add(id));
      const ruleIds = new Set(prevRules.map((r) => r.id));
      for (const id of Object.keys(firm.fields)) if (!before.has(id) && ruleIds.has(id)) keptIds.add(id);
      // Derived address parts re-derived from a kept address_block stay; only rule ids count as kept.
      contractFields = markKeptFields(firm.fields, keptIds, backups);
    }
  }
  const missingIds = allMissingIds.filter((id) => !contractFields[id]);
  const missingTaxIds = allMissingTaxIds.filter((id) => !firmIdSet.has(id) && !contractFields[id]);
  const promptFirmIds = firmIds.filter((id) => !contractFields[id]);
  if (missingIds.length > 0 || missingTaxIds.length > 0 || promptFirmIds.length > 0) {
    try {
      const loc = await callClaudeMap(apiKey, model, locatorPrompt(missingIds, '', missingTaxIds, promptFirmIds), LOCATOR_TOOL, 12288);
      lastRules = Array.isArray(loc?.rules) ? (loc.rules as Rule[]).slice(0, 120) : [];
      extraItems = Array.isArray(loc?.unkeyed) ? (loc.unkeyed as any[]).filter((u) => u && typeof u.label === 'string').slice(0, 20) : [];
      unkeyed = extraItems.map((u) => ({ label: String(u.label), sample: String(u.sample ?? '') }));
      // C1: role overrides — re-run the taxonomy JSON-LD tier for keys whose subject changed.
      const roleRes = applyTaxonomyRoles(taxKeys, loc?.taxonomy_roles, primarySubject);
      taxKeys = roleRes.keys;
      taxonomyRoles = roleRes.roles;
      ownPageKey = roleRes.ownPageKey;
      contractOpts.taxSubjects = taxonomySubjectMap(taxKeys);
      contractOpts.ownPageKey = ownPageKey;
      if (roleRes.changed.length) {
        const changed = new Set(roleRes.changed);
        const kept = Object.fromEntries(Object.entries(contractFields).filter(([id]) => !changed.has(id)));
        contractFields = buildTaxonomyJsonLdFields(kept, taxKeys.filter((k) => changed.has(k.id)), samples, siteEntityNames, contractOpts);
      }
      const advisorRules = lastRules.filter((r) => !firmIdSet.has(r?.id));
      const firmRules = lastRules.filter((r) => firmIdSet.has(r?.id));
      const merged = mergeCssRules(contractFields, advisorRules, samples, primarySubject, siteEntityNames, contractOpts, taxTypes, taxItemWords);
      Object.assign(rejectedRules, merged.rejected);
      contractFields = merged.fields;
      failedIds = merged.failed;
      // C9 brand pass: firm rules must be identical on the homepage and every sample that has them.
      const firmMerged = mergeFirmRules(contractFields, firmRules, homeSample, samples, siteEntityNames, contractOpts, firmIds, taxTypes);
      contractFields = firmMerged.fields;
      failedIds = [...failedIds, ...firmMerged.failed].filter((id) => !contractFields[id]);
      firmDiagnostics = [...firmDiagnostics, ...firmMerged.diagnostics];
      firmMerged.homepageDiffers.forEach((id) => homepageDiffers.add(id));
    } catch {
      // Locator call failure leaves the JSON-LD fields; must-have check below decides.
    }
  }

  // C14: extra fields — provisional keys before validation; C14c: final key decided by the matching call.
  const extraDropped: ExtraDropped[] = [];
  let extraFields: Record<string, ExtraFieldSpec> = {};
  const stickyKeys = new Set<string>();
  // Staging schema step 2: static ids with no page rule yet, and extra → static route candidates (by extra key).
  // Ids an extra may feed: no page rule yet, or a list id (lists merge every source).
  const openStaticIds = new Set(allFieldIds(primarySubject).filter((id) => isRouteTarget(id) && (!contractFields[id] || isMergeableId(id))));
  const routeCands: Record<string, ExtraRouteCandidate> = {};
  const aiStaticKeys = new Set<string>();
  try {
    // Staging schema v1: static = every section-3 key (person static keys + location + firm keys).
    const universalNames = new Set<string>([...PERSON_IDENTITY_KEYS, ...Object.keys(LOCATION_KEYS), ...Object.keys(FIRM_KEYS)]);
    const taxSlugs = new Set(allTaxKeys.map((k) => k.slug));
    type Cand = { key: string; label: string; rule: Rule; key_source: ExtraFieldSpec['key_source']; sample: string };
    const cands: Cand[] = [];
    // Sticky: previous extra rules come first so a still-valid rule is kept (key kept, no matching).
    // C14b: only when the previous spec stored the AI sample (re-checked below).
    for (const r of previousContractRules(prevContract).rules) {
      if (!r.id.startsWith(EXTRA_PREFIX)) continue;
      const key = r.id.slice(EXTRA_PREFIX.length);
      const pf = prevContract?.extra_fields?.[key];
      if (!pf?.sample) continue;
      stickyKeys.add(key);
      cands.push({ key, label: pf?.label ?? key, rule: r, key_source: pf?.key_source ?? 'new', sample: pf.sample });
    }
    for (const [sid, list] of Object.entries(prevContract?.static_routes ?? {})) {
      for (const route of Array.isArray(list) ? list : []) {
        if (route?.kind === 'extra' && stickyKeys.has(route.from) && openStaticIds.has(sid)) {
          routeCands[route.from] = { static_id: sid, source: 'sticky', ...(route.reason ? { reason: route.reason } : {}) };
        }
      }
    }
    for (const it of extraItems) {
      const label = String(it.label ?? '').trim();
      const key = normalizeExtraKey(String(it.key || label));
      if (!key) continue;
      if (it.match === 'static' || isStaticExtraKey(key, universalNames)) {
        // Step 2: kept when it names an open static id (route by name), or when the AI calls it static
        // but the key is not a static name and open ids exist (the matching call may route it).
        const target = staticTargetForKey(key, openStaticIds, primarySubject);
        if (target) routeCands[key] = { static_id: target, source: 'name' };
        else if (isStaticExtraKey(key, universalNames) || !openStaticIds.size) { extraDropped.push({ label, key, reason: 'static' }); continue; }
        else aiStaticKeys.add(key);
      }
      if (it.match === 'taxonomy' || taxSlugs.has(key)) {
        extraDropped.push({ label, key, reason: 'taxonomy', match: taxSlugs.has(key) ? key : undefined });
        continue;
      }
      const rule: Rule = {
        id: '', strategy: it.strategy === 'label' ? 'label' : 'css',
        ...(it.css ? { css: String(it.css) } : {}),
        ...(it.strategy === 'label' ? { label } : {}),
        ...(it.attr ? { attr: it.attr } : {}),
        ...(it.multi ? { multi: true } : {}),
        ...(it.split_commas ? { split_commas: true } : {}),
      };
      // C14c: incomplete rules are dropped.
      if ((rule.strategy === 'css' && !rule.css) || (rule.strategy === 'label' && !rule.label)) {
        const { id: _omit, ...diagRule } = rule;
        extraDropped.push({ label, key, reason: 'rule_failed_validation', rule: diagRule, found: 0, samples: samples.length });
        continue;
      }
      if (stickyKeys.has(key)) continue; // sticky rule for this key already present
      cands.push({ key, label, rule, key_source: 'new', sample: String(it.sample ?? '') });
    }
    const extraMeta: Record<string, { label: string; key_source: ExtraFieldSpec['key_source']; sample?: string }> = {};
    const extraRules: Rule[] = [];
    const extraTypes: Record<string, FieldType> = {};
    for (const c of cands) {
      if (extraMeta[c.key]) continue; // two items with the same key: keep the first
      extraMeta[c.key] = { label: c.label, key_source: c.key_source, sample: c.sample };
      const id = EXTRA_PREFIX + c.key;
      extraRules.push({ ...c.rule, id });
      extraTypes[id] = c.rule.multi ? 'list' : c.rule.attr === 'href' || c.rule.attr === 'src' ? 'url' : 'text';
    }
    if (extraRules.length) {
      const merged = mergeCssRules(contractFields, extraRules, samples, primarySubject, siteEntityNames, contractOpts, extraTypes);
      const ruleById = new Map(extraRules.map((r) => [r.id, r]));
      const diagOf = (id: string): Omit<Rule, 'id'> | undefined => {
        const r = ruleById.get(id);
        if (!r) return undefined;
        const { id: _omit, ...rest } = r;
        return rest;
      };
      for (const [id, reason] of Object.entries(merged.extraReasons)) {
        const key = id.slice(EXTRA_PREFIX.length);
        extraDropped.push({
          label: extraMeta[key]?.label ?? key, key, reason,
          rule: diagOf(id),
          found: merged.extraFound[id] ?? 0,
          samples: samples.length,
        });
      }
      const extrasOnly: Record<string, FieldSpec> = Object.fromEntries(Object.entries(merged.fields).filter(([id]) => id.startsWith(EXTRA_PREFIX)));
      // C14b: one list = one container, then the sample agreement check on the samples shown to the AI.
      const shownDocs = samples.slice(0, 2).map((s) => docOf(s));
      for (const [id, f] of Object.entries(extrasOnly)) {
        const key = id.slice(EXTRA_PREFIX.length);
        const aiSample = extraMeta[key]?.sample ?? '';
        let spec: FieldSpec = f;
        const loc = f.locator as any;
        if (loc?.tier === 'css' && loc.multi) spec = { ...f, locator: chooseExtraContainer(loc, shownDocs, aiSample) };
        const one = { extra_fields: { [key]: { ...spec, label: '', key_source: 'new' as const } } };
        const shown = samples.slice(0, 2).map((s, i) => applyExtraFields(shownDocs[i], s.url, one, siteEntityNames, contractOpts)[key]);
        if (!extraSampleAgrees(aiSample, shown)) {
          extraDropped.push({
            label: extraMeta[key]?.label ?? key, key, reason: 'sample_mismatch',
            rule: diagOf(id), found: merged.extraFound[id] ?? 0, samples: samples.length,
          });
          delete extrasOnly[id];
          continue;
        }
        extrasOnly[id] = spec;
      }
      const probe = { extra_fields: Object.fromEntries(Object.entries(extrasOnly).map(([id, f]) => [
        id.slice(EXTRA_PREFIX.length), { ...f, label: '', key_source: 'new' as const },
      ])) };
      const perSample = samples.map((s) => applyExtraFields(docOf(s), s.url, probe, siteEntityNames, contractOpts));
      const fin = finalizeExtraFields({ ...contractFields, ...extrasOnly }, extraMeta, perSample, samples.length);
      contractFields = fin.fields;
      extraFields = fin.extra_fields;
      extraDropped.push(...fin.dropped);
    }
    // C14c: key matching by the LLM on real example values (new, non-sticky extras only).
    const newKeys = Object.keys(extraFields).filter((k) => !stickyKeys.has(k) && routeCands[k]?.source !== 'name');
    const listKeys = new Set(extraKeyRows.map((r) => r.normalized));
    const matchOf: Record<string, { match: string | null; reason: string }> = {};
    let matched = false;
    const openForMatch = [...openStaticIds].filter((id) => isMergeableId(id) || !Object.values(routeCands).some((c) => c.static_id === id));
    // Extras kept from the previous contract keep their key, but may still be routed to a static id.
    const stickyForStatic = Object.keys(extraFields).filter((k) => stickyKeys.has(k) && !routeCands[k]);
    // Extra key dictionary (2026-10-22): the call also defines every new key, so it runs whenever there are new keys.
    const defOf: Record<string, { definition: string; value_type: ExtraValueType; subject: ExtraSubject } | undefined> = {};
    const newNameOf: Record<string, string | null> = {};
    if (newKeys.length || (stickyForStatic.length && openForMatch.length)) {
      try {
        const doms = [...new Set(extraKeyRows.map((r) => r.first_source).filter((d): d is string => !!d))];
        const exByDom = new Map<string, Array<{ category_slug: string; extra_fields: any }>>();
        if (doms.length) {
          const { data: cRows } = await (db as any)
            .from('disco_site_contract')
            .select('domain, category_slug, extra_fields:extraction->site_contract->extra_fields')
            .in('domain', doms);
          for (const cr of (cRows ?? []) as any[]) {
            const arr = exByDom.get(cr.domain) ?? [];
            arr.push({ category_slug: cr.category_slug, extra_fields: cr.extra_fields });
            exByDom.set(cr.domain, arr);
          }
        }
        const existing = extraKeyRows.map((r) => {
          const arr = exByDom.get(r.first_source ?? '') ?? [];
          const hit = arr.find((c) => c.category_slug === r.gcid && c.extra_fields?.[r.normalized])
            ?? arr.find((c) => c.extra_fields?.[r.normalized]);
          const spec = hit?.extra_fields?.[r.normalized];
          const dictExamples = Array.isArray(r.examples) ? (r.examples as unknown[]).slice(0, 3) : [];
          return {
            key: r.normalized,
            label: String(spec?.label ?? r.raw_label ?? ''),
            ...(r.definition ? { meaning: r.definition, format: r.value_type, whose: r.subject } : {}),
            examples: dictExamples.length ? dictExamples : Array.isArray(spec?.examples) ? spec.examples.slice(0, 3) : [],
            category: r.gcid,
          };
        });
        const news = [
          ...newKeys.map((k) => ({ key: k, label: extraFields[k].label, examples: extraFields[k].examples ?? [] })),
          ...stickyForStatic.map((k) => ({ key: k, label: extraFields[k].label, examples: extraFields[k].examples ?? [], keep_key: true })),
        ];
        const prompt =
          `You match newly found extra facts from a website to an existing shared list of extra keys.\n` +
          `NEW EXTRAS (key, label, example values):\n${JSON.stringify(news)}\n\n` +
          `EXISTING KEYS (key, label, example values, category):\n${JSON.stringify(existing)}\n\n` +
          (openForMatch.length
            ? `STATIC IDS (fixed profile fields; list ids collect several extras, e.g. "Products" and "Services" both → person.services; id (type) — meaning):\n` +
              `${openForMatch.map((id) => `${id} (${fieldType(id)})${FIELD_MEANINGS[id] ? ` — ${FIELD_MEANINGS[id]}` : ''}`).join('\n')}\n\n`
            : '') +
          `For each new extra decide whether it holds the same kind of information as an existing key ` +
          `(same meaning, judged by the example values, not by wording). Answer for every new extra with ` +
          `{ key, match: <existing key> | null, static_id: <open static id> | null, reason: <one short sentence> }. ` +
          `static_id only when the example values are exactly what that static id means (e.g. a list of focus areas → person.services); otherwise null. ` +
          `Two new extras must not map to the same existing key, nor to the same non-list static id. ` +
          `For extras marked keep_key, answer match: null; only static_id may be set.\n` +
          `For every new extra with match: null (not keep_key), also give definition (one generic sentence saying what the value ` +
          `means, not tied to this site), value_type (one of ${EXTRA_VALUE_TYPES.join(', ')}) and subject (${EXTRA_SUBJECTS.join(', ')}). ` +
          `If its key is already an EXISTING key name but the meaning differs, give new_key: a different descriptive snake_case ` +
          `name that is not in the existing list; never add numbers to make a name unique.`;
        const out = await callClaudeMap(apiKey, model, prompt, MATCH_EXTRA_TOOL, 2048);
        const used = new Set<string>();
        const usedStatic = new Set<string>();
        for (const m of (Array.isArray(out?.matches) ? out.matches : []) as any[]) {
          const k = String(m?.key ?? '');
          if (stickyForStatic.includes(k)) {
            const sid0 = m?.static_id ? String(m.static_id) : null;
            if (sid0 && openForMatch.includes(sid0) && (isMergeableId(sid0) || !usedStatic.has(sid0)) && !routeCands[k]) {
              usedStatic.add(sid0);
              routeCands[k] = { static_id: sid0, source: 'sticky', reason: String(m?.reason ?? '').slice(0, 300) };
            }
            continue;
          }
          if (!newKeys.includes(k) || matchOf[k]) continue;
          let target = m?.match ? String(m.match) : null;
          if (target && (!listKeys.has(target) || used.has(target) || (target !== k && extraFields[target]))) target = null;
          if (target) used.add(target);
          matchOf[k] = { match: target, reason: String(m?.reason ?? '').slice(0, 300) };
          if (!target) {
            const vt = (EXTRA_VALUE_TYPES as readonly string[]).includes(String(m?.value_type)) ? (m.value_type as ExtraValueType) : null;
            const sj = (EXTRA_SUBJECTS as readonly string[]).includes(String(m?.subject)) ? (m.subject as ExtraSubject) : null;
            const df = typeof m?.definition === 'string' ? m.definition.trim().slice(0, 300) : '';
            if (df && vt && sj) defOf[k] = { definition: df, value_type: vt, subject: sj };
            newNameOf[k] = m?.new_key ? normalizeExtraKey(String(m.new_key)) : null;
          }
          const sid = m?.static_id ? String(m.static_id) : null;
          if (sid && openForMatch.includes(sid) && (isMergeableId(sid) || !usedStatic.has(sid))) {
            usedStatic.add(sid);
            routeCands[k] = { static_id: sid, source: 'match', reason: String(m?.reason ?? '').slice(0, 300) };
          }
        }
        matched = true;
      } catch (e) {
        console.error('extra key matching failed', e);
      }
    }
    const renamed: Record<string, ExtraFieldSpec> = {};
    const renamedFrom: Record<string, string> = {};
    for (const [k, spec] of Object.entries(extraFields)) {
      if (stickyKeys.has(k) || routeCands[k]?.source === 'name') { if (!renamed[k]) renamed[k] = spec; continue; }
      // Called static by the locator call but not routed to an open static id: dropped as before.
      if (aiStaticKeys.has(k) && !routeCands[k]) { extraDropped.push({ label: spec.label, key: k, reason: 'static' }); continue; }
      let key = k;
      let src: ExtraFieldSpec['key_source'] = 'new';
      const m = matchOf[k];
      if (matched) {
        if (m?.match) { key = m.match; src = 'existing_extra'; }
        else if (listKeys.has(k) || (/_\d+$/.test(k) && listKeys.has(k.replace(/_\d+$/, '')))) {
          // Fix (extra key dictionary, 2026-10-22): a taken name with a different meaning gets the AI's new
          // descriptive name, checked against the list, static names and category keys; no number suffixes
          // (they produced keys like office_phone_direct_2_2 for "Fax Number"). No valid name: dropped.
          const nk = newNameOf[k] ?? '';
          const ok = !!nk && !/_\d+$/.test(nk) && !listKeys.has(nk) && !extraFields[nk] && !renamed[nk]
            && !isStaticExtraKey(nk, universalNames) && !taxSlugs.has(nk);
          if (!ok) { extraDropped.push({ label: spec.label, key: k, reason: 'name_conflict', ...(nk ? { match: nk } : {}) }); continue; }
          key = nk;
        }
      } else if (listKeys.has(k)) {
        src = 'existing_extra'; // fallback: exact key equality only
      }
      if (renamed[key]) continue;
      const def = src === 'new' ? defOf[k] : undefined;
      renamed[key] = { ...spec, key_source: src, ...(m?.reason ? { match_reason: m.reason } : {}), ...(def ?? {}) };
      if (key !== k) renamedFrom[k] = key;
    }
    for (const [from, to] of Object.entries(renamedFrom)) {
      if (routeCands[from] && !routeCands[to]) { routeCands[to] = routeCands[from]; delete routeCands[from]; }
    }
    // Registry slugs (any gcid) only for keys that are still new — one query.
    const pendingKeys = Object.entries(renamed).filter(([k, s]) => !stickyKeys.has(k) && s.key_source === 'new').map(([k]) => k);
    if (pendingKeys.length) {
      const { data: reg } = await db.from('exp_vertical_node_registry').select('node_slug').in('node_slug', pendingKeys).limit(50);
      for (const row of (reg ?? []) as Array<{ node_slug: string }>) {
        if (renamed[row.node_slug]) renamed[row.node_slug].key_source = 'registry_slug';
      }
    }
    extraFields = renamed;
  } catch (e) {
    console.error('extra fields step failed', e);
  }
  contractFields = addTaxonomyAliases(contractFields, taxKeys);
  let contract = finalizeSiteContract({
    fields: contractFields, failed: failedIds, samples, primary: primarySubject, siteEntityNames, unkeyed, opts: contractOpts,
    taxonomy: taxKeys, rejectedRules,
  });

  // Step 4 — must-haves, one corrective call.
  const overBudget = Date.now() - contractStartedAt > CONTRACT_BUDGET_MS;
  if (!contract.must_have.ok && !overBudget) {
    const mhIds = contract.must_have.missing
      .flatMap((l) => mustHaveIds(l, primarySubject))
      .filter((id) => allFieldIds(primarySubject).includes(id));
    const failedForThem = lastRules.filter((r) => mhIds.includes(r?.id));
    try {
      const loc = await callClaudeMap(
        apiKey,
        model,
        locatorPrompt(
          mhIds,
          `\nTHESE ARE REQUIRED FIELDS THAT ARE STILL MISSING. Previous rules for them failed validation on the samples:\n` +
            `${JSON.stringify(failedForThem)}\nPropose different rules.\n`,
        ),
        LOCATOR_TOOL,
        8192,
      );
      const rules = Array.isArray(loc?.rules) ? (loc.rules as Rule[]).slice(0, 120) : [];
      const merged = mergeCssRules(contractFields, rules.filter((r) => !firmIdSet.has(r?.id)), samples, primarySubject, siteEntityNames, contractOpts, taxTypes, taxItemWords);
      Object.assign(rejectedRules, merged.rejected);
      contractFields = addTaxonomyAliases(merged.fields, taxKeys);
      failedIds = [...new Set([...failedIds, ...merged.failed])].filter((id) => !merged.fields[id]);
      contract = finalizeSiteContract({
        fields: contractFields, failed: failedIds, samples, primary: primarySubject, siteEntityNames, unkeyed, opts: contractOpts,
    taxonomy: taxKeys, rejectedRules,
      });
    } catch {
      // fall through to the must-have error below
    }
  }
  if (!contract.must_have.ok) {
    throw new MapSiteError('must-have fields not found: ' + contract.must_have.missing.join(', '), {
      tried,
      sitemap_trace: sitemapTrace,
      site_contract: contract,
      detail_url: detail.url,
    });
  }

  const firmProfile: FirmProfile = {
    ...buildFirmProfile(
      { fields: contract.fields, taxonomy_fields: contract.taxonomy_fields, own_page_key: ownPageKey },
      homeSample, samples, siteEntityNames, contractOpts, homepageDiffers,
    ),
    diagnostics: firmDiagnostics.slice(0, FIRM_DIAGNOSTICS_CAP),
  };
  const rulesKept = [...keptIds].filter((id) =>
    id.startsWith('tax.') ? !!contract.taxonomy_fields?.[id.slice(4)] : !!contract.fields[id]).length;

  const profileSrc = fromOf.get(detail.url) ?? (detailCandidateUrl ? fromOf.get(detailCandidateUrl) : undefined);
  const profileSitemaps: string[] = profileSrc
    ? [isShardSitemap(profileSrc) && parentOf.get(profileSrc) ? parentOf.get(profileSrc)! : profileSrc]
    : [];

  // Staging schema step 2: routes for static ids the page rules do not fill (applied at harvest).
  let staticRoutes: ReturnType<typeof buildStaticRoutes> = { routes: {}, dropped: [] };
  try {
    const routeProbe = { extra_fields: extraFields };
    staticRoutes = buildStaticRoutes({
      fields: contract.fields,
      taxonomyFields: contract.taxonomy_fields ?? {},
      taxKeys,
      primary: primarySubject,
      extraFields,
      extraCandidates: routeCands,
      extraValues: samples.map((s: Sample) => applyExtraFields(docOf(s), s.url, routeProbe, siteEntityNames, contractOpts)),
      sampleUrls: samples.map((s: Sample) => s.url),
    });
  } catch (e) {
    console.error('static routes step failed', e);
  }
  const finalSiteContract = {
    ...contract,
    taxonomy_roles: taxonomyRoles,
    own_page_key: ownPageKey,
    site_entity_names: [...siteEntityNames],
    firm_signatures: [...firmSignatures].slice(0, 50),
    firm_profile: firmProfile,
    extra_fields: extraFields,
    extra_dropped: extraDropped.slice(0, EXTRA_DROPPED_CAP),
    static_routes: staticRoutes.routes,
    static_routes_dropped: staticRoutes.dropped,
    boilerplate_values: {} as Record<string, string[]>,
    sitewide_actions: {} as Record<string, string[]>,
    sitewide_media: {} as Record<string, string[]>,
    media_scan: true,
  };
  // Staging schema step 3: the primary subject's description text, identical on most
  // sample pages (2+ pages, 60%+ of the pages that have it), is boilerplate, not a bio.
  try {
    const bpId = primarySubject === 'person' ? 'person.bio' : 'location.description';
    const bpNames = new Set(finalSiteContract.site_entity_names);
    const bpSigs = new Set(finalSiteContract.firm_signatures);
    const texts = samples
      .map((s: Sample) => applyContractS4(s.html, s.url, finalSiteContract as any, bpNames, { firmSignatures: bpSigs }).values[bpId])
      .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0);
    const counts = new Map<string, number>();
    for (const t of texts) counts.set(boilerplateKey(t), (counts.get(boilerplateKey(t)) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] && top[1] >= 2 && top[1] / texts.length >= 0.6) finalSiteContract.boilerplate_values[bpId] = [top[0]];
  } catch (e) {
    console.error('boilerplate check failed', e);
  }
  // Staging schema: a call-to-action (same text and link) on 2+ sample pages and 60%+ of all
  // samples belongs to the site, not to this person / office.
  try {
    const saNames = new Set(finalSiteContract.site_entity_names);
    const saSigs = new Set(finalSiteContract.firm_signatures);
    const perSample = samples.map((s: Sample) => applyContractS4(s.html, s.url, finalSiteContract as any, saNames, { firmSignatures: saSigs }).values);
    for (const sid of ['person.actions', 'location.actions']) {
      const counts = new Map<string, number>();
      for (const v of perSample) {
        const keys = new Set<string>();
        for (const item of Array.isArray(v[sid]) ? (v[sid] as unknown[]) : []) {
          const a = typeof item === 'string' ? decodeAction(item) : null;
          if (a) keys.add(actionKey(a.label, a.url));
        }
        for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const need = Math.max(2, Math.ceil(0.6 * samples.length));
      const site = [...counts.entries()].filter(([, n]) => n >= need).map(([k]) => k).slice(0, 50);
      if (site.length) finalSiteContract.sitewide_actions[sid] = site;
    }
    // Videos / gallery images on 2+ sample pages and 60%+ of all samples are site media.
    for (const sid of ['person.videos', 'location.videos', 'person.gallery', 'location.gallery']) {
      const counts = new Map<string, number>();
      for (const [i, v] of perSample.entries()) {
        const urls = new Set<string>();
        for (const item of Array.isArray(v[sid]) ? (v[sid] as unknown[]) : []) {
          const raw = item && typeof item === 'object' ? String((item as any).url ?? '') : String(item ?? '');
          if (sid.endsWith('.videos')) { const vv = videoFromUrl(raw, samples[i].url); if (vv) urls.add(vv.url); }
          else if (raw) urls.add(raw.replace(/^http:/, 'https:'));
        }
        for (const u of urls) counts.set(u, (counts.get(u) ?? 0) + 1);
      }
      const need = Math.max(2, Math.ceil(0.6 * samples.length));
      const site = [...counts.entries()].filter(([, n]) => n >= need).map(([u]) => u).slice(0, 50);
      if (site.length) finalSiteContract.sitewide_media[sid] = site;
    }
  } catch (e) {
    console.error('site-wide actions check failed', e);
  }
  // S4-1: measured field floor — apply the final contract to every sample exactly
  // as the harvest does; the floor is the richest sample's distinct field count.
  const floorNames = new Set(finalSiteContract.site_entity_names);
  const floorSigs = new Set(finalSiteContract.firm_signatures);
  const fieldFloorPerSample = samples.map((s: Sample) => {
    const { values } = applyContractS4(s.html, s.url, finalSiteContract as any, floorNames, { firmSignatures: floorSigs });
    // Step 3: counted exactly as the harvest writes it (routes, formats, quality rules).
    const ex = applyExtraFields(docOf(s), s.url, finalSiteContract as any, floorNames, { firmSignatures: floorSigs });
    const filled = applyAddressOwnerS4(values, finalSiteContract as any);
    const st = buildStagingStatic({ contract: finalSiteContract as any, values: filled, extras: ex, pageUrl: s.url });
    return countStagingFields(st.universal, filled);
  });
  const fieldFloorMeasured = fieldFloorPerSample.length ? Math.max(...fieldFloorPerSample) : 0;
  const fieldFloorAi = Number(input?.field_floor ?? 0);
  // ---- route-based plan step 3 (2026-10-07): listing pattern and best route, from evidence ----
  // roster_pattern is built by code from the listing pages actually used (directory URL, its
  // page-number template, a proven sub-listing pattern); the AI's roster_pattern is not used.
  const rosterParts: string[] = [];
  if (rosterPage !== home) {
    try {
      const lu = new URL(rosterPage.url);
      rosterParts.push(`https?://${reEsc(lu.host)}${reEsc(lu.pathname.replace(/\/+$/, ''))}/?(?:[?#].*)?`);
    } catch { /* ignore */ }
    const tpl = navigation?.next_page?.verified ? navigation.next_page.template : null;
    if (tpl) rosterParts.push(reEsc(tpl).replace('\\{n\\}', '\\d+').replace(/^https?:/, 'https?:'));
    if (navigation?.sub_listings?.verified) rosterParts.push(navigation.sub_listings.pattern.replace(/^\^/, '').replace(/\$$/, ''));
  }
  let codeRosterPattern: string | null = rosterParts.length ? `^(?:${rosterParts.join('|')})$` : null;
  if (codeRosterPattern) {
    try {
      const rre = new RegExp(codeRosterPattern);
      if (samples.some((x) => rre.test(x.url))) codeRosterPattern = rosterParts.length > 1 ? `^(?:${rosterParts[0]})$` : null;
    } catch { codeRosterPattern = null; }
  }
  const staticBest: { route: 'sitemap' | 'listing' | 'none'; reach_estimate: number; basis: string } =
    sitemapEstimate === 0 && listingReach === 0
      ? { route: 'none', reach_estimate: 0, basis: 'no route measured' }
      : sitemapEstimate >= listingReach
      ? { route: 'sitemap', reach_estimate: sitemapEstimate, basis: `sitemap: ${sitemapBasis}` }
      : { route: 'listing', reach_estimate: listingReach, basis: navigation?.next_page?.verified
          ? `listing: ${navigation.page1_detail_links} per page × ${navigation.next_page.max_page_seen ?? 2} pages${navigation.sub_listings?.verified ? ' + sub-listings' : ''}`
          : `listing: ${navigation?.page1_detail_links ?? 0} on the directory page${navigation?.sub_listings?.verified ? ' + sub-listings' : ''}` };
  // Step 5: a proven background-call route is the best route when it reaches more profiles; only
  // the best route is stored (with the call, its paging and proof when it is the network call).
  const networkRoute = await networkPromise;
  const networkReach = networkRoute.status === 'proven' && networkRoute.route ? networkRoute.reach_estimate ?? 0 : 0;
  // ---- route-based plan step 6 (2026-10-07): search inputs ----
  // Tried when the coverage rule still asks for more after the network-call route (or a dry run
  // sends force_search) and the directory page has a search box; at least 120 s must be left.
  const bestSoFar = Math.max(staticBest.reach_estimate, networkReach);
  const statedAll = Math.max(pageStated?.total ?? 0, networkRoute.route?.total ?? 0) || null;
  const coverageSearch = needsMoreRoutes(bestSoFar, networkReach <= staticBest.reach_estimate && staticLowerBound, statedAll);
  let searchBoxes = findSearchInputs(rosterPage.body, rosterPage.url);
  let searchPageUrl = rosterPage.url;
  if (!searchBoxes.length && rosterPage !== home) { searchBoxes = findSearchInputs(home.body, home.url); searchPageUrl = home.url; }
  const searchDeadline = mapStartedAt + 262_000;
  const searchWhyNot: string | null =
    v2Led ? 'not needed: version 2 list route'
    : !detailRe ? 'no profile rule'
    : !searchBoxes.length ? 'no search box on the directory page or homepage'
    : !opts?.forceSearch && !coverageSearch.more ? `not needed: ${coverageSearch.why}`
    // Fix (search time floor, 2026-10-08): 120 s also when forced; with less the search is left to
    // the phase-2 call (routes_deferred) instead of trying one value (elliman.com dry run 2651).
    : searchDeadline - Date.now() < 120_000 ? `time budget (${Math.round((searchDeadline - Date.now()) / 1000)} s left)`
    : null;
  const searchRoute: SearchRouteReport = searchWhyNot
    ? { status: 'skipped', reason: searchWhyNot, ...(searchBoxes.length ? { boxes: searchBoxes.map((b) => ({ label: b.label, kinds: b.kinds, form: b.form ? `${b.form.method} ${b.form.action}` : null })) } : {}) }
    : await withTimeout(
        learnSearchRoute({
          db,
          pageUrl: searchPageUrl,
          pageHtml: searchPageUrl === rosterPage.url ? rosterPage.body : home.body,
          boxes: searchBoxes,
          detailRe: detailRe!,
          knownProfiles: networkKnown,
          categoryWords: countWords,
          crawlMethod,
          deadlineAt: searchDeadline,
          trigger: opts?.forceSearch && !coverageSearch.more ? `forced (dry run); ${coverageSearch.why}` : coverageSearch.why,
        }).catch((e) => ({ status: 'error', reason: String(e).slice(0, 200) } as SearchRouteReport)),
        Math.max(1_000, searchDeadline - Date.now()),
        { status: 'skipped', reason: 'time budget (did not finish in time)' } as SearchRouteReport,
      );
  const searchReach = searchRoute.status === 'proven' && searchRoute.route ? searchRoute.reach_estimate ?? 0 : 0;
  const bestRoute: {
    route: 'sitemap' | 'listing' | 'network_call' | 'search_input' | 'none';
    reach_estimate: number;
    basis: string;
    network_call?: NetworkRoute;
    search_input?: NonNullable<SearchRouteReport['route']>;
  } =
    searchReach > Math.max(staticBest.reach_estimate, networkReach)
      ? { route: 'search_input', reach_estimate: searchReach, basis: `search inputs: ${searchRoute.basis ?? ''}`, search_input: searchRoute.route! }
      : networkReach > staticBest.reach_estimate
      ? { route: 'network_call', reach_estimate: networkReach, basis: `network call: ${networkRoute.basis ?? ''}`, network_call: networkRoute.route! }
      : staticBest;
  const listingProfileLinks = rosterPage !== home ? linkCandidates.filter(matchesRule).length : 0;
  mark('report');
  const routeReport = {
    ...(v2Led ? { fields_only: { v2_led: true, homepage_loaded: !homeMissing, v2_pattern_used: !!v2PatternUsed,
      skipped: ['subdomain robots.txt', 'sitemap walk', 'directory page', 'listing navigation', 'profile-rule form checks', 'background-call capture', 'search route'] } } : {}),
    ai_temperature: 'model default (temperature not supported)',
    run_ms: Date.now() - mapStartedAt,
    sitemaps: {
      docs_read: sitemapTrace.filter((t) => t.kind !== 'error').length,
      urls_read: sitemapPoolUrls.length,
      profile_urls_seen: sitemapProfileUrls,
      profile_urls_estimate: sitemapEstimate,
      estimate_basis: sitemapBasis,
      profile_sitemaps: profileSitemaps,
      note: `at most ${SITEMAP_LOCS_READ} URLs read per sitemap file and ${SITEMAP_MAX_FETCHES} files per run`,
    },
    listing: rosterPage !== home
      ? {
          listing_url: rosterPage.url,
          profile_links_on_page: listingProfileLinks,
          next_page: navigation?.next_page
            ? { how: navigation.next_page.how, template: navigation.next_page.template, max_page_seen: navigation.next_page.max_page_seen, new_profiles: navigation.next_page.new_detail_links, proven: navigation.next_page.verified }
            : null,
          sub_listings: navigation?.sub_listings
            ? { count: navigation.sub_listings.count_on_listing, new_profiles: navigation.sub_listings.new_detail_links, proven: navigation.sub_listings.verified }
            : null,
        }
      : { listing_url: null, note: 'no directory page found; homepage used' },
    embedded: {
      profile_urls_on_listing: embeddedRosterUrls.length,
      records_on_profile_page: collectEmbeddedEntities(detail.body).length,
    },
    best_route: bestRoute,
    listing_reach_estimate: listingReach,
    network_calls: networkRoute,
    search_inputs: searchRoute,
    ...(searchSeed ? { search_seed: searchSeed.report } : {}),
    // Second-call support (dry runs): when a route step was cut short by time, this run's evidence
    // is returned so { dry_run, phase: 'routes', state: routes_state } can finish the two route steps.
    routes_deferred: [networkRoute, searchRoute].some((r) => r.status === 'skipped' && /^time budget/.test(r.reason)),
    routes_state: {
      domain,
      category,
      crawl_method: crawlMethod,
      detail_pattern: input?.detail_pattern ?? null,
      person: isPersonCategory,
      count_words: countWords,
      known_profiles: networkKnown.slice(0, 60),
      network_page: networkPage,
      scope: networkScope,
      sub_listing_count: navigation?.sub_listings?.count_on_listing ?? 0,
      search_pages: [...new Set([rosterPage.url, home.url])],
      static: { route: staticBest.route, reach: staticBest.reach_estimate, lower_bound: staticLowerBound, basis: staticBest.basis },
      stated_total: pageStated?.total ?? null,
    },
    stated_total: statedAll ? { total: statedAll, page_text: pageStated?.snippet ?? null } : null,
    profile_rule: {
      source: ruleSource,
      candidates: ruleSource === 'code' ? ruleMain.candidates : null,
      thin_evidence: ruleSource === 'code' ? ruleMain.thin : null,
      fixed_segments: ruleSource === 'code' ? ruleMain.fixed : null,
      forms: ruleSource === 'code' ? ruleMain.forms : null,
      form_checks: formChecks,
      redirect_form: ruleAlt?.pattern ?? null,
      excluded_non_profile_urls: excludedNonDetail,
      sample_checks: sampleJudged.map((j) => ({ url: j.url, ok: j.ok, reason: j.inconclusive ? `inconclusive: ${j.reason}` : j.reason })),
      pattern: input?.detail_pattern ?? null,
      same_path_links: patternCoverageDiag?.pool ?? null,
      matched: patternCoverageDiag?.widened ? patternCoverageDiag?.matched_after ?? null : patternCoverageDiag?.matched_before ?? null,
      known_problems: finalProblems,
    },
    samples: {
      target: sampleShort ? 5 : SAMPLE_EXTRA_WANTED + 1,
      fetched: samples.length,
      must_have_ok: contract.must_have.ok,
      fields: Object.keys(contract.fields).length,
      field_floor: fieldFloorMeasured,
    },
  };

  return {
    // v2Led: no roster pattern (version 2's list route replaces the roster crawl).
    roster_pattern: v2Led ? null : codeRosterPattern,
    detail_pattern: input?.detail_pattern ?? null,
    field_floor: fieldFloorMeasured,
    extraction: {
      ...(input?.extraction ?? { list_source: 'none' }),
      site_contract: finalSiteContract,
      ...(navigation ? { navigation } : {}),
      best_route: bestRoute,
    },
    site_contract_summary: {
      fields: Object.keys(contract.fields).length,
      must_have_ok: contract.must_have.ok,
      unmapped: contract.unmapped.length,
      unkeyed: contract.unkeyed.length,
      samples: contract.samples.length,
      taxonomy_fields: Object.keys(contract.taxonomy_fields ?? {}).length,
      taxonomy_candidates: contract.taxonomy_candidates ?? 0,
      taxonomy_duplicates: (contract.taxonomy_duplicates ?? []).length,
      firm_profile_fields: Object.keys(firmProfile.values).length,
      rules_kept: rulesKept,
      extra_fields: Object.keys(extraFields).length,
      extra_new: Object.values(extraFields).filter((f) => f.key_source === 'new').length,
      field_floor_ai: fieldFloorAi,
      field_floor_measured: fieldFloorMeasured,
      field_floor_per_sample: fieldFloorPerSample,
    },
    route_report: routeReport,
    sample_roster_url: rosterPage.url,
    sample_detail_url: detail.url,
    sitemap_trace: sitemapTrace,
    profile_sitemaps: profileSitemaps,
    subdomain_robots: subdomainRobots,
    detail_pattern_check: {
      must_match: mustMatch,
      must_not_match: mustNotMatch,
      first_problems: firstCheck.problems,
      retried,
      final_problems: finalProblems,
      ...(ambiguousSamePath.length ? { same_path_other_kind: ambiguousSamePath } : {}),
      ...(patternCoverageDiag ? { coverage: patternCoverageDiag } : {}),
    },
    ...(retry ? { self_heal: { from_host: retry.host, roster_url: retry.rosterUrl, reason: retry.reason } } : {}),
    ...(hintsDiag ? { mapper_hints: hintsDiag } : {}),
    listing_navigation: navigation
      ? {
          page1_detail_links: navigation.page1_detail_links,
          next_page: navigation.next_page ? `${navigation.next_page.how}: +${navigation.next_page.new_detail_links}${navigation.next_page.verified ? ' (verified)' : ''}` : null,
          sub_listings: navigation.sub_listings ? `${navigation.sub_listings.source} x${navigation.sub_listings.count_on_listing}: +${navigation.sub_listings.new_detail_links}${navigation.sub_listings.verified ? ' (verified)' : ''}` : null,
          ...(navigation.skipped ? { skipped: navigation.skipped } : {}),
        }
      : { skipped: rosterPage === home ? 'no directory page (homepage used)' : 'no detail pattern' },
    embedded_roster_urls: embeddedRosterUrls.length,
    embedded_detail_records: collectEmbeddedEntities(detail.body).length,
    detail_entity_type: detailEntityType,
    detail_entity_type_source: detailEntityTypeSource,
  };
}

// ============================================================================
// drain loop
// ============================================================================
async function drain(request: Request): Promise<Response> {
  const workerKey = process.env['DISCO_WORKER_KEY'];
  if (!workerKey || request.headers.get('x-disco-worker-key') !== workerKey) {
    return new Response('Unauthorized', { status: 401 });
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }
  const model = process.env['DISCO_MODEL'] ?? DEFAULT_MODEL;

  // Dry run (regression tests, 2026-10-05): body { dry_run: true, domain, category, crawl_method? }
  // runs mapSite with the current code and returns the contract it would produce. No request
  // row is read or updated, no ingest function is called and nothing is written to any table
  // (mapSite itself only reads).
  const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
  // Second call of a dry run (step 6 follow-up): only the network-call and search routes, from the
  // routes_state a first dry run returned. Read-only.
  if (body?.dry_run === true && body.phase === 'routes' && body.state && typeof body.state === 'object') {
    const startedAt = Date.now();
    try {
      const out = await runDeferredRoutes(body.state as RoutesState, { forceNetwork: body.force_network === true, forceSearch: body.force_search === true });
      return Response.json({ dry_run: true, phase: 'routes', ok: true, ms: Date.now() - startedAt, ...out });
    } catch (e) {
      return Response.json({ dry_run: true, phase: 'routes', ok: false, ms: Date.now() - startedAt, error: String(e) });
    }
  }
  // Detail route dry run (2026-10-14): body { dry_run: true, phase: 'detail', domain, category, profile_urls } checks the
  // site's own profile API and learns its JSON field map; returns the result (pass it back as body.detail on a
  // version 1 dry run with v2_pattern to see the record source). Read-only.
  if (body?.dry_run === true && body.phase === 'detail') {
    const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const urls = Array.isArray(body.profile_urls) ? (body.profile_urls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 60) : [];
    if (!domain || !category || !urls.length) return Response.json({ dry_run: true, phase: 'detail', ok: false, error: 'domain, category and profile_urls required' }, { status: 400 });
    const detail = await runDetailRoute(apiKey, model, category, domain, urls);
    return Response.json({ dry_run: true, phase: 'detail', ok: true, domain, category, detail });
  }
  if (body?.dry_run === true) {
    const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (!domain || !category) return Response.json({ dry_run: true, ok: false, error: 'domain and category required' }, { status: 400 });
    const crawlMethod: CrawlMethod =
      body.crawl_method === 'needs_js_api' ? 'needs_js_api' : body.crawl_method === 'needs_proxy' ? 'needs_proxy' : 'server_crawl';
    const startedAt = Date.now();
    try {
      // force_network (dry runs only): capture background calls even when other routes suffice.
      // profile_urls (dry runs only): profile pages found by site mapper version 2, used first.
      const profileUrls = Array.isArray(body.profile_urls) ? (body.profile_urls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 60) : [];
      // G1: engine 'v2' runs the Map path (version 2 list discovery, then version 1 field learning); still a dry run.
      const contract = body.engine === 'v2'
        ? (await mapWithV2(apiKey, model, category, domain, undefined, crawlMethod, { startUrl: typeof body.start_url === 'string' ? body.start_url : undefined, profileUrls, forceNetwork: body.force_network === true, forceSearch: body.force_search === true })).contract
        // Fields-only test (2026-10-14): v2_pattern with profile_urls runs version 1 the way the live map does after
        // version 2 (fields only, version 2's profile pattern).
        : await mapSiteWithLimit(apiKey, model, category, domain, undefined, crawlMethod, { forceNetwork: body.force_network === true, forceSearch: body.force_search === true, profileUrls,
            v2Led: typeof body.v2_pattern === 'string' && profileUrls.length ? { pattern: body.v2_pattern } : undefined });
      if (body.detail && typeof body.detail === 'object' && body.engine !== 'v2') attachDetailRoute(contract as Record<string, any>, body.detail as DetailRouteResult);
      return Response.json({ dry_run: true, ok: true, domain, category, ms: Date.now() - startedAt, contract });
    } catch (e) {
      return Response.json({
        dry_run: true, ok: false, domain, category, ms: Date.now() - startedAt,
        error: String(e), diagnostics: (e as any)?.diagnostics ?? null,
      });
    }
  }

  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

  const { data: reqs, error } = await supabaseAdmin
    .from('disco_llm_requests')
    .select('request_id, job_id, tool, prompt_input, response')
    .eq('status', 'pending')
    .limit(BATCH);
  if (error) return Response.json({ error: `query error: ${error.message}` }, { status: 500 });

  const results: any[] = [];
  for (const r of reqs ?? []) {
    // Fix (ETL AI cost log, 2026-10-22): the request runs inside a cost context; its AI calls are written to
    // exp_etl_cost_events when it ends. The early exits after one map step are returns (the loop still stops below).
    const rIn = ((r.prompt_input ?? {}) as any);
    await withCostContext({
      db: supabaseAdmin, activity: ACTIVITY_BY_REQUEST_TOOL[r.tool] ?? String(r.tool),
      gcid: rIn.category ?? null, domain: rIn.domain ?? null, request_id: r.request_id, job_id: (r as any).job_id ?? null,
    }, async () => {
      // Fix (keep version 2 / profile API on failure, 2026-10-15): the map's earlier step results stay on the request
      // when the version 1 step fails, so they can be read (and reused) instead of being overwritten by the error.
      let mapCarry: { v2: unknown; detail: unknown } | null = null;
      try {
        await supabaseAdmin
          .from('disco_llm_requests')
          .update({ status: 'sent' })
          .eq('request_id', r.request_id);

        const input = (r.prompt_input ?? {}) as any;
        const category: string | undefined = input.category;
        const domain: string | undefined = input.domain;
        let boundary: Boundary | undefined = input.boundary ?? undefined;
        const complexity: string | undefined = input.complexity ?? undefined;
        const crawlMethod: CrawlMethod =
          input.crawl_method === 'needs_js_api'
            ? 'needs_js_api'
            : input.crawl_method === 'needs_proxy'
              ? 'needs_proxy'
              : 'server_crawl';

        if (r.tool === 'discover_companies') {
          if (!category) throw new Error('prompt_input.category missing');
          // DR-3: source discovery — brand sites first, then directories; domains
          // already seen for this category are excluded so reruns return new sites.
          // Fix (generated category boundaries, 2026-10-16): a category without a boundary gets one generated first
          // (-disco-boundary.ts: grounded in our category list, generic, never overwrites an authored one), so discovery
          // always runs with a definition. A failure is logged and discovery runs as before.
          if (!boundary?.definition) {
            try {
              const g = await generateCategoryBoundary(supabaseAdmin, model, category,
                (prompt, tool) => callClaude(apiKey, model, prompt, tool, 2048));
              if (g.boundary?.definition) boundary = g.boundary as Boundary;
            } catch (e) { console.error('boundary generation failed', String(e)); }
          }
          const ctx = await loadDiscoverContext(supabaseAdmin, category, complexity, boundary);
          const sources = await discoverSources(apiKey, model, ctx);
          // governed write: quarantine only, human confirms next
          const { error: rpcErr } = await supabaseAdmin.rpc('disco_discover_ingest', {
            p_request_id: r.request_id,
            p_companies: noNul(sources) as any,
          });
          if (rpcErr) throw new Error(rpcErr.message);
          results.push({ request_id: r.request_id, discovered: sources.length });
        } else if (r.tool === 'classify_method') {
          if (!domain) throw new Error('prompt_input.domain missing');
          const { method, evidence, fetch_tier } = await classifyMethod(
            apiKey,
            model,
            domain,
            category ?? '',
            boundary,
          );
          const { error: rpcErr } = await supabaseAdmin.rpc('disco_method_ingest', {
            p_request_id: r.request_id,
            p_domain: domain,
            p_method: method,
            p_evidence: noNul(evidence),
            p_fetch_tier: fetch_tier,
          });
          if (rpcErr) throw new Error(rpcErr.message);
          results.push({ request_id: r.request_id, domain, method, evidence });
        } else if (r.tool === 'map_site') {
          if (!domain) throw new Error('prompt_input.domain missing');
          // Fix (map in steps, 2026-10-14): a map runs over several worker calls so no call holds the shared pg_net
          // queue for long. Version 2 runs in steps of up to V2_STEP_MS (state saved in response.v2_state, request back
          // to 'pending'); when it finishes, its result is saved (response.v2) and the next call runs version 1 field
          // learning (V1_STEP_LIMIT_MS) and the save path below. prompt_input.v1_only = version 1 alone in one call.
          const startUrl = typeof input.start_url === 'string' ? input.start_url : undefined;
          const prev = ((r as any).response && typeof (r as any).response === 'object' ? (r as any).response : {}) as Record<string, any>;
          let v2Done: V2Research | null | undefined = undefined;
          let detailDone: DetailRouteResult | null = null;
          if (input.v1_only !== true) {
            if (prev.map_step === 'v1') {
              v2Done = (prev.v2 ?? null) as V2Research | null;
              detailDone = (prev.detail ?? null) as DetailRouteResult | null;
            } else if (prev.map_step === 'detail') {
              // Detail route step (2026-10-14): the site's own profile API and its JSON field map.
              const v2r = (prev.v2 ?? null) as V2Research | null;
              const detail = await runDetailRoute(apiKey, model, category ?? '', domain, v2r?.profile_urls ?? []);
              const { error: dErr } = await supabaseAdmin.from('disco_llm_requests')
                .update({ status: 'pending', response: noNul({ map_step: 'v1', v2: v2r, detail, updated_at: new Date().toISOString() }) as any }).eq('request_id', r.request_id);
              if (dErr) throw new Error(`map step save failed: ${dErr.message}`);
              results.push({ request_id: r.request_id, domain, map_step: 'v1', detail_api: detail.probe.status, json_fields: detail.json ? Object.keys(detail.json.fields).length : 0 });
              return; // one map step per worker call (the loop stops below)
            } else {
              let step: Awaited<ReturnType<typeof runV2Step>>;
              try {
                const budget = Number(process.env['DISCO_V2_BUDGET'] ?? 3) || 3;
                step = await runV2Step(apiKey, { domain, category: category ?? '', start_url: startUrl, budget, state: prev.map_step === 'v2' ? prev.v2_state : undefined });
              } catch (e) {
                step = { status: 'done', research: { outcome: 'failed', reason: null, config: null, profile_urls: [], sample_pool: 0, cost_usd: 0, active_seconds: 0, coverage: {}, coverage_justification: null, flags: null, error: String((e as Error)?.message ?? e).slice(0, 300), log: [] } };
              }
              const next = step.status === 'continue'
                ? { map_step: 'v2', v2_state: step.state, v2_progress: { calls: step.calls, turns: step.turns, active_seconds: step.active_seconds, cost_usd: step.cost_usd, log: step.log }, updated_at: new Date().toISOString() }
                : { map_step: step.research.config && step.research.profile_urls.length ? 'detail' : 'v1', v2: step.research, updated_at: new Date().toISOString() };
              const { error: stepErr } = await supabaseAdmin.from('disco_llm_requests')
                .update({ status: 'pending', response: noNul(next) as any }).eq('request_id', r.request_id);
              if (stepErr) throw new Error(`map step save failed: ${stepErr.message}`);
              results.push({ request_id: r.request_id, domain, map_step: next.map_step, ...(step.status === 'continue' ? { v2_calls: step.calls } : { v2_outcome: step.research.outcome }) });
              return; // one map step per worker call (the loop stops below)
            }
          }
          if (v2Done !== undefined) mapCarry = { v2: v2Done, detail: detailDone };
          const { contract } = await mapWithV2(apiKey, model, category ?? '', domain, boundary, crawlMethod, {
            v1Only: input.v1_only === true, startUrl, v2: v2Done, v1LimitMs: V1_STEP_LIMIT_MS, detail: detailDone,
          });
          if (contract.outcome === 'no_profiles_on_site') {
            const evidence = contract.evidence as Record<string, unknown>;
            const { error: npErr } = await supabaseAdmin.rpc('disco_map_site_no_profiles' as any, {
              p_request_id: r.request_id,
              p_evidence: noNul(evidence) as any,
            });
            if (npErr) throw new Error(`no_profiles_on_site rejected: ${npErr.message}`);
            results.push({
              request_id: r.request_id,
              domain,
              outcome: 'no_profiles_on_site',
              where_profiles_live: evidence?.where_profiles_live ?? null,
            });
            return; // Fix 10: one map_site per worker call (the loop stops below)
          }
          // Fix (combine list routes, 2026-10-14): the saved contract's proven list sources are carried into this result.
          try { await mergeSavedListRoute(supabaseAdmin, domain, category ?? '', contract as Record<string, any>); }
          catch (e) { console.error('list route merge failed', String(e)); }
          // Fix (save rule, 2026-10-07): a working saved contract is never replaced by a worse one.
          const saveCheck = await savedContractCheck(supabaseAdmin, domain, category ?? '', contract as any, crawlMethod);
          // G2 (save rule D1, 2026-10-13): only a site's FIRST contract saves itself, and only when it passes the
          // required-fields check. Every other map result becomes a pending proposal (disco_proposals, state
          // 'pending') that a person accepts or rejects in the site contract panel; the comparison above is kept
          // as advice (save_check.compare_reason). Replaces the G1 active-source guard (an active source always
          // has a contract, so its remaps are proposals too).
          const firstContract = saveCheck.saved === null;
          if (!firstContract || !saveCheck.fresh.must_have_ok) {
            const { data: srcRow } = await (supabaseAdmin as any).from('exp_etl_sources').select('status')
              .eq('source_domain', domain).eq('gcid', category ?? '').limit(1).maybeSingle();
            (saveCheck as any).compare_reason = saveCheck.reason;
            (saveCheck as any).compare_save = saveCheck.save;
            saveCheck.save = false;
            saveCheck.reason = firstContract
              ? 'first contract, but the required fields are not met: kept as a proposal for review'
              : `kept as a proposal for review (source ${srcRow?.status ?? 'unknown'}; comparison: ${(saveCheck as any).compare_reason})`;
          }
          (contract as any).save_check = saveCheck;
          if (!saveCheck.save) {
            // G2: the result is stored as a pending proposal for the review panel. Earlier pending proposals of the
            // same site + category stay until a person decides (Accept closes the others).
            const { error: propErr } = await (supabaseAdmin as any).from('disco_proposals').insert({
              job_id: (r as any).job_id ?? null, category_slug: category ?? '', kind: 'site_map', state: 'pending',
              payload: noNul({ ...(contract as any), domain: domain.toLowerCase(), request_id: r.request_id, proposed_at: new Date().toISOString() }),
            });
            if (propErr) console.error('proposal insert failed', propErr.message);
            const { error: keepErr } = await supabaseAdmin
              .from('disco_llm_requests')
              .update({ status: 'completed', response: noNul({ kept_existing_contract: true, save_check: saveCheck, new_contract: contract }) as any })
              .eq('request_id', r.request_id);
            if (keepErr) throw new Error(`keep-existing update failed: ${keepErr.message}`);
            const { error: ckErr } = await supabaseAdmin.rpc('disco_check_method_complete' as any, { p_cat: category ?? '' });
            if (ckErr) console.error('disco_check_method_complete failed', ckErr.message);
            results.push({ request_id: r.request_id, domain, outcome: 'kept_existing_contract', reason: saveCheck.reason });
            return; // Fix 10: one map_site per worker call (the loop stops below)
          }
          // The RPC rejects detail_pattern-less or field_floor < 5 contracts.
          const { error: rpcErr } = await supabaseAdmin.rpc('disco_map_site_ingest', {
            p_request_id: r.request_id,
            p_contract: noNul(contract) as any,
          });
          if (rpcErr) throw new Error(`contract rejected: ${rpcErr.message}`);
          // C14 / C14b / C14c: shared extra-key list for the category (moved to -disco-extra-keys.ts for G2, so an
          // Accept in the review panel refreshes it the same way). Failures are logged, never fail the map.
          await refreshExtraKeys(supabaseAdmin, category ?? '', domain,
            ((contract as any)?.extraction?.site_contract?.extra_fields ?? {}) as Record<string, ExtraFieldSpec>);
          results.push({
            request_id: r.request_id,
            domain,
            crawl_method: crawlMethod,
            rendered_fetch_possible: crawlMethod === 'needs_js_api',
            detail_pattern: contract.detail_pattern,
            field_floor: contract.field_floor,
          });
        } else {
          throw new Error(`tool not yet implemented: ${r.tool}`);
        }
      } catch (e) {
        await supabaseAdmin
          .from('disco_llm_requests')
          .update({ status: 'error', response: noNul({ error: String(e), ...((e as any)?.diagnostics ?? {}), ...(mapCarry ? { map_step: 'failed_v1', v2: mapCarry.v2, detail: mapCarry.detail } : {}) }) as any })
          .eq('request_id', r.request_id);
        results.push({ request_id: r.request_id, error: String(e) });
      }
    });
    // Fix 10: one map_site request per worker call — remaining rows stay
    // pending (never marked 'sent') and are picked up by the next tick.
    if (r.tool === 'map_site') break;
  }

  return Response.json({ model, pending_picked: reqs?.length ?? 0, processed: results });
}

export const Route = createFileRoute('/api/public/disco-ai-worker')({
  server: {
    handlers: {
      POST: ({ request }) => drain(request),
    },
  },
});
