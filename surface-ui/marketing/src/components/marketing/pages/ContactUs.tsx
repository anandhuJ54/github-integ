import { ogImageUrl } from "@v3/marketing/utils/marketing/seo";
import { Button } from "@v3/marketing/components/marketing/ui/button";
import { ArrowRight } from "lucide-react";


import { ContactUsFAQSection } from "@v3/marketing/components/marketing/sections/contact-us/ContactUsFAQSection";
import { ContactUsArticlesSection } from "@v3/marketing/components/marketing/sections/contact-us/ContactUsArticlesSection";
import orbitRings from "@v3/marketing/assets/orbit-rings.png";
import supportTeamDuo from "@v3/marketing/assets/support-team-duo.png";

type PathwayContact = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
};

const PATHWAYS: {
  id: string;
  headline: string;
  body: string;
  cta: { label: string; href: string };
  contacts: PathwayContact[];
}[] = [
  {
    id: "knowledge-base",
    headline: "Knowledge Base",
    body: "Need a quick answer? Explore our self-service resources.",
    cta: { label: "Search Help Center", href: "#" },
    contacts: [],
  },
  {
    id: "contact-sales",
    headline: "Contact Sales",
    body: "Connect with our team to strengthen your local search visibility and grow your reputation everywhere customers look — including AI search.",
    cta: { label: "Schedule a Call", href: "/request-a-demo" },
    contacts: [],
  },
  {
    id: "contact-support",
    headline: "Contact Support",
    body: "Already a customer? Sign in to submit a ticket and reach our support team.",
    cta: { label: "Sign into your Account", href: "https://app.experience.com/user/signin?utm_source=contact_us_pg&utm_medium=sign_into_your_account&utm_campaign=mid_btn" },
    contacts: [],
  },
];


