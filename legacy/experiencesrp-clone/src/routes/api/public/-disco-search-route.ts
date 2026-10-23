// ============================================================================
// disco search route — route-based mapper step 6 (2026-10-07) and the coverage rule.
//
// Pure helpers (no network, no DB) used by disco-ai-worker's mapSite:
//   - statedTotalInText: a result count the site itself states on a page
//     ("16,554 agents found", "Showing 1–12 of 146,729", "2,310 advisors near you").
//   - needsMoreRoutes: the coverage rule that decides whether the background-call (step 5)
//     and search-input (step 6) routes are tried. No fixed profile count: the best proven
//     route is compared with a total the site states; without one, only a route with no
//     proven reach or a lower-bound reach asks for more.
//   - findSearchInputs: search boxes on a page (city / ZIP / name), read from the page's own
//     form fields and labels.
//   - searchValues: the values tried while mapping, from our own data: the largest cities
//     (exp_us_cities), the most common ZIP among our professionals in each, and last-name
//     initials / two-letter starts in the order our professionals' names use them.
// Generic patterns only, no site names.
//
// The leading dash in the file name keeps it out of the file router.
// ============================================================================
import { load } from 'cheerio/slim';

// ---- stated totals ----------------------------------------------------------------------
// Fix (count words follow the category, 2026-10-07): only neutral words plus the caller's category
// words count; "115 offices" on a person category's page is not its profile total (elliman.com 1336).
const GENERIC_COUNT_WORDS = ['results', 'result', 'matches', 'listings', 'profiles'];

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&ndash;|&#8211;|&mdash;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const toNum = (s: string): number => Number(s.replace(/[,.\s](?=\d{3}\b)/g, '').replace(/[^\d]/g, ''));

/**
 * A result count the page states in its visible text, next to a count word (generic words plus
 * the category's own head words, e.g. "agent", "advisor", "restaurant"). Largest plausible one.
 */
export function statedTotalInText(html: string, categoryWords: string[] = []): { total: number; snippet: string } | null {
  if (!html) return null;
  const text = visibleText(html).slice(0, 400_000);
  const words = [...new Set([...GENERIC_COUNT_WORDS, ...categoryWords.flatMap((w) => [w, `${w}s`, `${w}es`])])]
    .filter((w) => /^[a-z][a-z-]{2,30}$/i.test(w))
    .map((w) => w.replace(/[-]/g, '\\-'));
  if (!words.length) return null;
  const W = `(?:${words.join('|')})`;
  const N = '(\\d{1,3}(?:[,.\\s]\\d{3})+|\\d{2,7})';
  const patterns = [
    new RegExp(`\\bof\\s+(?:about\\s+|over\\s+)?${N}\\+?\\s+(?:[a-z-]+\\s+){0,2}?${W}\\b`, 'gi'), // "1-12 of 146,729 agents"
    new RegExp(`\\b${N}\\+?\\s+(?:[a-z-]+\\s+){0,2}?${W}\\s+(?:found|available|near|matching|in|nationwide|listed)\\b`, 'gi'), // "16,554 agents found"
    new RegExp(`\\b(?:showing|displaying|viewing)\\s+\\d{1,5}\\s*[-–]\\s*\\d{1,5}\\s+of\\s+${N}\\b`, 'gi'), // "Showing 1-12 of 146,729"
    new RegExp(`\\b${N}\\+?\\s+(?:total\\s+)?${W}\\b`, 'gi'), // "2,310 advisors"
  ];
  let best: { total: number; snippet: string } | null = null;
  for (const [pi, re] of patterns.entries()) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = toNum(m[1]);
      if (!Number.isFinite(n) || n < 2 || n > 20_000_000) continue;
      // The last, loosest pattern needs a thousands separator or 3+ digits (avoids "5 agents" copy).
      if (pi === 3 && n < 100) continue;
      if (/^(19|20)\d{2}$/.test(m[1])) continue; // a year
      if (!best || n > best.total) best = { total: n, snippet: m[0].trim().slice(0, 80) };
    }
  }
  return best;
}

// ---- coverage rule ----------------------------------------------------------------------
export type CoverageDecision = { more: boolean; why: string; coverage: number | null };

/**
 * Whether more routes should be tried. With a stated total: when the best proven reach covers
 * less than 90% of it. Without one: when the best route has no proven reach or only a lower bound.
 */
export function needsMoreRoutes(bestReach: number, lowerBound: boolean, statedTotal: number | null): CoverageDecision {
  if (statedTotal && statedTotal > 0) {
    const coverage = bestReach / statedTotal;
    return coverage < 0.9
      ? { more: true, why: `best route reaches ${bestReach} of ${statedTotal} stated (${Math.round(coverage * 100)}%)`, coverage }
      : { more: false, why: `best route reaches ${bestReach} of ${statedTotal} stated (${Math.round(coverage * 100)}%)`, coverage };
  }
  if (bestReach <= 0) return { more: true, why: 'no route reaches any profiles and no total is stated', coverage: null };
  if (lowerBound) return { more: true, why: `best route reach ${bestReach} is a lower bound and no total is stated`, coverage: null };
  return { more: false, why: `best route reaches ${bestReach}; no total stated, reach not a lower bound`, coverage: null };
}

// ---- search boxes -----------------------------------------------------------------------
export type SearchKind = 'zip' | 'city' | 'name';
export type SearchInput = {
  kinds: SearchKind[];
  label: string;
  inputXpath: string;
  submitXpath: string | null;
  form: { action: string; method: 'GET' | 'POST'; inputName: string; fields: Record<string, string> } | null;
};

