import { Button } from "@/components/marketing/ui/button";
import { Inbox, Sparkles, BarChart3, ArrowRight } from "lucide-react";
import aiReplyImg from "@/assets/reviews-manage-opt2.png";

const bullets = [
  { icon: Inbox, text: "Centralized multi-platform inbox" },
  { icon: Sparkles, text: "AI-assisted reply suggestions" },
  { icon: BarChart3, text: "Review-level sentiment and trend alerts" },
];

export const ReviewsManageSection = () => {
  return (
    <section className="py-12 sm:py-16 lg:py-20 px-4 relative overflow-hidden">
      {/* Light gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-background to-purple-50" />
      <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-accent/5 rounded-full blur-[120px]" />

      <div className="container mx-auto max-w-7xl relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Content */}
            <div className="order-2 lg:order-1 space-y-4 lg:max-w-[calc(100%-10px)] lg:pr-[40px]">
              <h3 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
                Manage and respond from one place
              </h3>
              <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed">
                Monitor and respond to every review from a single dashboard. Use AI-assisted responses to ensure timely, on-brand communication while maintaining accuracy and compliance.
              </p>

              {/* Mobile image below subtext */}
              <div className="md:hidden w-full">
                <img src={aiReplyImg} alt="Professional using AI-assisted review management to generate responses to customer reviews from a centralized dashboard." className="w-full h-auto" />
              </div>

              <ul className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-2 sm:gap-3 pt-2">
                {bullets.map((bullet) => {
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

            </div>

          {/* Image (tablet + desktop) */}
          <div className="hidden md:flex order-1 lg:order-2 md:justify-center lg:block lg:-ml-[10%]">
            <img
              src={aiReplyImg}
              alt="Professional using AI-assisted review management to generate responses to customer reviews from a centralized dashboard."
              className="w-full lg:w-[115%] lg:max-w-none h-auto"
            />
          </div>
        </div>
      </div>
    </section>
  );
};
