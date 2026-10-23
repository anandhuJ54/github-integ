import { Button } from "@v3/ui/components/marketing/ui/button";
import { ArrowRight, Rocket, BarChart3 } from "lucide-react";
import story1 from "@v3/marketing/assets/customer-stories/story-1.jpg";



export const CustomerStoriesHeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[#2563EB]/15 via-[#3B82F6]/10 to-[#1D4ED8]/15 pt-[7rem] md:pt-[9rem] pb-16 md:pb-24">
      <div className="container mx-auto max-w-[1296px] px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* LEFT: copy */}
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 text-[#262626] font-medium mb-6">
              <span className="text-[14px] tracking-tight uppercase">Real Customers. Real Growth</span>
            </div>

            <h1 className="font-heading text-[42px] lg:text-[60px] leading-[1.1] text-[#262626] mb-4 md:mb-6">
              The proof is in the experience
            </h1>

            <p className="mt-6 text-[16px] md:text-[17px] text-[#0f0f0f]/70 max-w-lg leading-relaxed">
              See how top professionals and enterprises use Experience.com to build trust,
              boost visibility, and grow revenue — in every market they serve.
            </p>

            <div className="mt-8">
              <a href="#stories">
                <Button
                  size="lg"
                  className="w-full sm:w-auto font-semibold px-8 shadow-lg bg-[#262626] hover:bg-[#0f0f0f] text-white border-none"
                >
                  Unlock your growth
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
            </div>

          </div>

          {/* RIGHT: portrait + floating cards */}
          <div className="relative h-[560px] md:h-[640px] lg:h-[720px]">
            {/* dashed decorative arc */}
            <svg
              className="absolute -top-4 -right-4 w-[420px] h-[420px] opacity-40 hidden md:block"
              viewBox="0 0 400 400"
              fill="none"
            >
              <path
                d="M 20 200 A 180 180 0 1 1 380 200"
                stroke="#0f0f0f"
                strokeWidth="1"
                strokeDasharray="4 6"
              />
            </svg>

            {/* placeholder portrait card */}
            <div className="absolute right-0 top-6 w-[68%] md:w-[62%] aspect-[3/4] rounded-[36px] overflow-hidden border-2 border-dashed border-[#0f0f0f]/20 bg-[#f3f4f6] flex items-center justify-center">
              <span className="text-[14px] font-medium text-[#0f0f0f]/40">Image Placeholder</span>
            </div>

            {/* Top-left floating card: story preview */}
            <div className="absolute left-0 top-0 w-[62%] md:w-[54%] bg-white rounded-[22px] shadow-[0_20px_50px_-20px_rgba(15,15,15,0.25)] p-4 md:p-5">
              <div className="rounded-2xl overflow-hidden mb-3 aspect-[16/10] bg-neutral-100">
                <img src={story1} alt="Customer success story" className="w-full h-full object-cover" />
              </div>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-[#D1FAE5] flex items-center justify-center shrink-0">
                  <Rocket className="w-4 h-4 text-[#065F46]" />
                </div>
                <div>
                  <p className="font-heading text-[14px] leading-tight text-[#0f0f0f] font-semibold">
                    Ranked #1 in his market
                  </p>
                  <p className="text-[12px] text-[#0f0f0f]/60 mt-1 leading-snug">
                    How John reached the top of Google Maps with Experience.com.
                  </p>
                </div>
              </div>
            </div>

            {/* Right floating pill: metric */}
            <div className="absolute right-[-8px] top-[38%] bg-white rounded-full shadow-[0_16px_40px_-16px_rgba(15,15,15,0.25)] pl-3 pr-5 py-2.5 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#EDE9FE] flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4 text-[#5B21B6]" />
              </div>
              <div className="leading-tight">
                <p className="text-[12px] font-semibold text-[#0f0f0f]">Trust, visibility,</p>
                <p className="text-[12px] text-[#0f0f0f]/60">and revenue growth.</p>
              </div>
            </div>

            {/* Small peach pill */}
            <div className="absolute left-[8%] bottom-[26%] bg-[#FDBA8C] rounded-full px-5 py-2 text-[13px] font-medium text-[#0f0f0f] shadow-md">
              10x more reviews
            </div>

            {/* White pill with dot */}
            <div className="absolute left-[4%] bottom-[16%] bg-white rounded-full px-5 py-2.5 text-[13px] font-medium text-[#0f0f0f] shadow-[0_16px_40px_-16px_rgba(15,15,15,0.25)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#0f0f0f]" />
              Become the top result
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
