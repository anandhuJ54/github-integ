import { Button } from "@/components/marketing/ui/button";
import { ArrowRight } from "lucide-react";
import heroImage from "@/assets/insights/hero.png";
import { getSignUpUrl } from "@/lib/marketing/envUrls";

export const InsightsHeroSection = () => {
  return (
    <section className="relative bg-background overflow-hidden px-3 sm:px-4">
      <div className="absolute inset-0 bg-gradient-to-b from-purple-50/80 via-white to-blue-50/40"></div>
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-200/40 rounded-full blur-[120px]"></div>
      <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-blue-200/40 rounded-full blur-[120px]"></div>

      <div className="container mx-auto max-w-[1296px] pt-[10rem] md:pt-[12rem] lg:pt-[10rem] pb-0 relative z-10">
        <div className="text-left mb-12 lg:mb-0">
          <div className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center lg:pb-24">
            <div>
              <h1 className="font-heading text-[42px] lg:text-[60px] leading-[1.1] text-foreground mb-4 md:mb-6 sm:px-2 lg:px-0">
                Understand your performance.{" "}
                <span className="bg-gradient-to-r from-[#1a8ff1] to-[#28c3ef] bg-clip-text text-transparent">
                  Improve your rank.
                </span>
              </h1>

              <p className="font-body-light text-[17px] sm:text-[18px] md:text-[21px] text-muted-foreground max-w-3xl lg:max-w-none mx-auto lg:mx-0 mb-6 md:mb-8 sm:px-2 lg:px-0 leading-relaxed">
                Track visibility, engagement, and search performance in one place. Turn raw data into clear insights that show you where to focus next.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-start lg:justify-start gap-4 sm:px-0 lg:px-0">
                <a
                  href={getSignUpUrl("utm_source=insights_pg&utm_medium=signup_free&utm_campaign=top_btn")}
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
                  <Button size="lg" variant="white" className="w-full sm:w-auto font-semibold px-8">
                    Schedule a Call
                  </Button>
                </a>
              </div>
            </div>

            <div className="hidden lg:block">
              <img src={heroImage} alt="Experience.com Insights dashboard tracking customer visibility, profile views, clicks, impressions, and engagement trends " className="w-full h-auto" />
            </div>
          </div>
        </div>
      </div>

      <div className="w-full relative z-10 lg:hidden">
        <img
          src={heroImage}
          alt="Experience.com Insights dashboard tracking customer visibility, profile views, clicks, impressions, and engagement trends "
          className="w-full h-auto block relative left-1/2 -translate-x-1/2"
          style={{ width: "calc(100vw + 2px)" }}
        />
      </div>
    </section>
  );
};
