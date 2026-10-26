/**
 * Reads a free-form voice note or typed note and pulls out "field → value" pairs, in any order
 * and any wording: it looks for field names (and their everyday synonyms) anywhere in the text
 * and takes what follows as the value, up to the next field name. Phones, emails, years and
 * NMLS numbers are also recognised on their own. Runs in the browser — no AI call, no cost.
 * Nothing is applied here: the caller shows the result for the user to approve.
 */

export type ProfileField =
  | "Name"
  | "Title"
  | "Bio"
  | "Year started"
  | "Office"
  | "Mobile"
  | "Email"
  | "Address"
  | "Hours"
  | "NMLS"
  | "Licensed in"
  | "Service areas"
  | "Designations"
  | "Awards"
  | "Education";

export type ProfileChanges = Partial<Record<ProfileField, string>>;

/** Field names people actually say. */
const SYNONYMS: [ProfileField, string[]][] = [
  [
    "Office",
    [
      "office phone",
      "office number",
      "office line",
      "work phone",
      "work number",
      "main line",
      "landline",
      "phone number",
      "phone",
    ],
  ],
  [
    "Mobile",
    ["mobile number", "mobile phone", "cell phone", "cellphone", "cell number", "mobile", "cell"],
  ],
  ["Email", ["email address", "e-mail", "email", "mail id"]],
  ["Year started", ["year started", "started in", "started", "since", "began in", "began"]],
  ["Name", ["full name", "name"]],
  ["Title", ["job title", "title", "position", "role"]],
  ["Bio", ["biography", "bio", "about me", "summary"]],
  ["Address", ["office address", "address", "located at", "moved to"]],
  ["Hours", ["working hours", "office hours", "business hours", "timings", "hours"]],
  ["NMLS", ["nmls number", "nmls id", "nmls"]],
  ["Licensed in", ["licensed in", "licensed", "license states", "licence states"]],
  [
    "Service areas",
    [
      "service areas",
      "service area",
      "areas served",
      "areas",
      "serve",
      "serving",
      "cover",
      "markets",
    ],
  ],
  [
    "Designations",
    [
      "designations",
      "designation",
      "certifications",
      "certification",
      "certified as",
      "certified in",
      "certified",
    ],
  ],
  ["Awards", ["awards", "award", "won", "recognition", "honors", "honours"]],
  ["Education", ["education", "graduated from", "graduated", "studied at", "studied", "degree"]],
];

/** Fields whose value is a sentence — they keep everything to the end of the note. */
const GREEDY = new Set<ProfileField>(["Bio"]);

const NUM_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

function digitsFromWords(s: string) {
  // Only runs of 3+ number words ("five six three …") are phone digits; "Five Star" stays words.
  const W = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)";
  return s.replace(new RegExp(`\\b${W}(?:[\\s-]+${W}){2,}\\b`, "gi"), (run) =>
    run.replace(new RegExp(`\\b${W}\\b`, "gi"), (w) => NUM_WORDS[w.toLowerCase()]),
  );
}

