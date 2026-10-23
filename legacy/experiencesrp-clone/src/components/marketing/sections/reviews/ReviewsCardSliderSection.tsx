import { useEffect, useRef, useState } from "react";
import { Shield, Search, Building2, Check } from "lucide-react";
import cardGovernanceImg from "@/assets/reviews/card-governance.png";
import cardVisibilityImg from "@/assets/reviews/card-visibility.png";
import cardControlImg from "@/assets/reviews/card-control.png";

const cards = [
  {
    icon: Shield,
    title: "Reputation governance",
    description: "Ensure reviews meet brand, legal, and compliance standards.",
    image: cardGovernanceImg,
    alt: "Review moderation system automatically detecting inappropriate content and sensitive information for compliance review.",
    bullets: [
      "Automated content moderation",
      "Spam and sensitive content filters",
      "Centralized approval workflows",
    ],
  },
  {
    icon: Search,
    title: "Search and AI visibility",
    description: "Make reviews readable and trustworthy for search engines and AI systems.",
    image: cardVisibilityImg,
    alt: "AI-powered search result recommending a highly rated real estate professional based on reputation and expertise signals.",
    bullets: [
      "Local search ranking signals",
      "Schema markup for star ratings",
      "Structured data syncing for AI discovery",
    ],
  },
  {
    icon: Building2,
    title: "Organizational control",
    description: "Scale review management across teams, locations, and brands.",
    image: cardControlImg,
    alt: "Enterprise review management dashboard with role-based permissions, user access controls, and governance settings.",
    bullets: [
      "Hierarchy-based user permissions",
      "Multi-location brand consistency",
      "Enterprise-grade audit logs",
    ],
  },
];

export const ReviewsCardSliderSection = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

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
      <>
        <div className="p-5 sm:p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(26, 143, 241, 0.12)' }}>
              <Icon className="w-5 h-5" style={{ color: '#1a8ff1' }} />
            </div>
            <h3 className="font-heading text-lg sm:text-xl font-semibold text-foreground">{card.title}</h3>
          </div>
          <p className="font-body-light text-sm sm:text-base text-muted-foreground">{card.description}</p>
          <ul className="space-y-2 mt-1">
            {card.bullets.map((bullet) => (
              <li key={bullet} className="flex items-center gap-3">
                <Check className="w-4 h-4 shrink-0" style={{ color: '#1a8ff1' }} />
                <span className="text-sm font-medium text-foreground">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="w-full aspect-[4/3] md:aspect-[16/9] overflow-hidden flex items-center justify-center p-4 bg-gradient-to-br from-purple-50 via-blue-50/80 to-blue-100/60">
          <img src={card.image} alt={card.alt || card.title} className="w-full md:w-[75%] h-auto object-contain" />
        </div>
      </>
    );
  };

  return (
    <section className="py-12 sm:py-16 lg:py-20 md:px-4 bg-gradient-to-br from-blue-50 via-background to-purple-50 relative overflow-hidden">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 max-w-2xl lg:max-w-none mx-auto px-4 md:px-0">
          <h2 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground">
            Built for consistency, control, and scale
          </h2>
        </div>

        {/* Desktop: 3 cards */}
        <div className="hidden lg:grid lg:grid-cols-3 gap-6 mt-12">
          {cards.map((card) => (
            <div
              key={card.title}
              className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col"
            >
              <CardContent card={card} />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: swipeable cards */}
      <div className="lg:hidden mt-8">
        <div
          ref={scrollRef}
          className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 px-4 gap-4"
          style={{ scrollPaddingLeft: '16px', scrollPaddingRight: '16px' }}
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

        {/* Swipe indicator */}
        <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mt-4">
          <span>Swipe</span>
          <svg width="28" height="16" viewBox="0 0 20 12" fill="none" className="text-muted-foreground">
            <path d="M1 6h17M14 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </section>
  );
};
