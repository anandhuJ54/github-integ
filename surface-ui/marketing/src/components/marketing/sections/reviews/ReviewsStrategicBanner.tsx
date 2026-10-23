import { Heart, Bot, Search } from "lucide-react";

export const ReviewsStrategicBanner = () => {
  return (
    <section style={{ backgroundColor: "#262626" }}>
      <div className="px-8 sm:px-10 lg:px-16 py-14 md:py-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8 md:gap-10 lg:gap-12 items-start">
            {/* Column 1: headline + subtext (spans 2 cols) */}
            <div className="md:col-span-2">
              <h2
                className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em]"
                style={{ color: "#ffffff" }}
              >
                Reviews that do more than boost your rating
              </h2>
              <p
                className="font-body-light text-sm md:text-base leading-relaxed mt-4"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                Customer feedback shouldn't just live on a profile. When reviews are generated, managed, and activated consistently, they become credibility signals that influence search rankings and AI-driven recommendations.
              </p>
            </div>

            {/* Column 2 */}
            <div className="space-y-4">
              <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                <h3
                  className="font-heading text-base md:text-lg font-semibold"
                  style={{ color: "#ffffff" }}
                >
                  Trust signals
                </h3>
              </div>
              <p
                className="font-body-light text-sm leading-relaxed"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                Turn sentiment into measurable credibility.
              </p>
            </div>

            {/* Column 3 */}
            <div className="space-y-4">
              <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                <h3
                  className="font-heading text-base md:text-lg font-semibold"
                  style={{ color: "#ffffff" }}
                >
                  AI discovery
                </h3>
              </div>
              <p
                className="font-body-light text-sm leading-relaxed"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                Fuel the data models that surface trusted businesses.
              </p>
            </div>

            {/* Column 4 */}
            <div className="space-y-4">
              <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
              <div className="flex items-center gap-2">
                <Search className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                <h3
                  className="font-heading text-base md:text-lg font-semibold"
                  style={{ color: "#ffffff" }}
                >
                  Search authority
                </h3>
              </div>
              <p
                className="font-body-light text-sm leading-relaxed"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                Improve rankings with fresh, authentic content.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
