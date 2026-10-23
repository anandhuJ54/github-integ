import { Smartphone, Clock, Palette } from "lucide-react";

export const CampaignsStrategicBanner = () => {
  return (
    <section style={{ backgroundColor: "#262626" }}>
      <div className="px-8 sm:px-10 lg:px-16 py-14 md:py-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 md:gap-10 lg:gap-12 items-start">
            {/* Column 1: headline + subtext */}
            <div className="lg:col-span-2">
              <h2
                className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em]"
                style={{ color: "#ffffff" }}
              >
                Be there for the moments that matter
              </h2>
              <p
                className="font-body-light text-sm md:text-base leading-relaxed mt-4"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                Stop guessing when to reach out. Trigger customer campaigns based on real actions like visits, purchases, or milestones so you connect when engagement is highest.
              </p>
            </div>

            {/* Right side: 3 items */}
            <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Smartphone className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Higher response rates
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Mobile-first email and SMS messages customers actually respond to.
                </p>
              </div>

              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Automatic timing
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Campaigns send instantly based on real customer behavior.
                </p>
              </div>

              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Palette className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    On brand, every time
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Pre-built templates that match your business perfectly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
