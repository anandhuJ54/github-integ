/*
 * NORA interview step 2 — "organize the internet", SOURCE layer types.
 *
 * The source layer fetches and parses; it never decides what a fact means for a category
 * and never writes the graph (the category-aware extractor does both). Everything here is a
 * CANDIDATE: raw, provenance-tagged, possibly wrong.
 */

export type SameAsLink = {
  url: string;
  /** Platform label from SAMEAS_PLATFORM_RULES (sameas-domain-classifier.ts); null = unrecognised. */
  platform: string | null;
  /** Where the link was found. */
  via: "jsonld_sameAs" | "page_link";
};

export type CredentialCandidate = {
  text: string;
  /** toCredential (site contract) — designation / license / registration with parsed parts. */
  parsed: { type: string; name?: string; number?: string; issuer?: string; state?: string } | null;
  /** classifyCredential label when the text names a known authority/credential. */
  label: string | null;
  via: "jsonld_hasCredential" | "page_text";
};

export type OwnedCandidate = {
  url: string;
  reason: "jsonld_sameAs" | "name_domain_match" | "brand_domain_match";
};

export type TextBlock = { kind: "title" | "meta" | "heading" | "paragraph"; text: string };

export type CandidateFacts = {
  source_url: string;
  /** Final URL after redirects, when known. */
  resolved_url: string | null;
  fetched_at: string;
  /** Every @type-carrying JSON-LD object (embedded app-state entities included), page entity first. */
  jsonld: Record<string, unknown>[];
  nap: {
    name: string | null;
    address: {
      text: string;
      streetAddress?: string;
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
    } | null;
    /** E.164 when parseable. */
    phone: string | null;
    /** Where each NAP part came from. */
    source: { name: string | null; address: string | null; phone: string | null };
  };
  /** Google place id seen on the page (Maps / review links), for the GBP lookup. */
  place_id: string | null;
  sameAs: SameAsLink[];
  credentials: CredentialCandidate[];
  links: { internal: string[]; ownedCandidates: OwnedCandidate[] };
  /** Visible text for the extractor (title, meta, headings, paragraphs), capped. */
  text: TextBlock[];
  /** True when looksBlocked() judged the response an anti-bot / empty page. */
  blocked: boolean;
};

/** Cost declaration every organize handler returns (outputs.telemetry). */
export type ProviderCost = {
  provider: "oxylabs" | "google_places" | "apify" | "direct";
  requests: number;
  /** List-rate estimate in USD; see costs.ts. */
  est_cost_usd: number;
  note?: string;
};
