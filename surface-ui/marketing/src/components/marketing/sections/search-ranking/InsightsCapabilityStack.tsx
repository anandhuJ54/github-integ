import { MapPin, Filter, Compass, Inbox, TrendingUp, MousePointerClick, LineChart, Star, Target } from "lucide-react";
import trackImg from "@v3/marketing/assets/insights/track.png";
import monitorImg from "@v3/marketing/assets/insights/monitor.png";
import visualizeImg from "@v3/marketing/assets/insights/visualize.png";

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
    headline: "Track who finds you and where",
    alt: "Geographic visitor insights showing where customers find and engage with a business by city and state",
    description:
      "Capture real-time visibility into your audience. Filter visitors by recency and engagement to understand where your brand is strongest and where you have room to grow.",
    bullets: [
      { icon: MapPin, text: "Break down traffic by city and state" },
      { icon: Filter, text: "Filter by most frequent or highest engagement" },
      { icon: Compass, text: "Identify new market expansion opportunities" },
    ],
    imagePosition: "left",
    image: trackImg,
  },
  {
    headline: "Monitor profile and site performance",
    alt: "Profile and website performance analytics showing impressions, clicks, views, and customer engagement trends",
    description:
      "Track impressions, clicks, and views across your digital footprint. Spot performance changes early and identify the specific trends that influence your search ranking.",
    bullets: [
      { icon: Inbox, text: "Centralized multi-platform performance inbox" },
      { icon: TrendingUp, text: "Early trend detection for ranking shifts" },
      { icon: MousePointerClick, text: "Click-to-conversion tracking" },
    ],
    imagePosition: "right",
    image: monitorImg,
  },
  {
    headline: "Visualize visibility over time",
    alt: "Search visibility trend chart comparing daily, weekly, and monthly performance across Google and Bing",
    description:
      "View daily, weekly, and monthly charts to measure your momentum. Compare organic search against branded search to see exactly how your authority is growing.",
    bullets: [
      { icon: LineChart, text: "Trend tracking across Google and Bing" },
      { icon: Star, text: "Review impact vs. Search rank correlation" },
      { icon: Target, text: "Outreach effectiveness and conversion metrics" },
    ],
    imagePosition: "left",
    image: visualizeImg,
  },
];

export const InsightsCapabilityStack = () => {
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
