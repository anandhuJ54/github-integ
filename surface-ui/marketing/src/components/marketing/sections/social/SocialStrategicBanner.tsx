import { Share2, Eye, ShieldCheck } from "lucide-react";

export const SocialStrategicBanner = () => {
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
                One dashboard for your entire social media strategy
              </h2>
              <p
                className="font-body-light text-sm md:text-base leading-relaxed mt-4"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                Staying active on social media shouldn't feel like a full-time job. Manage your social media scheduling, publishing, and sharing from one centralized platform. Most social media tools help you schedule posts. Experience.com helps you turn real customer feedback into social content that builds trust.
              </p>
            </div>

            {/* Right side: 3 items */}
            <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Share2 className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Create once, share everywhere
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Publish to Google, LinkedIn, Facebook, Instagram, and X in one click.
                </p>
              </div>

              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Eye className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Stay consistently visible
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Schedule posts in advance so your brand stays active without daily manual effort.
                </p>
              </div>

              <div className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    Turn feedback into content
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Automatically convert five-star reviews into branded social media posts that build trust.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};