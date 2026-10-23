import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Search, Users, Check } from "lucide-react";
import card1Img from "@/assets/insights/card1.png";
import card2Img from "@/assets/insights/card2.png";
import card3Img from "@/assets/insights/card3.png";

const cards = [
  {
    icon: LayoutDashboard,
    title: "Real-Time Centralization",
    subtitle: "Bring key metrics from every team and campaign into one configurable view.",
    bullets: [
      "Configurable dashboard widgets",
      "Real-time reputation monitoring",
      "Cross-platform data syncing",
    ],
    image: card1Img,
    alt: "Google Search and Maps performance insights showing engagement, views, and customer actions",
  },
  {
    icon: Search,
    title: "Strategic Google Decisions",
    subtitle: "Master the Google ecosystem with deep-dive insights for Search and Maps.",
    bullets: [
      "Google Maps vs. Search view breakdown",
      "Direct Google Analytics integration",
      'Actionable "Post" engagement tracking',
    ],
    image: card2Img,
    alt: "Multi-location performance reporting dashboard comparing rankings, visibility, and top-performing locations",
  },
  {
    icon: Users,
    title: "Organizational Accountability",
    subtitle: "Drive performance across teams and locations with transparent rankings.",
    bullets: [
      "Hierarchy-based performance reporting",
      "Location-vs-Location benchmarking",
      "Top-performer highlighting and analytics",
    ],
    image: card3Img,
    alt: "Performance insights platform analyzing traffic, decoding trends, and predicting growth opportunities",
  },
];

export const InsightsEnterpriseGrid = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setActiveIndex] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const scrollLeft = el.scrollLeft;
      const cardWidth = el.offsetWidth - 32 + 16;
      const index = Math.round(scrollLeft / cardWidth);
      setActiveIndex(Math.min(index, cards.length - 1));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const CardContent = ({ card }: { card: typeof cards[0] }) => {
    const Icon = card.icon;
    return (
      <div className="flex flex-col h-full">
        <div className="p-5 sm:p-6 flex flex-col gap-3 flex-1">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: "rgba(26, 143, 241, 0.12)" }}
            >
              <Icon className="w-5 h-5" style={{ color: "#1a8ff1" }} />
            </div>
            <h3 className="font-heading text-lg sm:text-xl font-semibold text-foreground">{card.title}</h3>
          </div>
          <p className="font-body-light text-sm text-muted-foreground leading-relaxed">{card.subtitle}</p>
          <ul className="space-y-2 mt-1">
            {card.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-3">
                <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#1a8ff1" }} />
                <span className="text-sm font-medium text-foreground">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-gradient-to-b from-blue-100 via-blue-50 to-purple-100 flex items-center justify-center px-6 h-[215px]">
          <img
            src={card.image}
            alt={card.alt}
            className="max-w-[85%] max-h-[170px] w-auto h-auto object-contain drop-shadow-lg"
          />
        </div>
      </div>
    );
  };

  return (
    <section className="py-12 sm:py-16 lg:py-20 md:px-4 bg-gradient-to-br from-blue-50 via-background to-purple-50 relative overflow-hidden">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 max-w-2xl lg:max-w-none mx-auto px-4 md:px-0">
          <h2 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground text-center mx-auto">
            Control at scale
          </h2>
          <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed mt-4 max-w-3xl mx-auto">
            Enterprise-grade insights designed to give multi-location teams the visibility, control, and accountability they need to win across every market.
          </p>
        </div>

        <div className="hidden lg:grid lg:grid-cols-3 gap-6 mt-12">
          {cards.map((card) => (
            <div key={card.title} className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col">
              <CardContent card={card} />
            </div>
          ))}
        </div>
      </div>

      <div className="lg:hidden mt-8">
        <div
          ref={scrollRef}
          className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 px-4 gap-4"
          style={{ scrollPaddingLeft: "16px", scrollPaddingRight: "16px" }}
        >
          {cards.map((card) => (
            <div
              key={card.title}
              className="flex-shrink-0 snap-start bg-white rounded-2xl border border-border overflow-hidden flex flex-col w-[calc(100%-32px)] md:w-[calc(55%-16px)]"
            >
              <CardContent card={card} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mt-4">
          <span>Swipe</span>
          <svg width="28" height="16" viewBox="0 0 20 12" fill="none">
            <path d="M1 6h17M14 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </section>
  );
};
