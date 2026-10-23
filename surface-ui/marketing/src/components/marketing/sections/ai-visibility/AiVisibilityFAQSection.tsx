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
    question: "What is AI visibility in search?",
    answer:
      "AI visibility refers to how likely your business is to be surfaced, referenced, or chosen in AI-generated answers when customers search. Instead of focusing only on traditional rankings, AI visibility measures how well your business is positioned to be recognized as a trusted source by AI-powered search systems.",
    category: "basics",
  },
  {
    question: "How does AI-powered search choose which businesses to reference?",
    answer:
      "AI-powered search systems generate answers by selecting sources they view as relevant, credible, and consistent. Businesses are more likely to be chosen when they demonstrate expertise, publish helpful content, maintain accurate business information, and reinforce trust signals across their online presence.",
    category: "basics",
  },
  {
    question: "What is an AI Authority Score?",
    answer:
      "An AI Authority Score reflects how strongly your business is positioned to be used as a source in AI-generated answers. It brings together signals tied to expertise, relevance, and consistency so you can understand what supports stronger AI visibility over time.",
    category: "basics",
  },
  {
    question: "Why does AI visibility matter for businesses?",
    answer:
      "As more customers use AI-powered search to discover businesses, visibility is no longer just about appearing in a list of links. Businesses that are recognized and referenced in AI-generated answers have a better chance of being considered, trusted, and chosen during the decision-making process.",
    category: "benefits",
  },
  {
    question: "How can businesses improve AI visibility?",
    answer:
      "Businesses can improve AI visibility by publishing useful content, answering common customer questions, maintaining accurate profiles, and reinforcing expertise across the web. Strong business information, consistent signals, and ongoing publishing all help AI systems better understand and trust your business.",
    category: "features",
  },
  {
    question: "How does content help increase AI visibility?",
    answer:
      "Content helps businesses demonstrate expertise in the topics customers are searching for. When a business consistently publishes clear, relevant, and helpful content, it strengthens the signals that AI-powered search systems use to determine whether that business should be referenced in generated answers.",
    category: "features",
  },
  {
    question: "How does Experience.com help businesses improve AI visibility?",
    answer:
      "Experience.com helps businesses measure and strengthen AI visibility by showing how they appear in AI-powered search and identifying what improves their likelihood of being surfaced. It connects visibility insights with the content, authority, and search foundation needed to help businesses become stronger AI search sources.",
    category: "features",
  },
  {
    question: "How does AI Visibility connect to search performance?",
    answer:
      "AI visibility builds on the same signals that support strong search performance, including accurate business information, consistent profiles, and active publishing. When these signals work together, they strengthen trust, reinforce relevance, and improve the likelihood that a business is surfaced in both search and AI-generated answers.",
    category: "benefits",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is AI visibility in search?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AI visibility refers to how likely your business is to be surfaced, referenced, or chosen in AI-generated answers when customers search. Instead of focusing only on traditional rankings, AI visibility measures how well your business is positioned to be recognized as a trusted source by AI-powered search systems.",
      },
    },
    {
      "@type": "Question",
      name: "How does AI-powered search choose which businesses to reference?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AI-powered search systems generate answers by selecting sources they view as relevant, credible, and consistent. Businesses are more likely to be chosen when they demonstrate expertise, publish helpful content, maintain accurate business information, and reinforce trust signals across their online presence.",
      },
    },
    {
      "@type": "Question",
      name: "What is an AI Authority Score?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "An AI Authority Score reflects how strongly your business is positioned to be used as a source in AI-generated answers. It brings together signals tied to expertise, relevance, and consistency so you can understand what supports stronger AI visibility over time.",
      },
    },
    {
      "@type": "Question",
      name: "Why does AI visibility matter for businesses?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "As more customers use AI-powered search to discover businesses, visibility is no longer just about appearing in a list of links. Businesses that are recognized and referenced in AI-generated answers have a better chance of being considered, trusted, and chosen during the decision-making process.",
      },
    },
    {
      "@type": "Question",
      name: "How can businesses improve AI visibility?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Businesses can improve AI visibility by publishing useful content, answering common customer questions, maintaining accurate profiles, and reinforcing expertise across the web. Strong business information, consistent signals, and ongoing publishing all help AI systems better understand and trust your business.",
      },
    },
    {
      "@type": "Question",
      name: "How does content help increase AI visibility?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Content helps businesses demonstrate expertise in the topics customers are searching for. When a business consistently publishes clear, relevant, and helpful content, it strengthens the signals that AI-powered search systems use to determine whether that business should be referenced in generated answers.",
      },
    },
    {
      "@type": "Question",
      name: "How does Experience.com help businesses improve AI visibility?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Experience.com helps businesses measure and strengthen AI visibility by showing how they appear in AI-powered search and identifying what improves their likelihood of being surfaced. It connects visibility insights with the content, authority, and search foundation needed to help businesses become stronger AI search sources.",
      },
    },
    {
      "@type": "Question",
      name: "How does AI Visibility connect to search performance?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AI visibility builds on the same signals that support strong search performance, including accurate business information, consistent profiles, and active publishing. When these signals work together, they strengthen trust, reinforce relevance, and improve the likelihood that a business is surfaced in both search and AI-generated answers.",
      },
    },
  ],
};

const VISIBLE_COUNT = 6;

export const AiVisibilityFAQSection = () => {
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
              Here are the questions we hear most about our AI Visibility product.
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

export default AiVisibilityFAQSection;
