// ============================================================================
// hasCredential domain classifier — Batch 1 + Batch 2 (2026-09-24)
//
// BATCH 2 ADDITIONS
// Two different sources, not just the freq 3-7 frequency list:
//
// (a) Financial-advisor credentials, added EXPLICITLY regardless of their
// registry-wide frequency ranking. These are the exact fields from
// request_id=29 that started this whole investigation (cfp_certification,
// cfa_credential, chfc_designation, finra_series_65_license, series_66_license,
// sec_ria_registration_number, etc.). Checked why they weren't in Batch 1:
// tokens like "cfp"/"cfa"/"finra"/"ria" barely register in a registry-wide
// count because financial credentials are concentrated in a handful of
// finance gcids out of 4,000 -- they dilute into the "freq < 3" long tail
// even though they're clearly important. The frequency-tiered approach
// optimizes for broad cross-gcid coverage, which quietly buries a narrow
// but important vertical. Added here on purpose, by domain knowledge, not
// by frequency rank.
//
// (b) A curated pull from the freq 3-7 tier (2,301 tokens total): only the
// clear, safe, reusable ones (real-estate/property associations,
// cybersecurity certifications, AKC). The freq 3-7 tier as a whole is far
// more fragmented than sameAs's Batch 2 ever was -- almost entirely
// one-off tokens (medical specialties, craft/hobby brands, manufacturer-
// authorized-dealer programs, hyper-niche regional credentials), each
// appearing only 3-7 times across the ENTIRE registry. Hand-authoring a
// precise rule for each of those thousands of tokens is not a good use of
// effort relative to what it buys -- the LLM fallback already handles them
// adequately. Deliberately NOT attempting exhaustive coverage of this tier;
// only the clearly safe, well-evidenced picks below were added.
//
// WHY THIS FILE EXISTS
// disco_llm_requests request_id=29 (edwardjones.com, gcid:financial_advisor)
// showed the exact same collapse bug we already fixed for sameAs, but for
// hasCredential: 14 distinct registry fields (aif_certification,
// cfp_certification, cfp_designation, chfc_designation,
// finra_series_65_license, series_65_license, series_66_license,
// state_ria_registration, etc.) all mapped onto the single JSON-LD property
// "hasCredential". A plain key-name match can't tell them apart, because
// hasCredential is a multi-value property -- a page can list several
// different credentials at once.
//
// SCOPE OF THIS BATCH
// Checked hasCredential usage across the WHOLE registry, not just
// financial_advisor: 43,035 active rows, 30,252 distinct node_slugs, 4,000
// gcids. Token-frequency analysis (tuned stoplist removing structural words
// like certification/credential/license/compliance/status/record/etc.):
//   freq >= 8:  1,722 distinct tokens, ~82% of all occurrences
//   freq 3-7:   2,301 more tokens, ~10% more (cumulative ~92%)
//   freq < 3:   5,493 tokens, ~8%, long tail -- NOT reviewed
// This batch covers the freq >= 8 tier.
//
// KEY DESIGN DIFFERENCE FROM sameAs
// sameAs values are URLs -- verifiable against a domain. hasCredential
// values are free text (a credential/license name, sometimes a license
// number), so matching is done on the TEXT of the credential, not a URL.
// Existing real data (RE/MAX, State Farm pilots, read from exp_entity/
// graph_nodes) confirms the convention: a match is stored as the literal
// text found on the page ("ABR", "CA-6010131", "FINRA BrokerCheck"), never
// a boolean. This file follows that convention: a match returns the actual
// matched string, not true/false.
//
// AUTHORITY-LEVEL, NOT STANDARD-NUMBER-LEVEL (agreed with the user)
// Some bodies (ASTM, ANSI, ISO) issue hundreds of distinct numbered
// standards (ASTM alone has 260+ distinct registry fields, one per standard
// number: astm_f1749, astm_d6400, astm_c1036, astm_f24, ...). Building one
// hand-written rule per exact standard number would be its own multi-week
// effort and often can't match anyway unless the page states that exact
// number. Instead, for these three bodies, the classifier extracts the
// standard number directly out of the registry slug (e.g. "f1749" from
// astm_f1749_product_certification) and builds the text match from that
// number dynamically -- one rule definition covers every number that body
// issues, without sacrificing precision (a field asking about ASTM F1749
// only matches page text that actually says "ASTM F1749", not just any
// ASTM mention). A slug that names the body with no specific number (e.g.
// "astm_compliance_certification") falls back to a generic "any mention of
// this body" match for that rule only.
//
// DELIBERATELY SKIPPED (same discipline as sameAs Batch 1/2: no guessing)
// - Bare structural/domain words with no single identifiable issuing body:
//   safety, training, health, business, insurance, board, manager, first,
//   medical, master, school, plan, law, letter, trade, vehicle, repair,
//   zoning, occupancy, fire (alone) -- these describe a CATEGORY of
//   credential, not a specific verifiable one. A rule on "safety" alone
//   would match almost anything and defeat the purpose.
// - "ADA" restricted to accessibility-compliance context (accessib*,
//   compliance, title II/III, transition plan, ADA-compliant). The rare
//   dental-board usage ("ada_board_certification_in_prosthodontics") is
//   NOT covered -- too ambiguous to guess from the slug alone, left to the
//   LLM fallback.
// - "ACE" (fitness) skipped as its own rule -- "ace" is too common an
//   English-adjacent token to trust without much stronger context than seen
//   so far; NASM and AFAA (less ambiguous strings) are included.
// - Long tail (freq < 3, ~5,966 tokens, ~13% of usage) -- not reviewed yet,
//   same as sameAs's long tail.
//
// This file makes no network calls and reads no database.
// ============================================================================

