import { createContext, useContext, type ReactNode } from "react";
import { SIGNUP_URL } from "./brand";

/**
 * Editable copy for the Inspire co-branded landing page.
 * Values come from the CMS row (page_type 'landing', slug 'landing-page-inspire-example')
 * in a body block of type `inspire_landing`; anything missing falls back to the defaults.
 */
export type InspireCopy = {
  banner: string;
  kicker: string;
  headline: string;
  headlineAccent: string;
  body: string;
  bodyEmphasis: string;
  toolsKicker: string;
  toolsHeadline: string;
  toolsBanner: string;
  promoCode: string;
  signupUrl: string;
};

export const INSPIRE_DEFAULTS: InspireCopy = {
  banner: "An exclusive program for Inspire Network agents.",
  kicker: "Your partner for Google/AI visibility, and AI-optimized content.",
  headline: "Be the first choice in",
  headlineAccent: "search and AI",
  body: "Today’s clients search on Google and ask AI for recommendations. To win, you need to show up in both and be the one they trust enough to choose. That means building a credible, consistent presence powered by reviews, content, and real signals of authority. Experience.com’s Platform brings it all together.",
  bodyEmphasis: "Don’t just get found - Get chosen!",
  toolsKicker: "The tools are multiplying. Your time isn’t.",
  toolsHeadline:
    "Showing up on Google and AI shouldn’t take a dozen tools — or hours every week.",
  toolsBanner: "Experience.com does all of it — in one place.",
  promoCode: "KWINSPIRE26",
  signupUrl: SIGNUP_URL,
};

const Ctx = createContext<InspireCopy>(INSPIRE_DEFAULTS);

export function InspireCopyProvider({
  value,
  children,
}: {
  value?: Partial<InspireCopy> | null;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ ...INSPIRE_DEFAULTS, ...(value ?? {}) }}>{children}</Ctx.Provider>;
}

export function useInspireCopy(): InspireCopy {
  return useContext(Ctx);
}

/** Pull the `inspire_landing` block out of a CMS page body. */
export function inspireCopyFromBlocks(
  blocks: { type?: string }[] | null | undefined,
): Partial<InspireCopy> {
  const block = (blocks ?? []).find((b) => b?.type === "inspire_landing") as
    | (Record<string, unknown> & { type?: string })
    | undefined;
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const key of Object.keys(INSPIRE_DEFAULTS) as (keyof InspireCopy)[]) {
    const v = block[key];
    if (typeof v === "string" && v.trim()) out[key] = v;
  }
  return out as Partial<InspireCopy>;
}
