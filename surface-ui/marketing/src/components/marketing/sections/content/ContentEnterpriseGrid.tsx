import { useEffect, useRef, useState } from "react";
import { Sparkles, Search, Layers, Check } from "lucide-react";
import card1 from "@v3/marketing/assets/content/Content_Child4_Card1.png";
import card2 from "@v3/marketing/assets/content/Content_Child4_Card2.png";
import card3 from "@v3/marketing/assets/content/Content_Child4_Card3.png";

const cards = [
  {
    icon: Sparkles,
    title: "VOCE AI integration",
    description: "Content creation and publishing are powered by VOCE, our specialized writing and publishing workspace.",
    image: card1,
    alt: "VOCE AI content workspace showing an article editor with publishing controls, scheduling options, and an Ask VOX assistant for drafting professional content",
    bullets: [
      "Native AI writing assistant",
      "Centralized content management",
      "Seamless Experience.com integration",
    ],
  },
  {
    icon: Search,
    title: "Modern search signals",
    description: "Reinforce the signals that search engines and AI systems rely on when surfacing trusted sources.",
    image: card2,
    alt: "Structured expert answer highlighting key concepts that search engines and AI systems reference when surfacing trusted sources",
    bullets: [
      "Structured data for AI discovery",
      "Consistent publishing workflows",
      "Connected profile reinforcement",
    ],
  },
  {
    icon: Layers,
    title: "Multi-channel control",
    description: "Manage your entire content strategy from a single point of authority across all locations.",
    image: card3,
    alt: "Organizational hierarchy and user permissions dashboard controlling multi-location content publishing and brand voice consistency",
    bullets: [
      "Centralized brand voice control",
      "Cross-platform publishing logs",
      "Scalable expertise distribution",
    ],
  },
];

export const ContentEnterpriseGrid = () => {
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

  const CardBody = ({ card }: { card: typeof cards[0] }) => {
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
          <img src={card.image} alt={card.alt} className="w-full md:w-[75%] h-auto object-contain" />
        </div>
      </>
    );
  };

  return (
    <section className="py-12 sm:py-16 lg:py-20 md:px-4 bg-gradient-to-br from-blue-50 via-background to-purple-50 relative overflow-hidden">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 max-w-2xl lg:max-w-none mx-auto px-4 md:px-0">
          <h2 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground">
            Control at scale
          </h2>
        </div>

        <div className="hidden lg:grid lg:grid-cols-3 gap-6 mt-12">
          {cards.map((card) => (
            <div key={card.title} className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col">
              <CardBody card={card} />
            </div>
          ))}
        </div>
      </div>

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
              <CardBody card={card} />
            </div>
          ))}
        </div>

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
