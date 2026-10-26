import { Shield, Check } from "lucide-react";
import flaggedReviewImg from "@v3/marketing/assets/reviews/flagged-review.png";

const items = ["Automated content moderation", "Spam and sensitive content filters", "Centralized approval workflows"];

export const ReviewsGovernanceSection = () => {
  return (
    <section className="py-12 sm:py-16 lg:py-20 px-4 relative overflow-hidden">
      {/* Light gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-background to-purple-50" />
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-accent/5 rounded-full blur-[120px]" />

      <div className="container mx-auto max-w-7xl relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Image */}
          <div className="order-1 lg:order-1 -mx-4 md:mx-0">
            <img
              src={flaggedReviewImg}
              alt="Review moderation system automatically detecting inappropriate content and sensitive information for compliance review."
              className="w-full md:w-[75%] lg:w-full h-auto"
            />
          </div>

          {/* Content */}
          <div className="order-2 lg:order-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(26, 143, 241, 0.12)' }}>
                <Shield className="w-5 h-5" style={{ color: '#1a8ff1' }} />
              </div>
              <h3 className="font-heading text-xl text-foreground">Reputation governance</h3>
            </div>
            <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed">
              Ensure reviews meet brand, legal, and compliance standards.
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
