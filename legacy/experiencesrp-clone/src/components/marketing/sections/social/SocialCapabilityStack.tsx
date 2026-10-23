import { Button } from "@/components/marketing/ui/button";
import { ArrowRight, Layers, Monitor, CalendarClock, Zap, SlidersHorizontal, Palette } from "lucide-react";
import socialSchedulePost from "@/assets/social-schedule-post.png";
import socialReviewsPost from "@/assets/social-reviews-post.png";

interface FeatureBlock {
  headline: string;
  description: string;
  bullets: { icon: React.ElementType; text: string }[];
  cta?: string;
  imagePosition: "left" | "right";
  image?: string;
  sectionClassName?: string;
  alt?: string;
}

const featureBlocks: FeatureBlock[] = [
  {
    headline: "Plan & schedule posts in advance",
    alt:"Social media scheduling tool with platform-specific publishing times and post previews for Google, Facebook, and Instagram.",
    description: "Plan your social media content days or weeks ahead. Write your captions, upload media, and preview exactly how your posts will appear on every platform before publishing.",
    bullets: [
      { icon: Layers, text: "Multi-platform publishing: Publish one post to all profiles simultaneously" },
      { icon: Monitor, text: "Platform previews: See exactly how your post will appear on each social network before publishing" },
      { icon: CalendarClock, text: "Smart scheduling: Choose the best dates and times to stay visible to your audience" },
    ],
    imagePosition: "left",
    image: socialSchedulePost,
    sectionClassName: "relative overflow-hidden bg-gradient-to-br from-purple-50 via-blue-50 to-blue-100",
  },
  {
    headline: "Put your reputation on autopilot",
    alt:"Automated social media publishing that converts five-star customer reviews into social content across multiple platforms.",
    description: "Let your best customer feedback do the marketing for you. Automatically share five-star reviews to your social media channels using branded templates that build credibility without extra work.",
    bullets: [
      { icon: Zap, text: "Auto-post reviews: Turn new feedback into fresh social content immediately" },
      { icon: SlidersHorizontal, text: "Smart thresholds: You choose the minimum rating you want to share automatically" },
      { icon: Palette, text: "Custom templates: Ensure every shared review matches your brand colors and style" },
    ],
    cta: "Explore Social Content",
    image: socialReviewsPost,
    imagePosition: "right",
    sectionClassName: "bg-background",
  },
];

const FeatureBlockSection = ({ block }: { block: FeatureBlock }) => (
  <section className={`py-12 sm:py-16 lg:py-20 px-4 ${block.sectionClassName || "bg-background"}`}>
    <div className="container mx-auto max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
        {/* Placeholder visual */}
        <div className={`hidden md:flex order-1 ${block.imagePosition === "right" ? "lg:order-2" : "lg:order-1"} md:justify-center lg:block`}>
          {block.image ? (
            <img src={block.image} alt={block.alt} className="w-full rounded-2xl" />
          ) : (
            <div className="w-full md:w-[75%] lg:w-[75%] aspect-[4/3] rounded-2xl bg-gradient-to-br from-blue-50 via-purple-50 to-blue-100 border border-border flex items-center justify-center">
              <span className="text-muted-foreground/50 font-heading text-lg">Image placeholder</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className={`order-2 ${block.imagePosition === "right" ? "lg:order-1" : "lg:order-2"} space-y-4 lg:max-w-[calc(100%-10px)] ${block.imagePosition === "right" ? "lg:pr-[40px]" : "lg:pl-[40px]"}`}>
          <div className="md:flex md:items-start md:justify-between md:gap-6 lg:block">
            <div className="md:flex-1">
              <h3 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
                {block.headline}
              </h3>
              {/* Mobile placeholder */}
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
                <Button variant="white" size="lg" className="w-full sm:w-auto">
                  {block.cta}
                  <ArrowRight className="h-5 w-5" />
                </Button>
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
              <Button variant="white" size="lg" className="w-full sm:w-auto">
                {block.cta}
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          )}
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
    </div>
  </section>
);

export const SocialCapabilityStack = () => {
  return (
    <>
      {featureBlocks.map((block) => (
        <FeatureBlockSection key={block.headline} block={block} />
      ))}
    </>
  );
};
