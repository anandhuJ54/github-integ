import { Button } from "@v3/marketing/components/marketing/ui/button";
import { ArrowRight, Send, Smartphone, Clock } from "lucide-react";
import smsCampaignImg from "@v3/marketing/assets/reviews-collect-opt2.png";

interface FeatureBlock {
  headline: string;
  description: string;
  bullets: { icon: React.ElementType; text: string }[];
  cta?: string;
  imagePosition: "left" | "right";
  image: string;
}

const featureBlocks: FeatureBlock[] = [
  {
    headline: "Collect reviews when experiences matter most",
    description: "Automatically request reviews while experiences are still fresh. Launch SMS and email outreach that increases response rates without disrupting the customer journey.",
    bullets: [
      { icon: Send, text: "Automated SMS and email triggers" },
      { icon: Smartphone, text: "Mobile-optimized review flows" },
      { icon: Clock, text: "Strategic timing for higher response rates" },
    ],
    cta: "Explore Review Automation",
    imagePosition: "left",
    image: smsCampaignImg,
  },
];

export const ReviewsCapabilityStack = () => {
  return (
    <section className="py-12 sm:py-16 lg:py-20 px-4 bg-background">
      <div className="container mx-auto max-w-7xl space-y-16 sm:space-y-20 lg:space-y-28">
        {featureBlocks.map((block) => (
          <div
            key={block.headline}
            className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center"
          >
            {/* Image */}
            <div className={`hidden md:block order-1 ${block.imagePosition === "right" ? "lg:order-2 lg:-mr-[15%]" : "lg:order-1 lg:-ml-[15%]"} md:flex md:justify-center lg:block`}>
              <img
                src={block.image}
                alt={block.headline}
                className="w-full lg:w-[115%] lg:max-w-none h-auto"
              />
            </div>

            {/* Content */}
            <div className={`order-2 ${block.imagePosition === "right" ? "lg:order-1" : "lg:order-2"} space-y-4 lg:max-w-[calc(100%-10px)] lg:pr-[40px]`}>
              {/* H1 + subtext + CTA: side by side on tablet */}
              <div className="md:flex md:items-start md:justify-between md:gap-6 lg:block">
                <div className="md:flex-1">
                  <h3 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
                    {block.headline}
                  </h3>
                   {/* Mobile image above subtext */}
                   <div className="md:hidden w-full mt-6">
                     <img src={block.image} alt={block.headline} className="w-full h-auto" />
                   </div>
                  <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed mt-4">
                    {block.description}
                   </p>
                </div>
                {block.cta && (
                  <div className="hidden md:block md:pt-0 md:shrink-0 lg:hidden">
                    <Button variant="white" size="lg" className="w-full sm:w-auto">
                      {block.cta}
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Bullets */}
              <ul className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-2 sm:gap-3 pt-2">
                {block.bullets.map((bullet) => {
                  const Icon = bullet.icon;
                  return (
                    <li key={bullet.text} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(26, 143, 241, 0.12)' }}>
                        <Icon className="w-5 h-5" style={{ color: '#1a8ff1' }} />
                      </div>
                      <span className="text-sm md:text-base font-medium text-foreground sm:font-normal sm:text-muted-foreground">{bullet.text}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Mobile CTA (after bullets) */}
              {block.cta && (
                <div className="pt-4 md:hidden">
                  <Button variant="white" size="lg" className="w-full sm:w-auto">
                    {block.cta}
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
              )}

              {/* Desktop CTA */}
              {block.cta && (
                <div className="pt-4 hidden lg:block">
                  <Button variant="white" size="lg" className="w-full sm:w-auto">
                    {block.cta}
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
