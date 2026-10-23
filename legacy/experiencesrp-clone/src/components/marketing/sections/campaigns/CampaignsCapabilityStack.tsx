import { Button } from "@/components/marketing/ui/button";
import { ArrowRight, Mail, CalendarClock, SmilePlus, Bell, Lock } from "lucide-react";
import socialSchedulePost from "@/assets/campaigns/automate-outreach.png";
import socialReviewsPost from "@/assets/campaigns/capture-feedback.png";

interface FeatureBlock {
  headline: string;
  description: string;
  bullets: { icon: React.ElementType; text: string }[];
  cta?: string;
  imagePosition: "left" | "right";
  image?: string;
  imageAlt?: string;
  sectionClassName?: string;
}

const featureBlocks: FeatureBlock[] = [
  {
    headline: "Automate your customer outreach",
    description: "Take the manual work out of customer communication. Whether it's a follow-up email after a visit or a text after a purchase, campaigns run automatically.",
    bullets: [
      { icon: Mail, text: "Email & SMS campaigns: Reach customers on the channels they use most" },
      { icon: CalendarClock, text: "Flexible scheduling: Control timing, frequency, and delivery" },
    ],
    imagePosition: "left",
    image: socialSchedulePost,
    imageAlt: "Customer survey campaign delivered through email and SMS with scheduling controls, delivery settings, and response tracking.",
    sectionClassName: "relative overflow-hidden bg-gradient-to-br from-purple-50 via-blue-50 to-blue-100",
  },
  {
    headline: "Capture more than just a rating",
    description: "Go beyond star ratings. Capture meaningful customer feedback with fast, easy surveys that help you understand what's working and fix what's not.",
    bullets: [
      { icon: SmilePlus, text: "Simple survey flows: Designed for fast completion" },
      { icon: Bell, text: "Instant alerts: Get notified the moment feedback needs attention" },
      { icon: Lock, text: "Private feedback channels: Resolve issues before they become public" },
    ],
    imagePosition: "right",
    image: socialReviewsPost,
    imageAlt: "Customer satisfaction survey triggering automated alerts for negative responses to support faster issue resolution and follow-up.",
    sectionClassName: "bg-background",
  },
];

const FeatureBlockSection = ({ block }: { block: FeatureBlock }) => (
  <section className={`py-12 sm:py-16 lg:py-20 px-4 ${block.sectionClassName || "bg-background"}`}>
    <div className="container mx-auto max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
        {/* Image */}
        <div className={`hidden md:flex order-1 ${block.imagePosition === "right" ? "lg:order-2" : "lg:order-1"} md:justify-center lg:block`}>
          {block.image ? (
            <img src={block.image} alt={block.imageAlt || block.headline} className="w-full rounded-2xl scale-[1.04]" />
          ) : (
            <div className="w-full md:w-[75%] lg:w-[75%] aspect-[4/3] rounded-2xl bg-gradient-to-br from-blue-50 via-purple-50 to-blue-100 border border-border flex items-center justify-center">
              <span className="text-muted-foreground/50 font-heading text-lg">Image coming soon</span>
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
              {/* Mobile image */}
              <div className="md:hidden w-full mt-6">
                {block.image ? (
                  <img src={block.image} alt={block.imageAlt || block.headline} className="w-full rounded-2xl" />
                ) : (
                  <div className="w-full aspect-[4/3] rounded-2xl bg-gradient-to-br from-blue-50 via-purple-50 to-blue-100 border border-border flex items-center justify-center">
                    <span className="text-muted-foreground/50 font-heading text-sm">Image coming soon</span>
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

export const CampaignsCapabilityStack = () => {
  return (
    <>
      {featureBlocks.map((block) => (
        <FeatureBlockSection key={block.headline} block={block} />
      ))}
    </>
  );
};
