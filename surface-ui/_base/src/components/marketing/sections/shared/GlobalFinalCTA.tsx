import { Button } from "@v3/ui/components/marketing/ui/button";
import { ArrowRight } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { getSignUpUrl } from "@v3/ui/lib/marketing/envUrls";

/**
 * Standardized final CTA section used across every marketing page.
 */
// Per-page utm_medium overrides for the bottom sign-up button
const BOTTOM_MEDIUM_OVERRIDES: Record<string, string> = {
  campaigns: "start_free",
  insights: "start_free",
  website: "start_free",
  social: "start_free",
  listings: "start_free",
};

// Per-page utm_source overrides (when the route slug differs from the tracked source)
const SOURCE_OVERRIDES: Record<string, string> = {
  reviews_management: "review",
  website: "websites",
};

export const GlobalFinalCTA = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const slug = (pathname.replace(/^\//, "").replace(/\/$/, "") || "home").replace(/[^a-z0-9]+/gi, "_");
  const source = SOURCE_OVERRIDES[slug] ?? slug;
  const bottomMedium = BOTTOM_MEDIUM_OVERRIDES[slug] ?? "its_free_sign_up_today";

  return (
    <section className="py-16 md:py-24 px-4 bg-[#262626] relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-[#7C3AED]/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-[#0052FF]/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[#4F46E5]/5 rounded-full blur-[100px]" />
      </div>

      <div className="container mx-auto max-w-4xl relative z-10 text-center space-y-6">
        <p className="font-mono text-[11px] md:text-[12px] tracking-[0.2em] uppercase text-white/60">
          Your reputation is now your search strategy
        </p>

        <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] text-white leading-[1.1]">
          Don't just rank. Be the answer.
        </h2>

        <p className="font-body-light text-[16px] md:text-[18px] text-white/85 max-w-2xl mx-auto leading-relaxed">
          Build the local search presence and AI visibility that gets you found, trusted, and chosen by your next customer.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <div className="flex flex-col items-center gap-2">
            <a
              href={getSignUpUrl(
                `utm_source=${source}_pg&utm_medium=${bottomMedium}&utm_campaign=bottom_btn`
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="lg"
                variant="white"
                className="w-full sm:w-auto h-12 px-8 text-[15px] shadow-lg shadow-black/20"
              >
                It's Free - sign up today
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </a>
            <span className="text-[13px] text-white/60">For Professionals &amp; Locations</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <a href="/request-a-demo">
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto h-12 px-8 font-semibold border-2 border-white text-white bg-transparent hover:bg-white/10 text-[15px]"
              >
                Schedule a Call
              </Button>
            </a>
            <span className="text-[13px] text-white/60">For Enterprises</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default GlobalFinalCTA;
