import { SearchCheck, Activity, Target } from "lucide-react";

export const WebsitesStrategicBanner = () => {
  return (
    <section style={{ backgroundColor: "#262626" }}>
      <div className="px-8 sm:px-10 lg:px-16 py-14 md:py-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 md:gap-10 lg:gap-12 items-start">
            <div className="lg:col-span-2">
              <h2
                className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em]"
                style={{ color: "#ffffff" }}
              >
                Turn your website into a search and AI visibility engine
              </h2>
              <p
                className="font-body-light text-sm md:text-base leading-relaxed mt-4"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                Website analytics is the process of tracking and improving how people find and use your site. It powers better SEO, website performance, and search rankings. Search engines and AI systems reward sites that are fast, secure, and accurate. Without strong signals, your business gets missed.
              </p>
            </div>

            <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <SearchCheck className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Audit your visibility
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Run an SEO audit to see how search engines and AI view your site.
                </p>
              </div>

              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Track your health
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Monitor your website performance analytics to measure SEO impact.
                </p>
              </div>

              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Focus on impact
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Fix high-impact issues that improve website ranking and visibility.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