function normalize(input: string) {
  // Spoken single digits "5 6 3 5 5 5 …" become one number.
  return digitsFromWords(input.replace(/\s+/g, " ").trim()).replace(
    /\b\d(?:[\s-]+\d\b){6,}/g,
    (d) => d.replace(/[\s-]+/g, ""),
  );
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Filler between a field name and its value, and at the end of a value. */
const LEAD =
  /^(?:[\s:=,\-–—]+|\b(?:is|are|was|to|now|be|as|should|changed|change|update|updated|set|it's|its|my|the|our|new|from|at|in)\b)+/i;
const TRAIL = /(?:[\s,;:\-–—]+|\b(?:and|also|plus|then|my|the|our|is|are|to|please|thanks)\b)+$/i;
const tidy = (v: string) =>
  v
    .replace(LEAD, "")
    .replace(TRAIL, "")
    .replace(/[.,;!]+$/, "")
    .trim();

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SMALL = new Set(["and", "or", "of", "the", "in", "to", "for", "a", "an"]);
const titleCase = (s: string) =>
  s.replace(/\b[\w']+/g, (w, i: number) =>
    i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : /[A-Z]{2,}/.test(w) ? w : cap(w),
  );

const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/;
function formatPhone(raw: string) {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}

function findEmail(s: string) {
  const plain = s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  if (plain) return plain[0].toLowerCase();
  const spoken = s.match(/([a-z0-9][a-z0-9 ._-]*?)\s+at\s+([a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+)+)/i);
  if (!spoken) return null;
  const local = spoken[1]
    .trim()
    .split(/\s+/)
    .slice(-3)
    .join(" ")
    .replace(/\s+dot\s+/gi, ".")
    .replace(/\s+/g, "");
  const domain = spoken[2].replace(/\s+dot\s+/gi, ".").replace(/\s+/g, "");
  return `${local}@${domain}`.toLowerCase();
}

/** Turn the raw text after a field name into that field's value (or null if it doesn't fit). */
function shape(field: ProfileField, raw: string): string | null {
  const v = tidy(raw);
  switch (field) {
    case "Office":
    case "Mobile": {
      const m = raw.match(PHONE_RE);
      return m ? formatPhone(m[0]) : null;
    }
    case "Email":
      return findEmail(raw);
    case "Year started": {
      const y = raw.match(/\b(?:19|20)\d{2}\b/);
      return y ? y[0] : null;
    }
    case "NMLS": {
      const n = raw.match(/\b\d{4,10}\b/);
      return n ? n[0] : null;
    }
    case "Address":
      return v && /\d/.test(v) ? v : null;
    case "Name":
    case "Title":
    case "Licensed in":
    case "Service areas":
      return v ? titleCase(v) : null;
    case "Bio":
      return v ? cap(v.replace(/[.!?]*$/, "")) + "." : null;
    default:
      return v ? cap(v) : null;
  }
}

type Hit = { field: ProfileField; start: number; end: number };

function findHits(text: string): Hit[] {
  const hits: Hit[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  // Longest phrases first so "office phone" wins over "phone".
  const all = SYNONYMS.flatMap(([field, words]) => words.map((w) => ({ field, w })));
  all.sort((a, b) => b.w.length - a.w.length);
  for (const { field, w } of all) {
    const re = new RegExp(`\\b${esc(w)}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const a = m.index;
      const b = a + m[0].length;
      if (!free(a, b)) continue;
      taken.push([a, b]);
      hits.push({ field, start: a, end: b });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export function extractProfileChanges(input: string): ProfileChanges {
  const text = normalize(input);
  const out: ProfileChanges = {};
  if (!text) return out;

  const hits = findHits(text);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (out[h.field]) continue;
    // A sentence-type field (bio) keeps the rest of the note; others stop at the next field name.
    const greedy = GREEDY.has(h.field);
    const next = greedy ? text.length : (hits[i + 1]?.start ?? text.length);
    let value = shape(h.field, text.slice(h.end, next));
    if (!value) {
      // "Branch Manager is my new title": the value can come before the field name.
      const prevEnd = hits[i - 1]?.end ?? 0;
      const before =
        text
          .slice(prevEnd, h.start)
          .split(/[.,;!?]/)
          .pop() ?? "";
      value = shape(h.field, before.replace(/\b(?:is|are|was|will be)\b[\s\w']*$/i, ""));
    }
    if (value) out[h.field] = value;
    if (greedy) break;
  }

  // Values that are recognisable on their own, even with no field name said.
  if (!out.Email) {
    const e = findEmail(text);
    if (e) out.Email = e;
  }
  // A bare number with no field named is the main (office) phone.
  if (!out.Mobile && !out.Office) {
    const p = text.match(PHONE_RE);
    const f = p ? formatPhone(p[0]) : null;
    if (f) out.Office = f;
  }
  return out;
}
