import { ArrowRight, HelpCircle, Phone } from "lucide-react";
import { useState } from "react";
import { Link } from "@v3/marketing/components/marketing/link";
import { MobileCategoryAccordion } from "@v3/marketing/components/marketing/sections/shared/MobileCategoryAccordion";

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
    question: "What is social media management software?",
    answer:
      "Social media management software helps businesses create, schedule, publish, and manage content across multiple social platforms from one place. Experience.com's Social product helps businesses stay visible, maintain brand consistency, and turn customer feedback into social content without adding manual effort.",
    category: "basics",
  },
  {
    question: "How does social media management help businesses stay visible?",
    answer:
      "Social media management helps businesses stay active and consistent across the platforms where customers engage. When businesses publish regularly and maintain a steady presence, they stay top of mind and reinforce trust with both current and potential customers.",
    category: "basics",
  },
  {
    question: "How does Experience.com help businesses manage social media from one place?",
    answer:
      "Experience.com gives businesses a centralized dashboard to create posts, preview content, schedule updates, and publish across multiple social platforms. This makes it easier to manage a social presence efficiently while keeping messaging and branding consistent.",
    category: "features",
  },
  {
    question: "Can businesses schedule social media posts in advance?",
    answer:
      "Yes. Experience.com helps businesses plan content ahead of time by scheduling posts days or weeks in advance. Teams can prepare captions, upload media, preview how posts will appear on each platform, and publish at the right times without daily manual work.",
    category: "features",
  },
  {
    question: "Can Experience.com publish to multiple social platforms at once?",
    answer:
      "Yes. Experience.com helps businesses publish content across major social platforms from one dashboard. This allows teams to write once, share everywhere, and maintain a more consistent presence without repeating the same work on each channel.",
    category: "features",
  },
  {
    question: "How does Experience.com turn reviews into social content?",
    answer:
      "Experience.com helps businesses automatically turn strong customer reviews into branded social posts. By sharing positive feedback across social channels, businesses can extend the reach of their reputation and build credibility where customers are already engaging.",
    category: "features",
  },
  {
    question: "How do customer reviews help social media marketing?",
    answer:
      "Customer reviews add authentic social proof to social media content. When businesses share real customer feedback, it helps build trust, strengthen credibility, and make social posts more persuasive to potential customers who are evaluating their options.",
    category: "visibility",
  },
  {
    question: "How does Experience.com help maintain brand consistency on social media?",
    answer:
      "Experience.com helps businesses maintain brand consistency with centralized publishing, post previews, customizable templates, and controlled scheduling workflows. This helps teams ensure that content looks accurate, on-brand, and aligned across locations and profiles.",
    category: "features",
  },
  {
    question: "Is Experience.com's Social product built for multi-location businesses?",
    answer:
      "Yes. Experience.com's Social product is designed for businesses that need to manage multiple profiles, locations, and teams from one secure dashboard. It helps organizations scale their social presence while maintaining oversight, consistency, and control.",
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

export const SocialFAQSection = () => {
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
              Here are the questions we hear most about our Social product.
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

export default SocialFAQSection;