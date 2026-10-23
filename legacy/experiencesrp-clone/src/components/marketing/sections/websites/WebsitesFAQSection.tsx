import { ArrowRight, HelpCircle, Phone } from "lucide-react";
import { useState } from "react";
import { Link } from "@/components/marketing/link";
import { MobileCategoryAccordion } from "@/components/marketing/sections/shared/MobileCategoryAccordion";

const categories = [
  { label: "All", value: "all" },
  { label: "Basics", value: "basics" },
  { label: "Visibility", value: "visibility" },
  { label: "Features", value: "features" },
] as const;

type Category = (typeof categories)[number]["value"];
type FaqCategory = Exclude<Category, "all">;

const faqs: { question: string; answer: string; category: FaqCategory }[] = [
  {
    question: "What is website optimization software for search visibility?",
    answer:
      "Website optimization software helps businesses improve the performance, structure, and trust signals of their web presence so customers can find them more easily. Experience.com's Website product helps businesses audit their sites, strengthen search and AI signals, and launch high-performance profiles and websites that support visibility and conversion.",
    category: "basics",
  },
  {
    question: "How does website performance affect search visibility?",
    answer:
      "Website performance affects how search engines evaluate trust, usability, and relevance. Factors like page speed, site security, structured information, and overall completeness influence whether a website is positioned to rank well and create a strong experience for customers.",
    category: "basics",
  },
  {
    question: "What is a Web Analytics Score?",
    answer:
      "A Web Analytics Score measures the health of a website across important search and visibility factors. Experience.com's Web Analytics Score evaluates signals such as business information, profile data, HTML structure, site security, reviews, and other key elements so businesses can prioritize the fixes that matter most.",
    category: "features",
  },
  {
    question: "How does Experience.com help businesses audit their website?",
    answer:
      "Experience.com helps businesses scan their website against the signals search engines reward, identify gaps, and focus on high-impact improvements. The platform provides prioritized recommendations, tracks website completion, and allows businesses to refresh their score on demand to measure progress over time.",
    category: "features",
  },
  {
    question: "What is a web profile and why does it matter?",
    answer:
      "A web profile is a customer-facing online destination that showcases important business information, reviews, ratings, and recognition in one place. A highly indexed web profile helps businesses strengthen trust signals, improve discoverability, and give customers a clear place to evaluate and choose them.",
    category: "basics",
  },
  {
    question: "How does Experience.com help businesses create high-performance web profiles?",
    answer:
      "Experience.com helps businesses launch highly indexed web profiles designed to build trust and drive action. These profiles bring together reviews, ratings, recognition, and complete business details so customers can easily find, assess, and engage with a business online.",
    category: "features",
  },
  {
    question: "Can Experience.com help businesses build search-optimized websites at scale?",
    answer:
      "Yes. Experience.com helps organizations create fully managed, search-optimized websites designed for multiple teams, locations, or brands. These websites are structured to support visibility, compliance, performance, and long-term growth as the business expands.",
    category: "features",
  },
  {
    question: "How do websites support AI-powered search visibility?",
    answer:
      "Websites support AI-powered search visibility by providing structured, trustworthy, and complete information that AI systems can interpret. Strong site performance, clear business details, and connected trust signals help AI-powered search systems better understand a business and increase the likelihood that it is surfaced in results.",
    category: "visibility",
  },
  {
    question: "How does Experience.com help businesses improve visibility in local markets?",
    answer:
      "Experience.com helps businesses strengthen local visibility with indexed profiles, search-focused website improvements, and options to promote visibility in targeted ZIP codes. This helps businesses appear more prominently in the markets where customers are actively searching and making decisions.",
    category: "visibility",
  },
  {
    question: "How does website performance connect to reviews, listings, and profiles?",
    answer:
      "Website performance works best when it is aligned with the rest of a business's digital presence. When websites, profiles, reviews, and listings reinforce the same trust and accuracy signals, they strengthen search visibility together and help customers move from discovery to action with more confidence.",
    category: "visibility",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

const VISIBLE_COUNT = 6;

export const WebsitesFAQSection = () => {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [showAllExpanded, setShowAllExpanded] = useState(false);

  const filtered =
    activeCategory === "all" ? faqs : faqs.filter((f) => f.category === activeCategory);

  const allVisibleCount = showAllExpanded ? filtered.length : VISIBLE_COUNT;
  const visible =
    activeCategory === "all"
      ? filtered.slice(0, allVisibleCount)
      : filtered.slice(0, VISIBLE_COUNT);

  const hasMoreDesktop =
    activeCategory === "all"
      ? !showAllExpanded && filtered.length > VISIBLE_COUNT
      : filtered.length > VISIBLE_COUNT;
  const MOBILE_VISIBLE_COUNT = 3;
  const hasMoreMobile = !showAllExpanded && filtered.length > MOBILE_VISIBLE_COUNT;
  const hasMore = hasMoreDesktop || hasMoreMobile;

  const handleCategoryChange = (cat: Category) => {
    setActiveCategory(cat);
    setShowAllExpanded(false);
  };

  return (
    <section className="py-20 sm:py-24 px-4 bg-gradient-to-b from-[#EFF4FB] to-[#E4ECF7]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-8">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8 mb-12">
          <div className="max-w-2xl">
            <p className="text-[13px] font-semibold tracking-[0.18em] uppercase text-[#2196F3] mb-5">
              Frequently asked questions
            </p>
            <h2
              className="text-[30px] md:text-[36px] lg:text-[42px] font-semibold text-slate-900 leading-[1.1] mb-5"
              style={{ letterSpacing: "-0.02em" }}
            >
              Let's clear things up
            </h2>
            <p className="text-[16px] md:text-[18px] font-light text-slate-500" style={{ letterSpacing: "0.01em" }}>
              Here are the questions we hear most about our Website product.
            </p>
          </div>
          <Link
            to="/contact-us"
            className="inline-flex items-center gap-2 self-start px-6 py-3 rounded-full bg-white border border-border text-foreground font-medium text-[15px] hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Phone className="w-4 h-4" />
            Contact us
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>

        {/* Category pills */}
                <MobileCategoryAccordion categories={categories} activeCategory={activeCategory} onChange={handleCategoryChange} />
        <div className="hidden sm:inline-flex flex-wrap items-center gap-1 p-1.5 rounded-full bg-white/60 border border-white mb-10">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => handleCategoryChange(cat.value)}
              className={`px-5 py-2 rounded-full text-[14px] font-medium transition-all ${
                activeCategory === cat.value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "bg-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Cards grid with fade */}
        <div className="relative">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visible.map((faq, i) => {
              const isDark = i === 0;
              return (
                <div
                  key={faq.question}
                  className={`rounded-3xl p-10 flex-col gap-10 min-h-[420px] transition-all ${
                    !showAllExpanded && i >= MOBILE_VISIBLE_COUNT ? "hidden sm:flex" : "flex"
                  } ${
                    isDark
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center border ${
                      isDark
                        ? "bg-white/5 border-white/15 text-white/80"
                        : "bg-white border-slate-200 text-slate-500"
                    }`}
                  >
                    <HelpCircle className="w-[18px] h-[18px]" strokeWidth={1.5} />
                  </div>
                  <div className="space-y-3">
                    <h3
                      className={`text-[19px] md:text-[20px] font-semibold leading-snug ${
                        isDark ? "text-white" : "text-slate-900"
                      }`}
                      style={{ letterSpacing: "-0.01em" }}
                    >
                      {faq.question}
                    </h3>
                    <p
                      className={`text-[15px] leading-[1.65] ${
                        isDark ? "text-white/65" : "text-slate-500"
                      }`}
                    >
                      {faq.answer}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className={hasMoreDesktop ? "" : "sm:hidden"}>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent via-[#E4ECF7]/80 to-[#E4ECF7]" />
              <div className="absolute inset-x-0 -bottom-2 flex justify-center">
                {activeCategory === "all" ? (
                  <button
                    onClick={() => setShowAllExpanded(true)}
                    className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-slate-900 text-white font-medium text-[15px] hover:bg-slate-800 transition-colors shadow-lg"
                  >
                    View all
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <Link
                    to="/faq"
                    className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-slate-900 text-white font-medium text-[15px] hover:bg-slate-800 transition-colors shadow-lg"
                  >
                    View all
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default WebsitesFAQSection;