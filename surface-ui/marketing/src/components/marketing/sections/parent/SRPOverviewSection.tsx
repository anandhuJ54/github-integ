import { Button } from "@v3/marketing/components/marketing/ui/button";
import { ArrowRight, Play, Zap, Brain, Trophy, MessageSquare } from "lucide-react";
import srpOverviewImg from "@v3/marketing/assets/srp-overview-video-thumb.png";
import srpOverviewTabletImg from "@v3/marketing/assets/srp-intro-placeholder.png";
import srpOverviewMobileImg from "@v3/marketing/assets/srp-overview-mobile.png";

interface SRPOverviewSectionProps {
  showBullets?: boolean;
  showMobileVideo?: boolean;
  showButtons?: boolean;
  theme?: "dark" | "light";
  contentOverride?: {
    pill?: string;
    headline?: string;
    description?: string;
    bullets?: { icon: any; title: string; description: string }[];
    image?: string;
    imageScale?: string;
    alt?: string;
  };
  extraLeftContent?: React.ReactNode;
  primaryButtonHref?: string;
  secondaryButtonHref?: string;
  primaryButtonLabel?: string;
}

export const SRPOverviewSection = ({ showBullets = false, showMobileVideo = false, showButtons = true, theme = "dark", contentOverride, extraLeftContent, primaryButtonHref, secondaryButtonHref = "/request-a-demo", primaryButtonLabel }: SRPOverviewSectionProps) => {
  const isLight = theme === "light";
  const sectionBg = isLight ? "bg-white text-foreground" : "bg-[#262626] text-white";
  const headingColor = isLight ? "text-foreground" : "text-white";
  const bodyColor = isLight ? "text-muted-foreground" : "text-slate-300";
  const defaultBullets = [
    {
      icon: Zap,
      title: "Synchronized Signals",
      description: "Updates across your presence reinforce authority everywhere.",
    },
    {
      icon: Brain,
      title: "AI-First Architecture",
      description: "Feed modern search models the structured data they need to recommend you first.",
    },
    {
      icon: Trophy,
      title: "The Winning Edge",
      description: "Move from \"visible\" to consistently chosen.",
    },
  ];
  const bullets = contentOverride?.bullets || defaultBullets;
  const pillLabel = contentOverride?.pill || "Search Rank Platform";
  return (
    <section data-section-name="srp-overview" className={`py-12 sm:py-16 lg:py-28 px-4 ${sectionBg}`}>
      <div className="container mx-auto max-w-7xl">
        {/* Centered header - desktop only */}
        <div className="hidden lg:block text-center mb-14">
          <span className="inline-block text-xs sm:text-sm font-semibold tracking-wide uppercase mb-4" style={{ color: '#1a8ff1'}}>
            {pillLabel}
          </span>
          <h2 className={`font-heading text-[42px] leading-[1.1] ${headingColor} max-w-none mx-auto`}>
            {contentOverride?.headline || "One Platform. Your engine for AI and search visibility"}
          </h2>
          <p className={`font-body-light text-lg ${bodyColor} max-w-3xl mx-auto mt-5`}>
            {contentOverride?.description || "The Search Rank Platform (SRP) connects every signal that drives ranking—profiles, reviews, listings, connections, and site health—into one system built for modern search and AI."}
          </p>
        </div>

        {/* Mobile/tablet header */}
        <div className="lg:hidden text-left mb-4">
          <span className="inline-block text-xs sm:text-sm font-semibold tracking-wide uppercase mb-4" style={{ color: '#1a8ff1'}}>
            {pillLabel}
          </span>
          <h2 className={`font-heading text-3xl ${headingColor} mb-4`}>
            {contentOverride?.headline || "One Platform. Your engine for AI and search visibility"}
          </h2>
        </div>

        {/* Two-column: subtext+bullets left, video right */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          <div className="text-left lg:pr-8">
            <p className={`font-body-light text-base sm:text-lg ${bodyColor} mb-8 lg:hidden`}>
              {contentOverride?.description || "The Search Rank Platform (SRP) connects every signal that drives ranking—profiles, reviews, listings, connections, and site health—into one system built for modern search and AI."}
            </p>

            {/* Overview - mobile only */}
            {showMobileVideo ? (
              <div className="sm:hidden mb-8 overflow-hidden flex justify-center">
                <div className="relative w-full aspect-video bg-gray-100 rounded-xl flex items-center justify-center cursor-pointer group">
                  <img src={contentOverride?.image || srpOverviewImg} alt={contentOverride?.alt || "Search Rank Platform overview"} className="w-full h-auto rounded-xl" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-white/90 shadow-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Play className="w-7 h-7 text-foreground ml-1" fill="currentColor" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="sm:hidden mb-8 overflow-hidden flex justify-center">
                <img src={contentOverride?.image || srpOverviewMobileImg} alt={contentOverride?.alt || "Search Rank Platform overview"} className="w-full h-auto" />
              </div>
            )}

            {/* Overview image - tablet only */}
            <div className="hidden sm:block lg:hidden mb-8">
              <img src={contentOverride?.image || srpOverviewTabletImg} alt={contentOverride?.alt || "Search Rank Platform overview"} className="w-full h-auto rounded-2xl" />
            </div>

            <div className="space-y-5 mb-8">
              {bullets.map((bullet, index) => (
                <div key={index} className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-0.5" style={{ backgroundColor: 'rgba(26, 143, 241, 0.12)' }}>
                    <bullet.icon className="w-5 h-5" style={{ color: '#1a8ff1' }} />
                  </div>
                  <div>
                    <p className={`font-heading font-semibold ${headingColor} text-[17px] mb-1`}>{bullet.title}</p>
                    <p className={`font-body-light ${bodyColor} text-[15px] leading-relaxed`}>{bullet.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {showButtons && (
              <div className="flex flex-col sm:flex-row gap-4 pt-2">
                <div className="flex flex-col items-center gap-2">
                  {primaryButtonHref ? (
                    <a href={primaryButtonHref} target="_blank" rel="noopener noreferrer">
                      <Button
                        size="lg"
                        variant="white"
                        className="w-full sm:w-auto h-12 px-8 text-[15px] shadow-lg shadow-black/10 border border-border"
                      >
                        {primaryButtonLabel || "It's Free - sign up today"}
                        <ArrowRight className="w-5 h-5 ml-2" />
                      </Button>
                    </a>
                  ) : (
                    <Button
                      size="lg"
                      variant="white"
                      className="w-full sm:w-auto h-12 px-8 text-[15px] shadow-lg shadow-black/10 border border-border"
                    >
                      {primaryButtonLabel || "It's Free - sign up today"}
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  )}
                  <span className={`text-[13px] ${bodyColor}`}>For Professionals & Locations</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <a href={secondaryButtonHref}>
                    <Button
                      variant="outline"
                      size="lg"
                      className={`w-full sm:w-auto h-12 px-8 font-semibold border-2 text-[15px] bg-transparent ${isLight ? "border-foreground text-foreground hover:bg-foreground/5" : "border-white text-white hover:bg-white/10"}`}
                    >
                      Schedule a Call
                    </Button>
                  </a>
                  <span className={`text-[13px] ${bodyColor}`}>For Enterprises</span>
                </div>
              </div>
            )}
            {extraLeftContent}
          </div>

          {/* Right: Video - desktop only */}
          <div className="hidden lg:flex items-center justify-end">
            <img
              src={contentOverride?.image || srpOverviewImg}
              alt={contentOverride?.alt || "Search Rank Platform overview"}
              className={`w-full h-auto rounded-2xl lg:origin-right ${contentOverride?.imageScale || "lg:scale-100"}`}
            />
          </div>
        </div>
      </div>
    </section>
  );
};