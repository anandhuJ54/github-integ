import { Button } from "@v3/marketing/components/marketing/ui/button";
import { ArrowRight } from "lucide-react";
import { getSignUpUrl } from "@v3/marketing/lib/marketing/envUrls";

export const ReviewsFooterCTA = () => {
  return (
    <section className="py-16 md:py-24 px-4 bg-[#262626] relative overflow-hidden">
      {/* Background decoration - matching GlobalFooter/UnifiedCTA */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-[#7C3AED]/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-[#0052FF]/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[#4F46E5]/5 rounded-full blur-[100px]" />
      </div>

      <div className="container mx-auto max-w-4xl relative z-10 text-center space-y-6">
        <p className="font-mono text-[11px] md:text-[12px] tracking-[0.2em] uppercase text-white/60">Your competitors are already building their AI presence</p>
        <h2 className="font-heading text-[28px] md:text-[36px] lg:text-[44px] text-white leading-[1.1]">
          Don't just rank. Be the answer.
        </h2>
        <p className="font-body-light text-[16px] md:text-[18px] text-white/85 max-w-2xl mx-auto leading-relaxed">
          Search has changed. Ranking isn't enough. AI platforms, maps, and directories now decide who gets recommended. Experience.com builds the trust signals that put you at the top of both.
        </p>

        {/* Buttons - matching UnifiedClosingCTA */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <div className="flex flex-col items-center gap-2">
            <a
              href={getSignUpUrl("utm_source=review_pg&utm_medium=its_free_sign_up_today&utm_campaign=bottom_btn")}
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
            <span className="text-[13px] text-white/60">For Professionals & Locations</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <a
              href="/request-a-demo"
            >
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
