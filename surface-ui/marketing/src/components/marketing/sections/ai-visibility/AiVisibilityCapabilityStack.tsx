import { Award, FileText, ShieldCheck, Target, Compass, TrendingUp } from "lucide-react";
import authorityImg from "@v3/marketing/assets/ai-visibility/authority.png";
import topicsImg from "@v3/marketing/assets/ai-visibility/topics.png";

interface FeatureBlock {
  headline: string;
  description: string;
  bullets: { icon: React.ElementType; text: string }[];
  imagePosition: "left" | "right";
  image: string;
  alt?: string;
}

const featureBlocks: FeatureBlock[] = [
  {
    headline: "Build authority with an AI writing agent",
    alt: "AI Writer tool creating a first-time homebuyers guide article in 32 seconds, compared to manual writing",
    description:
      "AI search favors businesses that demonstrate expertise. Work with an AI writing agent to create content and answer common questions that help AI systems select you as a trusted source.",
    bullets: [
      { icon: Award, text: "Demonstrate expertise with high-quality, professional content" },
      { icon: FileText, text: "Address the specific topics your audience is searching for" },
      { icon: ShieldCheck, text: "Help AI systems recognize your business as a reliable authority" },
    ],
    imagePosition: "left",
    image: authorityImg,
  },
  {
    headline: "See which topics you're winning",
    alt: "Analytics dashboard showing content performance trend, scroll depth heatmap, and Content Health score of 83",
    description:
      "Get insight into the specific topics your business is most closely associated with. Identify where you are winning and where expanding your expertise can unlock new growth.",
    bullets: [
      { icon: Target, text: "Identify areas where your business is already surfacing in results" },
      { icon: Compass, text: "Find new subjects to cover to increase your overall reach" },
      { icon: TrendingUp, text: "Track how your topic authority changes as you publish content" },
    ],
    imagePosition: "right",
    image: topicsImg,
  },
];

export const AiVisibilityCapabilityStack = () => {
  return (
    <section className="py-12 sm:py-16 lg:py-20 px-4 bg-background">
      <div className="container mx-auto max-w-7xl space-y-16 sm:space-y-20 lg:space-y-28">
        {featureBlocks.map((block) => (
          <div key={block.headline} className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-20 items-center">
            <div
              className={`hidden md:block order-1 ${
                block.imagePosition === "right" ? "lg:order-2" : "lg:order-1"
              } md:flex md:justify-center lg:block`}
            >
              <img
                src={block.image}
                alt={block.alt}
                className={`w-full md:w-full lg:w-[115%] lg:max-w-none h-auto ${
                  block.imagePosition === "right" ? "lg:mr-[-15%]" : "lg:ml-[-15%]"
                }`}
              />
            </div>

            <div
              className={`order-2 ${
                block.imagePosition === "right" ? "lg:order-1" : "lg:order-2"
              } space-y-4 lg:max-w-[calc(100%-10px)] lg:pr-[40px]`}
            >
              <div className="md:flex md:items-start md:justify-between md:gap-6 lg:block">
                <div className="md:flex-1">
                  <h3 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
                    {block.headline}
                  </h3>
                  <div className="md:hidden w-full mt-6">
                    <img src={block.image} alt={block.alt} className="w-full h-auto" />
                  </div>
                  <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed mt-4">
                    {block.description}
                  </p>
                </div>
              </div>

              <ul className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-2 sm:gap-3 pt-2">
                {block.bullets.map((bullet) => {
                  const Icon = bullet.icon;
                  return (
                    <li key={bullet.text} className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: "rgba(26, 143, 241, 0.12)" }}
                      >
                        <Icon className="w-5 h-5" style={{ color: "#1a8ff1" }} />
                      </div>
                      <span className="text-sm md:text-base font-medium text-foreground sm:font-normal sm:text-muted-foreground">
                        {bullet.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
