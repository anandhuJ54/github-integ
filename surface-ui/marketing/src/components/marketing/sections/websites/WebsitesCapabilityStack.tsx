import { Button } from "@v3/marketing/components/marketing/ui/button";
import { ArrowRight, Star, MousePointerClick, MapPin, Layers, ShieldCheck, Gauge } from "lucide-react";
import socialSchedulePost from "@v3/marketing/assets/websites/web-profile.png";
import socialReviewsPost from "@v3/marketing/assets/websites/optimized-websites.png";
import { getSignUpUrl } from "@v3/marketing/utils/marketing/envUrls";

interface FeatureBlock {
  headline: string;
  description: string;
  bullets: { icon: React.ElementType; text: string }[];
  cta?: string;
  imagePosition: "left" | "right";
  image?: string;
  sectionClassName?: string;
  alt?: string;
  ctaHref?: string;
}

const featureBlocks: FeatureBlock[] = [
  {
    headline: "Launch a high-performance web profile",
    alt:"Search-optimized business profile displaying reviews, ratings, contact information, and customer trust signals across devices.",
    description: "Create a search-optimized profile that showcases your reviews, ratings, and business information. Give customers a single place to evaluate your brand and choose you with confidence.",
    bullets: [
      { icon: Star, text: "Boost credibility signals: Highlight verified reviews and ratings" },
      { icon: MousePointerClick, text: "Drive customer action: Use mobile-optimized layouts designed to convert visitors into leads" },
      { icon: MapPin, text: "Improve local SEO: Get indexed for local search and AI discovery" },
    ],
    imagePosition: "left",
    image: socialSchedulePost,
    sectionClassName: "relative overflow-hidden bg-gradient-to-br from-purple-50 via-blue-50 to-blue-100",
  },
  {
    headline: "Build optimized websites made for scale",
    alt:"Website analytics dashboard showing SEO health scores, ranking factors, traffic insights, and optimization recommendations.",
    description: "Deploy fully managed, search-optimized websites designed for organizations with multiple teams or locations. Maintain a fast, structured web presence that strengthens trust and supports compliance.",
    bullets: [
      { icon: Layers, text: "Scale with ease: Launch sites for new locations or teams without technical overhead" },
      { icon: ShieldCheck, text: "Maintain brand consistency: Ensure every site in your network follows your brand standards" },
      { icon: Gauge, text: "Strengthen technical SEO: Deliver a fast and secure experience that search engines trust" },
    ],
    cta: "Explore Websites",
    ctaHref: getSignUpUrl("utm_source=websites_pg&utm_medium=explore_website_btn&utm_campaign=bottom_btn"),
    image: socialReviewsPost,
    imagePosition: "right",
    sectionClassName: "bg-background",
  },
];

const CtaButton = ({ cta, ctaHref }: { cta: string; ctaHref?: string }) => {
  const button = (
    <Button variant="white" size="lg" className="w-full sm:w-auto">
      {cta}
      <ArrowRight className="h-5 w-5" />
    </Button>
  );

  if (!ctaHref) {
    return button;
  }

  return (
    <a href={ctaHref} target="_blank" rel="noopener noreferrer">
      {button}
    </a>
  );
};

const FeatureBlockSection = ({ block }: { block: FeatureBlock }) => (
  <section className={`py-12 sm:py-16 lg:py-20 px-4 ${block.sectionClassName || "bg-background"}`}>
    <div className="container mx-auto max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
        <div className={`hidden md:flex order-1 ${block.imagePosition === "right" ? "lg:order-2" : "lg:order-1"} md:justify-center lg:block`}>
          {block.image ? (
            <img src={block.image} alt={block.alt} className="w-full rounded-2xl scale-105" />
          ) : (
            <div className="w-full md:w-[75%] lg:w-[75%] aspect-[4/3] rounded-2xl bg-gradient-to-br from-blue-50 via-purple-50 to-blue-100 border border-border flex items-center justify-center">
              <span className="text-muted-foreground/50 font-heading text-lg">Image placeholder</span>
            </div>
          )}
        </div>

        <div className={`order-2 ${block.imagePosition === "right" ? "lg:order-1" : "lg:order-2"} space-y-4 lg:max-w-[calc(100%-10px)] ${block.imagePosition === "right" ? "lg:pr-[40px]" : "lg:pl-[40px]"}`}>
          <div className="md:flex md:items-start md:justify-between md:gap-6 lg:block">
            <div className="md:flex-1">
              <h3 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
                {block.headline}
              </h3>
              <div className="md:hidden w-full mt-6">
                {block.image ? (
                  <img src={block.image} alt={block.alt} className="w-full rounded-2xl" />
                ) : (
                  <div className="w-full aspect-[4/3] rounded-2xl bg-gradient-to-br from-blue-50 via-purple-50 to-blue-100 border border-border flex items-center justify-center">
                    <span className="text-muted-foreground/50 font-heading text-sm">Image placeholder</span>
                  </div>
                )}
              </div>
              <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed mt-4">
                {block.description}
              </p>
            </div>
            {block.cta && (
              <div className="hidden md:block md:pt-0 md:shrink-0 lg:hidden">
                <CtaButton cta={block.cta} ctaHref={block.ctaHref} />
              </div>
            )}
          </div>

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

          {block.cta && (
            <div className="pt-4 md:hidden">
              <CtaButton cta={block.cta} ctaHref={block.ctaHref} />
            </div>
          )}
          {block.cta && (
            <div className="pt-4 hidden lg:block">
              <CtaButton cta={block.cta} ctaHref={block.ctaHref} />
            </div>
          )}
        </div>
      </div>
    </div>
  </section>
);

export const WebsitesCapabilityStack = () => {
  return (
    <>
      {featureBlocks.map((block) => (
        <FeatureBlockSection key={block.headline} block={block} />
      ))}
    </>
  );
};
