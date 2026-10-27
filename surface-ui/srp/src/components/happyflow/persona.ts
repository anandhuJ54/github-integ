/**
 * The person the Happyflow screens talk to.
 *
 * By default it is the sample persona in demo-data.ts. When the seat has the signed-in professional's name
 * (and title), those replace the sample ones, so the home greets the real person. Everything else on the
 * screens (the company, the market, the score, the story) is still the sample one, so the notice says so.
 * Pure functions: no React, no network (see persona-context.tsx for the provider).
 */
import { PERSONA } from "./demo-data";
import type { ProfessionalSeat } from "@v3/srp/utils/seat";

export const SAMPLE_DATA_NOTE = "These screens show example values, not your real profile, score or activity.";
const REAL_NAME_NOTE =
  "Your name and title come from your account. Everything else on these screens is example values, not your real profile, score or activity.";

export type PersonaOverride = {
  first?: string;
  name?: string;
  title?: string;
  email?: string;
  mobile?: string;
  /** The seat's url slug; the sample site address is built from it. */
  slug?: string;
  /** A ready-made site address (wins over the slug). */
  site?: string;
};
const NO_TITLE = "";

export type HfPersona = Omit<typeof PERSONA, "name" | "first" | "title" | "email" | "mobile" | "site"> & {
  name: string;
  first: string;
  title: string;
  email: string;
  mobile: string;
  site: string;
  /** True when the name comes from a real account rather than the sample persona. */
  isReal: boolean;
};

const clean = (v: string | null | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t === "" ? undefined : t;
};

/** What the seat knows about the person: first name, full name and job title, each only when present. */
export function personaFromSeat(seat: Pick<ProfessionalSeat, "pro"> | null | undefined): PersonaOverride {
  const pro = seat?.pro;
  if (!pro) return {};
  const first = clean(pro.first_name);
  const last = clean(pro.last_name);
  const display = clean(pro.display_name);
  const name = display ?? ([first, last].filter(Boolean).join(" ") || undefined);
  const firstName = first ?? display?.split(/\s+/)[0];
  const out: PersonaOverride = {};
  if (firstName) out.first = firstName;
  if (name) out.name = name;
  const title = clean(pro.job_title);
  if (title && (out.first || out.name)) out.title = title;
  if (out.first || out.name) {
    const email = clean(pro.email);
    const mobile = clean(pro.phone);
    const slug = clean(pro.slug);
    if (email) out.email = email;
    if (mobile) out.mobile = mobile;
    if (slug) out.slug = slug;
  }
  return out;
}

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function mergePersona(override: PersonaOverride): HfPersona {
  const isReal = Boolean(override.first || override.name);
  const name = override.name ?? PERSONA.name;
  const slug = override.slug ?? (kebab(name) || "you");
  return {
    ...PERSONA,
    name,
    // the sample persona's own address and site name Alex, so a real person gets ones built from their name
    email: override.email ?? (isReal ? `${slug.replace(/-/g, ".")}@demomortgage.com` : PERSONA.email),
    mobile: override.mobile ?? PERSONA.mobile,
    site: override.site ?? (isReal ? `demomortgage.com/${slug}` : PERSONA.site),
    first: override.first ?? PERSONA.first,
    // a real person without a job title gets none, never the sample persona's "Senior Loan Officer"
    title: override.title ?? (isReal ? NO_TITLE : PERSONA.title),
    isReal,
  };
}

/** The small line under a drafted article: name, title, and (sample persona only) the sample NMLS number. */
export function bylineFor(p: HfPersona): string {
  if (!p.isReal) return `${p.name} · ${p.title} · NMLS ${p.nmls}`;
  return [p.name, p.title].filter(Boolean).join(" · ");
}

export function sampleNoticeFor(isReal: boolean): string {
  return isReal ? REAL_NAME_NOTE : SAMPLE_DATA_NOTE;
}

/**
 * The sample persona's name, address and site swapped for the real person's, in a piece of demo text.
 * The sample persona's own text is returned untouched. Only the whole word "Alex" is replaced.
 */
export function personalize(text: string, p: HfPersona): string {
  if (!p.isReal) return text;
  return text
    .replaceAll("alex.sample@demomortgage.com", p.email)
    .replaceAll("demomortgage.com/alex-sample", p.site)
    .replaceAll("Alex Sampler", `${p.name} Jr.`) // the look-alike in a name search
    .replaceAll("Alex Sample", p.name)
    .replace(/\bAlex\b/g, p.first);
}
