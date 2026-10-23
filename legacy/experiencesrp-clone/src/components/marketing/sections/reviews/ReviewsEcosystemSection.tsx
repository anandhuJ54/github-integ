import { Star, MapPin, Search, Megaphone } from "lucide-react";

const steps = [
  { icon: Star, label: "The Review", description: "Customer shares authentic feedback", color: "#1a8ff1" },
  { icon: MapPin, label: "The Signal", description: "Listings and profiles gain credibility", color: "#28c3ef" },
  { icon: Search, label: "The Visibility", description: "Search rankings and AI discovery improve", color: "#1a8ff1" },
  { icon: Megaphone, label: "The Growth", description: "Higher-performing campaigns drive repeat business", color: "#28c3ef" },
];

export const ReviewsEcosystemSection = () => {
  return (
    <section className="py-12 sm:py-16 lg:py-20 px-4 bg-background">
      <div className="container mx-auto max-w-5xl">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          {/* Left: Content */}
          <div className="space-y-4 lg:sticky lg:top-24">
            <h2 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
              Reviews as a catalyst for platform growth
            </h2>
            <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed">
              Reviews create the signals. The XMP transforms them into actionable intelligence that strengthens listings, elevates search visibility, and powers higher-performing campaigns.
            </p>
          </div>

          {/* Right: Snake / zigzag process */}
          <div className="space-y-8">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isEven = index % 2 === 0;
              return (
                <div key={step.label} className="relative">
                  {index < steps.length - 1 && (
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full h-8 w-[2px] bg-gradient-to-b from-border to-transparent z-0" />
                  )}

                  <div className={`flex items-center gap-4 ${isEven ? 'flex-row' : 'flex-row-reverse'}`}>
                    <div
                      className="w-1/2 aspect-[4/3] rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${step.color}10`, border: `1.5px dashed ${step.color}40` }}
                    >
                      <Icon className="w-10 h-10" style={{ color: `${step.color}50` }} />
                    </div>

                    <div className="w-1/2 space-y-1">
                      <h3 className="font-heading text-base sm:text-lg text-foreground">{step.label}</h3>
                      <p className="font-body-light text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
