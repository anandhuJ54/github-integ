import { Button } from "@v3/marketing/components/marketing/ui/button";
import { ArrowRight } from "lucide-react";

export const CustomerStoriesFooterCTA = () => {
  return (
    <section className="py-16 md:py-24 px-4 bg-[#0f0f0f] relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-[#7C3AED]/8 rounded-full blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-[#0052FF]/8 rounded-full blur-[120px]" />
      </div>

      <div className="container mx-auto max-w-4xl relative z-10 text-center space-y-6">
        <p className="font-mono text-[11px] md:text-[12px] tracking-[0.2em] uppercase text-white/60">Your competitors are already building their AI presence</p>
        <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] leading-[1.1] tracking-[-0.02em] text-white">
          Don't just rank. Be the answer.
        </h2>
        <p className="font-body-light text-[16px] md:text-[18px] text-white/85 max-w-2xl mx-auto leading-relaxed">
          Search has changed. Ranking isn't enough. AI platforms, maps, and directories now decide who gets recommended. Experience.com builds the trust signals that put you at the top of both.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <div className="flex flex-col items-center gap-2">
            <Button
              size="lg"
              variant="white"
              className="w-full sm:w-auto h-12 px-8 text-[15px] shadow-lg shadow-black/20"
            >
              It's Free - sign up today
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <span className="text-[13px] text-white/40">For Professionals & Locations</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto h-12 px-8 font-semibold border-2 border-white/20 text-white bg-transparent hover:bg-white/10 text-[15px]"
              asChild
            >
              <a href="/request-a-demo">Schedule a Call</a>
            </Button>
            <span className="text-[13px] text-white/40">For Enterprises</span>
          </div>
        </div>
      </div>
    </section>
  );
};
