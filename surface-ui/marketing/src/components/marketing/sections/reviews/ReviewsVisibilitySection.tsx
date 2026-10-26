import { Eye, Check } from "lucide-react";
import aiModeImg from "@v3/marketing/assets/reviews/ai-mode.png";

const items = ["Local search ranking signals", "Schema markup for star ratings", "Direct data syncing for AI discovery"];

export const ReviewsVisibilitySection = () => {
  return (
    <section className="py-12 sm:py-16 lg:py-20 px-4 bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Image */}
          <div className="order-1 lg:order-2 -mx-4 md:mx-0">
            <img
              src={aiModeImg}
              alt="AI-powered search result recommending a highly rated real estate professional based on reputation and expertise signals."
              className="w-full md:w-[75%] lg:w-full h-auto"
            />
          </div>

          {/* Content */}
          <div className="order-2 lg:order-1 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(26, 143, 241, 0.12)' }}>
                <Eye className="w-5 h-5" style={{ color: '#1a8ff1' }} />
              </div>
              <h3 className="font-heading text-xl text-foreground">Search and AI visibility</h3>
            </div>
            <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed">
              Make reviews readable and trustworthy for search engines and AI systems.
            </p>
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item} className="flex items-center gap-3 bg-white rounded-lg border border-border px-4 py-2.5">
                  <Check className="w-4 h-4 shrink-0" style={{ color: '#1a8ff1' }} />
                  <span className="text-sm font-medium text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};