export interface CredentialClassification {
  /** false = slug not recognized; caller should fall through to the LLM fallback. */
  recognized: boolean;
  /**
   * The literal credential text found on the page, if any. null with
   * recognized=true means: we know exactly which credential this field
   * wants, and this page's own credential values positively do NOT include
   * it -- a confident, deterministic "not found", not a gap for the LLM.
   */
  value: string | null;
  /** Human label for the recognized authority/credential, when recognized. */
  label?: string;
}

interface CredentialAuthorityRule {
  label: string;
  /** Tested against the registry node_slug + node_name, lowercased, underscores/hyphens turned to spaces. */
  slugTest: RegExp;
  /** Tested against each candidate credential text found on the page. */
  nameTest: RegExp;
}

interface DynamicStandardRule {
  /** Does the raw (lowercased, underscore-preserved) slug mention this standards body at all? */
  bodyTest: RegExp;
  /** Pull the specific standard number/code out of the raw slug, if the slug names one. */
  extractCode: (rawSlug: string) => string | null;
  /** Build the text match for one specific extracted code. */
  buildNameTest: (code: string) => RegExp;
  label: (code: string) => string;
  /** Used when the body is named but no specific code is present in the slug. */
  genericNameTest: RegExp;
  genericLabel: string;
}

// ---- dynamic numbered-standard bodies (ASTM, ANSI, ISO) --------------------
// One rule definition each covers every standard number that body issues,
// instead of hundreds of hand-written per-number rules.
const DYNAMIC_STANDARD_RULES: DynamicStandardRule[] = [
  {
    bodyTest: /\bastm\b/,
    extractCode: (s) => s.match(/astm[_-]+([a-z]?\d+(?:-\d+)?)/)?.[1] ?? null,
    buildNameTest: (code) => new RegExp(`astm[\\s-]*${code}\\b`, 'i'),
    label: (code) => `ASTM ${code.toUpperCase()}`,
    genericNameTest: /\bastm\b/i,
    genericLabel: 'ASTM (general)',
  },
  {
    bodyTest: /\bansi\b/,
    extractCode: (s) => s.match(/ansi[_-]+([a-z]?\d+(?:\.\d+)?)/)?.[1] ?? null,
    buildNameTest: (code) => new RegExp(`ansi[\\s-]*${code}\\b`, 'i'),
    label: (code) => `ANSI ${code.toUpperCase()}`,
    genericNameTest: /\bansi\b/i,
    genericLabel: 'ANSI (general)',
  },
  {
    bodyTest: /\biso\b/,
    extractCode: (s) => s.match(/iso[_-]+(\d{4,6})/)?.[1] ?? null,
    buildNameTest: (code) => new RegExp(`iso[\\s-]*${code}\\b`, 'i'),
    label: (code) => `ISO ${code}`,
    genericNameTest: /\biso\b/i,
    genericLabel: 'ISO certification (general)',
  },
  // Batch 2: FINRA Series exams (6, 7, 63, 65, 66, 24, 26, 31, ...) -- the
  // slug names the specific series number (finra_series_65_license,
  // series_66_license), so one dynamic rule covers every series number
  // rather than a separate hand-written rule per number.
  {
    bodyTest: /\bseries\b|\bfinra\b/,
    extractCode: (s) => s.match(/series[\s_-]?(\d{1,3})(?!\d)/)?.[1] ?? null,
    buildNameTest: (code) => new RegExp(`series[\\s-]*${code}\\b`, 'i'),
    label: (code) => `FINRA Series ${code}`,
    genericNameTest: /\bfinra\b/i,
    genericLabel: 'FINRA (general)',
  },
];

