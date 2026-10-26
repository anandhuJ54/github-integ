import { Button } from "@v3/marketing/components/marketing/ui/button";
import { ArrowRight } from "lucide-react";
import facebookLogo from "@v3/marketing/assets/network-logos/facebook.svg";
import instagramLogo from "@v3/marketing/assets/network-logos/instagram.svg";
import linkedinLogo from "@v3/marketing/assets/network-logos/linkedin.svg";
import xLogo from "@v3/marketing/assets/network-logos/x.svg";
import socialHeroImg from "@v3/marketing/assets/social-hero.png";
import { getSignUpUrl } from "@v3/marketing/utils/marketing/envUrls";

const platforms = [
  { src: facebookLogo, alt: "Facebook" },
  { src: instagramLogo, alt: "Instagram" },
  { src: linkedinLogo, alt: "LinkedIn" },
  { src: xLogo, alt: "X" },
];

export const SocialHeroSection = () => {
  return (
    <section className="relative bg-background overflow-hidden px-3 sm:px-4">
      <div className="absolute inset-0 bg-gradient-to-b from-purple-50/80 via-white to-blue-50/40" />
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-200/40 rounded-full blur-[120px]" />
      <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-blue-200/40 rounded-full blur-[120px]" />

      <div className="container mx-auto max-w-[1296px] pt-[10rem] md:pt-[12rem] lg:pt-[10rem] pb-12 lg:pb-24 relative z-10">
        <div className="text-left">
          <div className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
            <div>
               <h1 className="font-heading text-[42px] lg:text-[60px] leading-[1.1] text-foreground mb-4 md:mb-6 sm:px-2 lg:px-0">
                Social media management{" "}
                <span className="bg-gradient-to-r from-[#1a8ff1] to-[#28c3ef] bg-clip-text text-transparent">
                  made simple.
                </span>
              </h1>

              <p className="font-body-light text-[17px] sm:text-[18px] md:text-[21px] text-muted-foreground max-w-3xl lg:max-w-none mx-auto lg:mx-0 mb-6 md:mb-8 sm:px-2 lg:px-0 leading-relaxed">
                Create, schedule, and publish social posts across every location from one dashboard. Turn your best reviews into content and stay visible where customers engage.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-start lg:justify-start gap-4 sm:px-0 lg:px-0">
                <a
                  href={getSignUpUrl("utm_source=social_pg&utm_medium=signup_free&utm_campaign=top_btn")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="lg"
                    className="w-full sm:w-auto font-semibold px-8 shadow-lg bg-[#1a8ff1] sm:bg-[#28c3ef] sm:hover:bg-[#1a8ff1] text-white border-none"
                  >
                    It's Free - sign up today
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
                <a href="/request-a-demo">
                  <Button
                    size="lg"
                    variant="white"
                    className="w-full sm:w-auto font-semibold px-8"
                  >
                    Schedule a Call
                  </Button>
                </a>
              </div>

              {/* Hero image - mobile & tablet */}
              <div className="lg:hidden mt-10 -mx-3 sm:-mx-4">
                <img 
                  src={socialHeroImg} 
                  alt="Professional creating, managing, and publishing social media content across major platforms from a centralized dashboard." 
                  className="w-full h-auto block"
                />
              </div>
            </div>

            {/* Hero image - desktop */}
            <div className="hidden lg:flex items-center justify-center">
              <img 
                src={socialHeroImg} 
                alt="Professional creating, managing, and publishing social media content across major platforms from a centralized dashboard." 
                className="w-full max-w-[660px] h-auto"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
