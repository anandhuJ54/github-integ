import { Share2, Globe, BadgeCheck } from "lucide-react";
import socialSharingImg from "@v3/marketing/assets/reviews-activate-opt3.png";

const bullets = [
  { icon: Share2, text: "Direct social sharing integrations" },
  { icon: Globe, text: "Profile-wide review syndication" },
  { icon: BadgeCheck, text: "Verified social proof highlights" },
];

export const ReviewsActivateSection = () => {
  return (
    <section className="py-12 sm:py-16 lg:py-20 px-4 bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Image */}
          <div className="order-1 lg:order-1 -mx-4 md:mx-0 md:flex md:justify-center lg:block lg:-ml-[15%]">
            <img
              src={socialSharingImg}
              alt="Five-star customer review automatically shared across social media channels using social publishing automation."
              className="w-full lg:w-[115%] lg:max-w-none h-auto"
            />
          </div>

          {/* Content */}
          <div className="order-2 lg:order-2 space-y-4 lg:pl-[40px]">
            <h3 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
              Activate reviews across the buyer journey
            </h3>
            <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed">
              Showcase your strongest reviews where customers are researching and deciding. Syndicate verified feedback across profiles and social channels to reinforce credibility at every touchpoint.
            </p>

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
        </div>
      </div>
    </section>
  );
};