const ContactUs = () => {
  return (
    <>

      {/* ─── HERO ─── */}
      <section className="bg-white pt-32 lg:pt-40 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="container mx-auto max-w-7xl">
          <div className="grid lg:grid-cols-2 items-end gap-8 lg:gap-12">
            {/* Image — left on desktop, below text on mobile */}
            <div className="relative flex justify-center lg:justify-start order-2 lg:order-1">
              <img
                src={orbitRings}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none scale-125"
              />
              <img
                src={supportTeamDuo}
                alt="Two Experience.com team members in company t-shirts, ready to connect with customers and brands"
                width={1200}
                height={600}
                className="relative w-full h-auto scale-110 lg:max-w-none lg:scale-125"
              />
            </div>

            {/* Text — right on desktop, first on mobile */}
            <div className="max-w-xl lg:max-w-lg lg:ml-auto order-1 lg:order-2 self-center pb-16 lg:pb-16">
              <p className="text-[13px] font-semibold tracking-[0.18em] uppercase text-[#2196F3] mb-5">
                GET IN TOUCH WITH US
              </p>
              <h1 className="font-heading text-[42px] lg:text-[60px] text-[#262626] leading-[1.1] mb-4 md:mb-6">
                How can we help you{" "}
                <span className="text-[#0052FF]">experience more?</span>
              </h1>
              <p className="font-body-light text-[17px] sm:text-[18px] md:text-[21px] text-slate-500 leading-relaxed mb-6 md:mb-8">
                Whether you're a customer needing technical assistance or a brand looking to boost your digital authority, our team is ready to connect.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SUPPORT PATHWAYS + FAQ ─── */}
      <section className="bg-gradient-to-b from-[#EFF4FB] to-[#E4ECF7] py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="container mx-auto max-w-7xl">
          <div className="grid lg:grid-cols-[380px_1fr] gap-8 lg:gap-12 items-start">
            {/* Left column: stacked pathway cards */}
            <div className="space-y-4">
              {PATHWAYS.map(({ id, headline, body, cta, contacts }) => {
                const isKnowledgeBase = id === "knowledge-base";
                return (
                  <div
                    key={id}
                    className={`rounded-2xl p-5 border shadow-sm hover:shadow-md transition-shadow flex flex-col ${
                      isKnowledgeBase ? "bg-[#262626] border-[#262626]" : "bg-white border-slate-100"
                    }`}
                  >
                    <h3 className={`font-heading text-[22px] mb-2 leading-tight ${isKnowledgeBase ? "text-white" : "text-[#262626]"}`}>

                    </h3>
                    <p className={`text-sm leading-relaxed mb-4 ${isKnowledgeBase ? "text-white/70" : "text-slate-500"}`}>
                      {body}
                    </p>

                    {isKnowledgeBase ? (
                      <div className="flex flex-col gap-3 mb-4">
                        <Button asChild className="h-10 px-5 rounded-full border border-white bg-transparent text-white hover:bg-[#2196F3] hover:border-[#2196F3] hover:text-white font-semibold w-full justify-between transition-colors">
                          <a href="https://buyersroad.atlassian.net/wiki/spaces/Documentat/overview" target="_blank" rel="noopener noreferrer">
                            Browse Help Center
                            <ArrowRight className="w-4 h-4" />
                          </a>
                        </Button>
                      </div>
                    ) : (
                      <Button asChild className="h-10 px-6 rounded-full w-full justify-between mb-4 bg-white text-[#262626] border border-[#262626] hover:bg-[#2196F3] hover:border-[#2196F3] hover:text-white font-semibold transition-colors">
                        <a href={cta.href}>
                          {cta.label}
                          <ArrowRight className="w-4 h-4" />
                        </a>
                      </Button>
                    )}

                    {contacts.length > 0 && (
                      <div className="space-y-2 mt-auto pt-5 border-t border-slate-100">
                        {contacts.map(({ icon: CIcon, label, href }) =>
                          href ? (
                            <a key={label} href={href} className="flex items-center gap-3 text-[14px] text-[#262626] hover:text-[#0052FF] transition-colors">
                              <CIcon className="w-4 h-4 text-slate-400 shrink-0" />
                              <span className="font-medium">{label}</span>
                            </a>
                          ) : (
                            <div key={label} className="flex items-center gap-3 text-[14px] text-slate-500">
                              <CIcon className="w-4 h-4 text-slate-400 shrink-0" />
                              <span>{label}</span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right column: FAQ search + accordion */}
            <div className="lg:pl-16">
              <ContactUsFAQSection />
            </div>
          </div>
        </div>
      </section>

      {/* ─── ARTICLES ─── */}
      <ContactUsArticlesSection />

    </>
  );
};

export default ContactUs;

export const seoMeta = [
  { title: "Contact Experience.com | Local Search Visibility & Reputation Management" },
  { "name": "description", "content": "Connect with Experience.com for sales, support, or self-service resources. Get help improving your local search visibility, reputation, and customer experience." },
  { "name": "keywords", "content": "Contact Experience.com, Experience.com support, Experience.com sales, help center, reputation management support, local search visibility support, AI search visibility support" },
  { "name": "robots", "content": "index, follow" },
  { "property": "og:title", "content": "Contact Experience.com | Local Search Visibility & Reputation Management" },
  { "property": "og:description", "content": "Connect with Experience.com for sales, support, or self-service resources. Get help improving your local search visibility, reputation, and customer experience." },
  { "property": "og:url", "content": "https://www.experience.com/contact-us" },
  { "property": "og:type", "content": "website" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:title", "content": "Contact Experience.com | Local Search Visibility & Reputation Management" },
  { "name": "twitter:description", "content": "Connect with Experience.com for sales, support, or self-service resources. Get help improving your local search visibility, reputation, and customer experience." },
  { "name": "twitter:site", "content": "@experience__com" },
  { "property": "og:image", "content": ogImageUrl("contact-us") },
  { "property": "og:image:secure_url", "content": ogImageUrl("contact-us") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Experience.com support team ready to help with local search visibility and reputation management." },
  { "name": "twitter:image", "content": ogImageUrl("contact-us") },
  { "name": "twitter:image:alt", "content": "Experience.com support team ready to help with local search visibility and reputation management." },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/contact-us" },
];