const ZIP_RE = /\b(zip|postal|post\s*code|postcode)\b|zip/i;
const CITY_RE = /\b(city|location|address|near|where|place|town|state|area|market|region|metro)\b|location|city/i;
const NAME_RE = /\b(name|agent|advisor|adviser|professional|realtor|person|who|last\s*name|first\s*name)\b|name/i;
const GENERIC_RE = /\b(search|keyword|keywords|query|find|q)\b|search/i;
const SKIP_RE = /\b(email|password|newsletter|subscribe|phone|coupon|promo|login|sign\s*in|username|cookie|cookies|vendor|consent|ot)\b|vendor|cookie/i;

const xq = (v: string) => (v.includes("'") ? `concat('${v.split("'").join(`', "'", '`)}')` : `'${v}'`);

/** Search boxes on the page, with the kinds of value they take (from their own name and labels). */
export function findSearchInputs(html: string, pageUrl: string): SearchInput[] {
  if (!html) return [];
  const $ = load(html);
  const out: SearchInput[] = [];
  const seen = new Set<string>();
  $('input').each((_, el) => {
    const e = $(el);
    const type = (e.attr('type') ?? 'text').toLowerCase();
    if (!['text', 'search', ''].includes(type)) return;
    const id = e.attr('id') ?? '';
    const name = e.attr('name') ?? '';
    const labelFor = id ? $(`label[for="${id.replace(/"/g, '')}"]`).first().text() : '';
    const hint = [name, id, e.attr('placeholder') ?? '', e.attr('aria-label') ?? '', e.attr('title') ?? '', labelFor, e.attr('autocomplete') ?? '']
      .join(' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();
    if (!hint || SKIP_RE.test(hint)) return;
    const kinds: SearchKind[] = [];
    if (ZIP_RE.test(hint)) kinds.push('zip');
    if (CITY_RE.test(hint)) kinds.push('city');
    if (NAME_RE.test(hint)) kinds.push('name');
    if (!kinds.length && (GENERIC_RE.test(hint) || type === 'search')) kinds.push('city', 'zip', 'name');
    if (!kinds.length) return;
    const inputXpath = id ? `//input[@id=${xq(id)}]` : name ? `//input[@name=${xq(name)}]` : e.attr('placeholder') ? `//input[@placeholder=${xq(e.attr('placeholder')!)}]` : '';
    if (!inputXpath || seen.has(inputXpath)) return;
    seen.add(inputXpath);
    const formEl = e.closest('form');
    let form: SearchInput['form'] = null;
    let submitXpath: string | null = null;
    if (formEl.length) {
      const method = (formEl.attr('method') ?? 'get').toUpperCase() === 'POST' ? 'POST' : 'GET';
      let action = pageUrl;
      try { action = new URL(formEl.attr('action') || pageUrl, pageUrl).toString(); } catch { /* keep page */ }
      const fields: Record<string, string> = {};
      formEl.find('input[type="hidden"][name]').each((__, h) => { fields[$(h).attr('name')!] = $(h).attr('value') ?? ''; });
      if (name && /^https?:/i.test(action)) form = { action, method, inputName: name, fields };
      const formXpath = formEl.attr('id') ? `//form[@id=${xq(formEl.attr('id')!)}]` : null;
      submitXpath = formXpath
        ? `(${formXpath}//button[not(@type) or @type='submit'] | ${formXpath}//input[@type='submit'])[1]`
        : `(${inputXpath}/ancestor::form[1]//button[not(@type) or @type='submit'] | ${inputXpath}/ancestor::form[1]//input[@type='submit'])[1]`;
    } else {
      submitXpath = `(${inputXpath}/following::button[1])[1]`;
    }
    out.push({ kinds, label: hint.slice(0, 80), inputXpath, submitXpath, form });
  });
  // Real forms first (submitted directly, no browser), then location boxes (they cover a whole
  // area), then name boxes.
  // Fix (location boxes first, 2026-10-08): boxes that take a city or ZIP come before name-only
  // boxes (a city or ZIP covers a whole area; single-letter name starts often return nothing, as on
  // elliman.com dry run 2656); real forms first within each group.
  const rank = (s: SearchInput) => (s.kinds.includes('zip') || s.kinds.includes('city') ? 0 : 2) + (s.form ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, 4);
}

// ---- values tried while mapping ---------------------------------------------------------
export type CityRow = { city: string; state: string; zip: string | null };

/** Values for one search kind, most promising first; the caller tries the first two that work. */
export function searchValues(kind: SearchKind, cities: CityRow[], letters: string[], bigrams: Record<string, string>, minLen = 1): string[][] {
  if (kind === 'zip') return cities.filter((c) => c.zip).map((c) => [c.zip!]);
  if (kind === 'city') return cities.map((c) => [`${c.city}, ${c.state}`, `${c.city} ${c.state}`, c.city]);
  // name prefixes: commonest last-name initials, extended to the commonest two-letter start.
  return letters.map((l) => (minLen <= 1 ? [l, bigrams[l] ?? l] : [bigrams[l] ?? l]));
}

/** Initial and two-letter-start frequencies from a sample of last names (our own records). */
export function nameStarts(lastNames: string[]): { letters: string[]; bigrams: Record<string, string> } {
  const l1 = new Map<string, number>();
  const l2 = new Map<string, Map<string, number>>();
  for (const raw of lastNames) {
    const n = raw.normalize('NFKD').replace(/[^A-Za-z]/g, '');
    if (n.length < 2) continue;
    const a = n[0].toUpperCase();
    const b = a + n[1].toLowerCase();
    l1.set(a, (l1.get(a) ?? 0) + 1);
    const m = l2.get(a) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    l2.set(a, m);
  }
  const letters = [...l1.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  const bigrams: Record<string, string> = {};
  for (const [a, m] of l2) bigrams[a] = [...m.entries()].sort((x, y) => y[1] - x[1])[0][0];
  return { letters, bigrams };
}