// ---- static authority-level rules (freq >= 8 tier) -------------------------
const CREDENTIAL_AUTHORITY_RULES: CredentialAuthorityRule[] = [
  // --- federal / regulatory agencies ---
  { label: 'OSHA', slugTest: /\bosha\b/, nameTest: /\bosha\b/i },
  { label: 'EPA', slugTest: /\bepa\b/, nameTest: /\bepa\b|environmental protection agency/i },
  { label: 'USDA', slugTest: /\busda\b/, nameTest: /\busda\b|u\.?s\.? department of agriculture/i },
  { label: 'FDA', slugTest: /\bfda\b/, nameTest: /\bfda\b|food and drug administration/i },
  { label: 'CPSC', slugTest: /\bcpsc\b/, nameTest: /\bcpsc\b|consumer product safety commission/i },
  { label: 'FTC', slugTest: /\bftc\b/, nameTest: /\bftc\b|federal trade commission/i },
  {
    label: 'IRS 501(c)(3) tax-exempt status',
    slugTest: /501c3|501\(c\)\(3\)|irs.*determination.*letter|tax.?exempt.*status/,
    nameTest: /501\s*\(?c\)?\s*\(?3\)?|tax-?exempt status|irs determination letter/i,
  },
  {
    label: 'ADA (accessibility compliance)',
    slugTest: /\bada\b.*(accessib|compliance|title.?(ii|iii)|transition.?plan|compliant)|(accessib|compliance).*\bada\b/,
    nameTest: /\bada\b|americans with disabilities act|wcag|accessib(le|ility)/i,
  },
  { label: 'DOT (Department of Transportation)', slugTest: /\bdot\b/, nameTest: /\bdot\b|department of transportation/i },
  { label: 'Commercial Driver’s License (CDL)', slugTest: /\bcdl\b|commercial.?driver/, nameTest: /\bcdl\b|commercial driver.?s license/i },

  // --- food safety ---
  { label: 'ServSafe', slugTest: /servsafe/, nameTest: /servsafe/i },
  { label: 'HACCP', slugTest: /haccp/, nameTest: /haccp/i },
  { label: 'Halal certification', slugTest: /halal/, nameTest: /halal/i },
  { label: 'Kosher certification', slugTest: /kosher/, nameTest: /kosher/i },
  { label: 'Food handler card', slugTest: /food.?handler/, nameTest: /food handler/i },
  { label: 'Alcohol server training (TIPS)', slugTest: /\btips\b.*(alcohol|server)|alcohol.?server.?(training|certification)/, nameTest: /\btips\b|alcohol server (training|certification)|servsafe alcohol/i },
  { label: 'Liquor license', slugTest: /liquor.?license|alcohol.?beverage.?license|\babc.?license\b/, nameTest: /liquor license|alcohol beverage (control|license)/i },

  // --- health / medical / first aid ---
  { label: 'CPR / First Aid (Red Cross / AHA)', slugTest: /\bcpr\b|first.?aid/, nameTest: /\bcpr\b|first aid|american red cross|american heart association|\baha\b/i },

  // --- automotive ---
  { label: 'ASE certification', slugTest: /\base\b/, nameTest: /\base\b.{0,20}certif|ase.?certified|automotive service excellence/i },
  { label: 'AAA Approved Auto Repair', slugTest: /\baaa\b.?approved/, nameTest: /aaa approved auto repair/i },
  { label: 'Apple Independent Repair Provider', slugTest: /apple.?independent.?repair/, nameTest: /apple independent repair|apple authorized service/i },

  // --- fitness ---
  { label: 'NASM certification', slugTest: /\bnasm\b/, nameTest: /\bnasm\b|national academy of sports medicine/i },
  { label: 'AFAA certification', slugTest: /\bafaa\b/, nameTest: /\bafaa\b/i },

  // --- professional licenses / bodies ---
  { label: 'Notary public commission', slugTest: /\bnotary\b/, nameTest: /notary public/i },
  { label: 'Cosmetology license', slugTest: /cosmetolog(y|ist)/, nameTest: /cosmetology license/i },
  { label: 'Veterinary license', slugTest: /veterinar(y|ian).?licens/, nameTest: /veterinary license/i },
  { label: 'Pesticide applicator license', slugTest: /pesticide/, nameTest: /pesticide applicator license/i },
  { label: 'State bar / attorney license', slugTest: /\bstate.?bar\b|bar.?association/, nameTest: /state bar|bar association/i },
  { label: 'CPA (Certified Public Accountant)', slugTest: /\bcpa\b/, nameTest: /\bcpa\b|certified public accountant/i },

  // --- real estate (NAR designations) ---
  { label: 'NAR ABR Designation', slugTest: /\babr\b/, nameTest: /\babr\b|accredited buyer.?s representative/i },
  { label: 'NAR CRS Designation', slugTest: /\bcrs\b/, nameTest: /\bcrs\b|certified residential specialist/i },
  { label: 'NAR GRI Designation', slugTest: /\bgri\b/, nameTest: /\bgri\b|graduate realtor institute/i },
  { label: 'NAR SRS Designation', slugTest: /\bsrs\b/, nameTest: /\bsrs\b|seller representative specialist/i },
  { label: 'NAR SRES Designation', slugTest: /\bsres\b/, nameTest: /\bsres\b|seniors real estate specialist/i },
  { label: 'NAR MRP Certification', slugTest: /\bmrp\b/, nameTest: /\bmrp\b|military relocation professional/i },
  { label: 'NAR e-PRO Certification', slugTest: /e.?pro\b/, nameTest: /e-?pro\b/i },

  // --- insurance / bonding (generic business compliance) ---
  { label: 'General liability insurance', slugTest: /general.?liability/, nameTest: /general liability( insurance)?/i },
  { label: 'Workers’ compensation insurance', slugTest: /workers.?comp|workman.?s.?comp/, nameTest: /workers.? comp(ensation)?|workman.?s comp/i },
  { label: 'Surety bond', slugTest: /surety.?bond|\bbonded\b/, nameTest: /surety bond|licensed and bonded/i },
  { label: 'Background check', slugTest: /background.?check/, nameTest: /background check/i },

  // --- better business / accreditation ---
  { label: 'BBB accreditation', slugTest: /\bbbb\b/, nameTest: /\bbbb\b|better business bureau/i },

  // --- Batch 2: financial-advisor credentials (added explicitly, see header) ---
  { label: 'CFP (Certified Financial Planner)', slugTest: /\bcfp\b/, nameTest: /\bcfp\b|certified financial planner/i },
  { label: 'CFA (Chartered Financial Analyst)', slugTest: /\bcfa\b/, nameTest: /\bcfa\b|chartered financial analyst/i },
  { label: 'ChFC (Chartered Financial Consultant)', slugTest: /\bchfc\b/, nameTest: /\bchfc\b|chartered financial consultant/i },
  { label: 'CLU (Chartered Life Underwriter)', slugTest: /\bclu\b/, nameTest: /\bclu\b|chartered life underwriter/i },
  { label: 'AIF (Accredited Investment Fiduciary)', slugTest: /\baif\b/, nameTest: /\baif\b|accredited investment fiduciary/i },
  { label: 'FLMI (Fellow, Life Management Institute)', slugTest: /\bflmi\b/, nameTest: /\bflmi\b|fellow,? life management institute/i },
  { label: 'REBC (Registered Employee Benefits Consultant)', slugTest: /\brebc\b/, nameTest: /\brebc\b|registered employee benefits consultant/i },
  { label: 'RHU (Registered Health Underwriter)', slugTest: /\brhu\b/, nameTest: /\brhu\b|registered health underwriter/i },
  { label: 'RICP (Retirement Income Certified Professional)', slugTest: /\bricp\b/, nameTest: /\bricp\b|retirement income certified professional/i },
  { label: 'SEC RIA registration', slugTest: /\bria\b|sec.?ria|registered investment adviser/, nameTest: /\bria\b|registered investment adviser|sec registration/i },

  // --- Batch 2: curated freq 3-7 picks (real estate / property / security) ---
  { label: 'NAR membership', slugTest: /\bnar\b/, nameTest: /\bnar\b|national association of realtors/i },
  { label: 'ALTA (American Land Title Association)', slugTest: /\balta\b/, nameTest: /\balta\b|american land title association/i },
  { label: 'AAMVA', slugTest: /\baamva\b/, nameTest: /\baamva\b/i },
  { label: 'IREM (Institute of Real Estate Management)', slugTest: /\birem\b/, nameTest: /\birem\b|institute of real estate management/i },
  { label: 'BOMA (Building Owners and Managers Association)', slugTest: /\bboma\b/, nameTest: /\bboma\b|building owners and managers association/i },
  { label: 'NARPM (National Association of Residential Property Managers)', slugTest: /\bnarpm\b/, nameTest: /\bnarpm\b/i },
  { label: 'ICSC (International Council of Shopping Centers)', slugTest: /\bicsc\b/, nameTest: /\bicsc\b/i },
  { label: 'ASID (American Society of Interior Designers)', slugTest: /\basid\b/, nameTest: /\basid\b/i },
  { label: 'CISSP', slugTest: /\bcissp\b/, nameTest: /\bcissp\b/i },
  { label: 'CompTIA Security+', slugTest: /security\+|comptia/, nameTest: /security\+|comptia security/i },
  { label: 'CISA (security)', slugTest: /\bcisa\b/, nameTest: /\bcisa\b/i },
  { label: 'AKC (American Kennel Club)', slugTest: /\bakc\b/, nameTest: /\bakc\b|american kennel club/i },
];

