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
    question: "What is content marketing software for professional services?",
    answer:
      "Content marketing software helps businesses research, create, publish, and manage content that builds visibility and trust. Experience.com's Content product helps professionals and businesses create content that supports discovery across search and AI-powered results without adding extra tools or workflow complexity.",
    category: "basics",
  },
  {
    question: "How does content help customers find a business online?",
    answer:
      "Content helps businesses appear when customers search for topics, questions, and services related to their expertise. When content is clear, relevant, and consistently published, it strengthens visibility in search results and increases the chances that customers discover the business during key decision-making moments.",
    category: "benefits",
  },
  {
    question: "How does content support AI-powered discovery?",
    answer:
      "AI-powered search systems look for useful, well-structured, and trustworthy content when generating answers. Publishing clear content tied to real expertise helps AI systems better understand what a business knows, making it more likely that the business is surfaced, referenced, or chosen in AI-powered discovery.",
    category: "benefits",
  },
  {
    question: "How does Experience.com help businesses create content?",
    answer:
      "Experience.com gives businesses a dedicated workspace to research topics, draft articles, refine messaging, and manage publishing in one place. Powered by VOCE, the platform helps businesses create content efficiently while keeping control of voice, expertise, and brand consistency.",
    category: "features",
  },
  {
    question: "What is VOCE?",
    answer:
      "VOCE is Experience.com's AI writing and publishing workspace. It is where businesses create and manage content, while Experience.com connects that content to visibility, reputation, and discovery across the web.",
    category: "basics",
  },
  {
    question: "Can businesses use AI to create content without losing their voice?",
    answer:
      "Yes. Experience.com's AI writing studio supports content creation while keeping businesses in control of their voice and expertise. It helps research, draft, and refine content so teams can create more consistently without losing authenticity.",
    category: "features",
  },
  {
    question: "How does publishing content improve search visibility?",
    answer:
      "Publishing content improves search visibility by giving search engines more relevant, topic-specific information to index and understand. Consistent publishing around real customer questions helps reinforce expertise, increase relevance, and improve the likelihood that a business appears in search results.",
    category: "benefits",
  },
  {
    question: "How does Experience.com help businesses publish and distribute content?",
    answer:
      "Experience.com helps businesses publish content and extend its reach across channels. Articles can be shared with followers, distributed across social channels, and supported through broader publishing workflows so businesses can strengthen visibility wherever customers are searching.",
    category: "features",
  },
  {
    question: "Why is answering customer questions important for visibility?",
    answer:
      "Customers often search in the form of questions. When a business publishes clear answers tied to its real expertise, it increases the likelihood of appearing in relevant searches and being considered during moments when customers are actively evaluating options.",
    category: "benefits",
  },
  {
    question: "How does structured content support search and AI visibility?",
    answer:
      "Structured content makes it easier for search engines and AI-powered systems to understand topics, connect expertise, and evaluate trustworthiness. Clear formatting, consistent publishing, and connected business profiles help strengthen the signals that support visibility across both search and AI-powered discovery.",
    category: "benefits",
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

export const ContentFAQSection = () => {
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
              Here are the questions we hear most about our Content product.
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

export default ContentFAQSection;
