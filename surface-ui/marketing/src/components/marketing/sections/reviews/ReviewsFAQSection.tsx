import { ArrowRight, HelpCircle, Phone } from "lucide-react";
import { useState } from "react";
import { Link } from "@v3/marketing/components/marketing/link";
import { MobileCategoryAccordion } from "@v3/marketing/components/marketing/sections/shared/MobileCategoryAccordion";

const categories = [
  { label: "All", value: "all" },
  { label: "Basics", value: "basics" },
  { label: "Benefits", value: "benefits" },
  { label: "Features", value: "features" },
] as const;

type Category = (typeof categories)[number]["value"];
type FaqCategory = Exclude<Category, "all">;

const faqs: { question: string; answer: string; category: FaqCategory }[] = [
  {
    question: "What is review management software?",
    answer:
      "Review management software helps businesses collect, monitor, respond to, and distribute customer reviews from one place. Experience.com's Reviews product helps teams turn customer feedback into trust signals that strengthen reputation, improve search visibility, and influence AI-powered recommendations.",
    category: "basics",
  },
  {
    question: "How do customer reviews help businesses get chosen?",
    answer:
      "Customer reviews help businesses build trust at the moment customers are comparing options. Fresh, authentic reviews give buyers confidence, reinforce credibility across channels, and increase the likelihood that a business is selected over competitors.",
    category: "benefits",
  },
  {
    question: "How do reviews influence search visibility?",
    answer:
      "Reviews create fresh, relevant content and trust signals that search engines use to evaluate business credibility. A consistent flow of authentic reviews can improve local search performance, strengthen authority, and help businesses appear more prominently when customers are searching.",
    category: "benefits",
  },
  {
    question: "Can reviews help businesses appear in AI-powered recommendations?",
    answer:
      "Yes. Reviews give AI systems more trustworthy signals about customer experience, reputation, and business quality. When reviews are recent, authentic, and consistently managed, they help AI-driven search models better understand which businesses are credible enough to recommend.",
    category: "benefits",
  },
  {
    question: "How does Experience.com help businesses collect more reviews?",
    answer:
      "Experience.com helps businesses automatically request reviews through SMS and email at the right moments in the customer journey. This makes it easier to capture feedback while the experience is still fresh, improving response rates without creating friction for customers.",
    category: "features",
  },
  {
    question: "How does Experience.com help teams manage and respond to reviews?",
    answer:
      "Experience.com gives teams a centralized dashboard to monitor reviews across platforms and respond from one place. AI-assisted reply suggestions help businesses respond faster while maintaining brand consistency, accuracy, and compliance.",
    category: "features",
  },
  {
    question: "How does Experience.com help businesses use reviews across the buyer journey?",
    answer:
      "Experience.com helps businesses activate reviews beyond a single profile by syndicating verified feedback across profiles and social channels. This allows strong customer sentiment to reinforce credibility wherever buyers are researching and making decisions.",
    category: "features",
  },
  {
    question: "Is Experience.com's Reviews product built for multi-location and enterprise teams?",
    answer:
      "Yes. Experience.com's Reviews product is built for organizations that need control and consistency at scale. It supports governance workflows, hierarchy-based permissions, moderation tools, and multi-location review management so brands can protect reputation while growing efficiently.",
    category: "features",
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

export const ReviewsFAQSection = () => {
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
              Here are the questions we hear most about our Reviews product.
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

export default ReviewsFAQSection;