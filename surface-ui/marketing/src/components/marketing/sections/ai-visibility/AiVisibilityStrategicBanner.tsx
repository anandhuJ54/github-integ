import { BarChart3, Sparkles, Compass } from "lucide-react";

export const AiVisibilityStrategicBanner = () => {
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
                AI visibility built for modern search
              </h2>
              <p
                className="font-body-light text-sm md:text-base leading-relaxed mt-4"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                AI search does not just return a list of links; it generates answers by selecting trusted sources. AI Visibility helps you understand how your business is positioned so you can stop guessing and start growing.
              </p>
            </div>

            {[
              { icon: BarChart3, title: "Understand your standing", desc: "See exactly where you rank in AI-generated answers." },
              { icon: Sparkles, title: "Strengthen your presence", desc: "Identify the specific signals that help you get chosen." },
              { icon: Compass, title: "Move beyond links", desc: "Position your brand as the primary source for AI-driven discovery." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="space-y-4">
                <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                <div className="flex items-center gap-2">
                  <Icon className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                  <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                    {title}
                  </h3>
                </div>
                <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