/**
 * Given a node_slug (and optionally node_name) from the registry, and the
 * list of credential texts actually found on a page, decide deterministically
 * whether this field is one we recognize, and if so, whether this specific
 * page carries it.
 *
 * Three distinct outcomes, all meaningfully different -- same contract as
 * classifySameAs in sameas-domain-classifier.ts:
 * - { recognized: false } -- this slug's text doesn't match any known
 *   authority/credential. Caller should fall through to the LLM fallback.
 * - { recognized: true, value: null, label } -- we know exactly which
 *   credential this field wants, and this page's own credential values
 *   positively do NOT include it. A real, confident "not found".
 * - { recognized: true, value, label } -- found it. `value` is the literal
 *   text found on the page (never a boolean), matching the storage
 *   convention already used for RE/MAX (`designations`) and State Farm
 *   (`credentials`/`licenses`).
 */
export function classifyCredential(
  nodeSlugOrName: string,
  candidateTexts: string[],
): CredentialClassification {
  const rawSlug = nodeSlugOrName.toLowerCase();
  const haystack = rawSlug.replace(/[_-]+/g, ' ');

  for (const dyn of DYNAMIC_STANDARD_RULES) {
    if (dyn.bodyTest.test(haystack)) {
      const code = dyn.extractCode(rawSlug);
      const nameTest = code ? dyn.buildNameTest(code) : dyn.genericNameTest;
      const label = code ? dyn.label(code) : dyn.genericLabel;
      const match = candidateTexts.find((t) => nameTest.test(t));
      return match ? { recognized: true, value: match, label } : { recognized: true, value: null, label };
    }
  }

  for (const rule of CREDENTIAL_AUTHORITY_RULES) {
    if (rule.slugTest.test(haystack)) {
      const match = candidateTexts.find((t) => rule.nameTest.test(t));
      return match
        ? { recognized: true, value: match, label: rule.label }
        : { recognized: true, value: null, label: rule.label };
    }
  }

  return { recognized: false, value: null };
}
