import { useEffect, useRef, useState } from "react";
import { Settings2, ShieldCheck, Puzzle, Check } from "lucide-react";
import socialUnifiedManagement from "@v3/marketing/assets/social-unified-management.png";
import socialBrandSafety from "@v3/marketing/assets/social-brand-safety.png";
import socialConnectedStrategy from "@v3/marketing/assets/social-connected-strategy.png";

const cards = [
  {
    icon: Settings2,
    title: "Centralized Social Management",
    alt:"Multi-location social media management dashboard with profile controls, publishing status, and user-level social account settings.",
    description: "Connect all your social profiles and locations to one secure dashboard. Easily manage social publishing as your organization grows.",
    bullets: [],
    image: socialUnifiedManagement,
  },
  {
    icon: ShieldCheck,
    title: "Brand Safety",
    alt:"Social media preview tool showing how content will appear across Google, Facebook, and Instagram before publication.",
    description: "Prevent posting mistakes with previews and approval control. Review & edit scheduled content to ensure total accuracy.",
    bullets: [],
    image: socialBrandSafety,
  },
  {
    icon: Puzzle,
    title: "Connected Reputation Strategy",
    alt:"Customer reviews transformed into branded social content to increase visibility, engagement, and social proof across platforms.",
    description: "Link social posts directly to new reviews, listings, and customer activity so every update strengthens your digital presence.",
    bullets: [],
    image: socialConnectedStrategy,
  },
];

export const SocialEnterpriseGrid = () => {
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
      <div className="flex flex-col h-full">
        {/* Top content section - flex-1 ensures equal height across cards */}
        <div className="p-5 sm:p-6 flex flex-col gap-3 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(26, 143, 241, 0.12)' }}>
              <Icon className="w-5 h-5" style={{ color: '#1a8ff1' }} />
            </div>
            <h3 className="font-heading text-lg sm:text-xl font-semibold text-foreground">{card.title}</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{card.description}</p>
          {card.bullets.length > 0 && (
            <ul className="space-y-2 mt-1">
              {card.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-3">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#1a8ff1' }} />
                  <span className="text-sm font-medium text-foreground">{bullet}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* Bottom gradient section with image */}
        <div className="bg-gradient-to-b from-blue-100 via-blue-50 to-purple-100 flex items-center justify-center px-6 h-[215px]">
          {card.image ? (
            <img src={card.image} alt={card.alt} className="max-w-[85%] max-h-[170px] w-auto h-auto object-contain drop-shadow-lg" />
          ) : (
            <div className="w-[85%] aspect-[4/3] rounded-t-xl bg-white/60 border border-border/50 flex items-center justify-center">
              <span className="text-muted-foreground/40 text-sm font-heading">Image coming soon</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="py-12 sm:py-16 lg:py-20 md:px-4 bg-gradient-to-br from-blue-50 via-background to-purple-50 relative overflow-hidden">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 max-w-2xl lg:max-w-none mx-auto px-4 md:px-0">
          <h2 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground">
            Built for brand consistency and social media control
          </h2>

        </div>

        {/* Desktop */}
        <div className="hidden lg:grid lg:grid-cols-3 gap-6 mt-12">
          {cards.map((card) => (
            <div key={card.title} className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col">
              <CardContent card={card} />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile swipeable */}
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