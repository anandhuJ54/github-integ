import { ogImageUrl } from "@/lib/marketing/seo";
import { ArrowRight, Building2, Home, Scale, ShieldCheck, TrendingUp } from "lucide-react";
import { SearchNavbar } from "@/components/marketing/SearchNavbar";
import { Button } from "@/components/marketing/ui/button";
import officeCat from "@/assets/office-cat.png";

const VERTICALS = [
  {
    name: "Mortgage",
    icon: Home,
    href: "https://www.experience.com/results?vertical=Mortgage",
  },
  {
    name: "Real Estate",
    icon: Building2,
    href: "https://www.experience.com/results?vertical=Real+Estate",
  },
  {
    name: "Legal",
    icon: Scale,
    href: "https://www.experience.com/results?vertical=Legal",
  },
  {
    name: "Insurance",
    icon: ShieldCheck,
    href: "https://www.experience.com/results?vertical=Insurance",
  },
  {
    name: "Finance",
    icon: TrendingUp,
    href: "https://www.experience.com/results?vertical=Finance",
  },
];

export const Custom404 = () => {
  const navigate = (to: string) => {
    window.location.href = to;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#EAF4FC] to-[#CFE6F7] flex flex-col relative overflow-hidden">
      <SearchNavbar />

      <div className="h-24" />

      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="max-w-3xl mx-auto text-center relative z-10 px-6 sm:px-10 py-10 sm:py-14">
          <div className="relative mb-2 sm:mb-4">
            <img
              src={officeCat}
              alt="Orange and white cat peeking over the top of the page, looking startled"
              className="w-48 sm:w-64 lg:w-72 h-auto mx-auto drop-shadow-2xl"
              width={1024}
              height={768}
              loading="eager"
            />
          </div>

          <h1 className="font-heading text-[40px] sm:text-[52px] lg:text-[64px] leading-[1.05] mb-5 text-card-foreground">
            This page did not pass the vibe check.
          </h1>

          <p className="font-body-light text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed mb-8">
            Our office cat took one look at it, hissed, and batted it into the internet abyss. But don't worry, we can help you find your way back.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto h-12 px-8 rounded-full border-2 border-[#0052FF] text-[#0052FF] hover:bg-[#0052FF]/10 hover:text-[#0052FF]"
              onClick={() => navigate("/")}
            >
              Go Home
            </Button>
            <Button
              size="lg"
              className="w-full sm:w-auto h-12 px-8 rounded-full bg-[#262626] text-white hover:bg-[#262626]/90"
              onClick={() => navigate("/contact-us")}
            >
              Report a Hairball
            </Button>
          </div>
        </div>

        <section className="w-full bg-white py-12 sm:py-16">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-8">
              <p className="font-body text-sm uppercase text-[#0052FF] uppercase tracking-[0.15em] mb-2">
                Lost your way in our search directory?
              </p>
              <h2 className="font-heading text-[26px] sm:text-[32px] lg:text-[36px] text-card-foreground mb-3">
                Let's get you back to the right spot?
              </h2>
              <p className="font-body-light text-base text-muted-foreground max-w-xl mx-auto">
                Pick an industry to jump directly to search results.
              </p>
            </div>

            <div className="flex flex-wrap justify-center items-start gap-6 sm:gap-8">
              {VERTICALS.map((v) => {
                const Icon = v.icon;
                return (
                  <a
                    key={v.name}
                    href={v.href}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white border border-[#E5E7EB] shadow-md flex items-center justify-center group-hover:shadow-lg group-hover:-translate-y-0.5 transition-all duration-200">
                      <Icon className="w-8 h-8 sm:w-10 sm:h-10 text-[#0052FF]" />
                    </div>
                    <span className="font-body text-sm text-card-foreground/80 group-hover:text-card-foreground">
                      {v.name}
                    </span>
                  </a>
                );
              })}
              <a
                href="https://www.experience.com/categories"
                className="flex flex-col items-center gap-2 group"
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#0052FF]/5 border-2 border-[#0052FF] flex items-center justify-center group-hover:bg-[#0052FF]/10 transition-colors duration-200">
                  <ArrowRight className="w-6 h-6 sm:w-7 sm:h-7 text-[#0052FF]" />
                </div>
                <span className="font-body text-sm text-[#0052FF] group-hover:text-[#0041CC]">
                  View all
                </span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <div className="h-8" />
    </div>
  );
};

export default Custom404;

export const seoMeta = [
  { title: "Page Not Found | Experience.com" },
  { "name": "description", "content": "The page you're looking for doesn't exist or may have moved. Head back to Experience.com's homepage or report the issue to our team." },
  { "name": "robots", "content": "noindex, follow" },
  { "property": "og:title", "content": "Page Not Found | Experience.com" },
  { "property": "og:description", "content": "The page you're looking for doesn't exist or may have moved. Head back to Experience.com's homepage or report the issue to our team." },
  { "property": "og:type", "content": "website" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "twitter:title", "content": "Page Not Found | Experience.com" },
  { "name": "twitter:description", "content": "The page you're looking for doesn't exist or may have moved. Head back to Experience.com's homepage or report the issue to our team." },
  { "property": "og:image", "content": ogImageUrl("not-found") },
  { "property": "og:image:secure_url", "content": ogImageUrl("not-found") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Illustration of an orange cat sitting beside a Page Not Found message." },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:image", "content": ogImageUrl("not-found") },
  { "name": "twitter:image:alt", "content": "Illustration of an orange cat sitting beside a Page Not Found message." },
];
