import { Sparkles, Bot, MapPin } from "lucide-react";

const items = [
  { icon: Sparkles, title: "Expertise at scale", body: "Publish professional content without the time drain." },
  { icon: Bot, title: "AI discovery", body: "Build the structured answers that modern search engines crave." },
  { icon: MapPin, title: "Local authority", body: "Reinforce your reputation with content tied to your real expertise." },
];

export const ContentStrategicBanner = () => {
  return (
    <section style={{ backgroundColor: "#262626" }}>
      <div className="px-8 sm:px-10 lg:px-16 py-14 md:py-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8 md:gap-10 lg:gap-12 items-start">
            <div className="md:col-span-2">
              <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em]" style={{ color: "#ffffff" }}>
                Content built for discovery
              </h2>
              <p className="font-body-light text-sm md:text-base leading-relaxed mt-4" style={{ color: "rgba(255,255,255,0.55)" }}>
                Your content should do more than exist—it should help customers choose you. Our dedicated workspace ensures you publish the right expertise, locally and consistently, to influence search and AI-powered results.
              </p>
            </div>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="space-y-4">
                  <div className="h-px w-full" style={{ backgroundColor: "rgba(255,255,255,0.2)" }} />
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                    <h3 className="font-heading text-base md:text-lg font-semibold" style={{ color: "#ffffff" }}>
                      {item.title}
                    </h3>
                  </div>
                  <p className="font-body-light text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
