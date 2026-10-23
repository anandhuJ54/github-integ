import { ArrowRight } from "lucide-react";

const articles = [
  {
    readTime: "Press Release",
    title: "Experience.com Launches AI Visibility to Help Businesses Measure and Improve Their Presence in AI Search",
    date: "Jul 2026",
    href: "https://try.experience.com/resources/ai-visibility-to-help-businesses-measure-and-improve-their-presence-in-ai-search/",
  },
  {
    readTime: "Press Release",
    title: "Experience.com Partners with VOCE to Help Professionals Build Trust in AI Search",
    date: "Jun 2026",
    href: "https://try.experience.com/resources/ai-visibility-voce-partnership/",
  },
  {
    readTime: "Press Release",
    title: "Experience.com's Mortgage Performance Report for 2025: The Lenders and Loan Officers Leading the Market",
    date: "Jun 2026",
    href: "https://try.experience.com/resources/mortgage-performance-report-for-2025/",
  },
  {
    readTime: "Press Release",
    title: "2025 Top Performers Results",
    date: "Jun 2026",
    href: "https://try.experience.com/resources/2025-top-performers-results/",
  },
  {
    readTime: "Article",
    title: "How to Rank Higher on Google Without Ads (Local SEO Guide for 2026)",
    date: "May 2026",
    href: "https://try.experience.com/resources/how-to-rank-higher-on-google-without-ads/",
  },
  {
    readTime: "Article",
    title: "AI Search for Mortgage Loan Officers: How to Get Found by Borrowers",
    date: "Apr 2026",
    href: "https://try.experience.com/resources/ai-search-for-mortgage-loan-officers/",
  },
  {
    readTime: "Article",
    title: "What Is Search Ranking and Why It Matters in 2026",
    date: "Apr 2026",
    href: "https://try.experience.com/resources/what-is-search-ranking/",
  },
  {
    readTime: "Article",
    title: "Review Gating and Google Policy: Why Google Must Be Included Across Workflows",
    date: "Mar 2026",
    href: "https://try.experience.com/resources/review-gating-google-policy-workflows/",
  },
  {
    readTime: "Article",
    title: "Experience.com Recognized Across G2 Spring 2026 Reports With 41 Badges",
    date: "Mar 2026",
    href: "https://try.experience.com/resources/g2-spring-2026-experience-com-results/",
  },
  {
    readTime: "Article",
    title: "Your Online Reputation Is Your New Resume",
    date: "Mar 2026",
    href: "https://try.experience.com/resources/reputation-is-the-new-resume/",
  },
];

export const ContactUsArticlesSection = () => {
  return (
    <section className="py-16 lg:py-24 px-4 sm:px-6 lg:px-8 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10">
          <p className="text-[13px] font-semibold tracking-[0.18em] uppercase text-[#2196F3] mb-4">
            From the blog
          </p>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] text-[#262626] leading-[1.15]">
              Latest insights
            </h2>
            <button
              onClick={() => {
                const container = document.querySelector('[data-articles-scroll]');
                if (container) container.scrollBy({ left: 340, behavior: 'smooth' });
              }}
              className="hidden md:inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-slate-300 text-slate-600 hover:border-[#2196F3] hover:text-[#2196F3] transition-all duration-300 cursor-pointer group self-start md:self-auto"
            >
              <span className="text-sm font-semibold">Scroll for more</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />
            </button>
          </div>
        </div>

        {/* Horizontal scroll cards — same sizing as XMP testimonials */}
        <div
          data-articles-scroll
          className="flex gap-4 md:gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 pl-4 md:mx-0 md:pl-0 md:-mr-[calc((100vw-100%)/2)] md:pr-8"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {articles.map((article) => (
            <a
              key={article.title}
              href={article.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex-shrink-0 w-[280px] md:w-[340px] min-h-[420px] md:min-h-[480px] snap-start rounded-3xl overflow-hidden bg-slate-900 text-white flex flex-col hover:bg-gradient-to-b hover:from-[#3B82F6] hover:to-[#4C1D95] hover:shadow-xl transition-all duration-300"
            >
              <div className="flex-1 p-8 md:p-10 flex flex-col">
                <span className="text-[14px] md:text-[15px] font-medium text-white/80 mb-4">
                  {article.readTime}
                </span>
                <h3 className="text-[22px] md:text-[24px] font-semibold leading-[1.25] tracking-[-0.01em]">
                  {article.title}
                </h3>
              </div>

              <div className="bg-slate-800 group-hover:bg-white/10 px-8 md:px-10 py-5 md:py-6 flex items-center justify-between transition-colors duration-300">
                <span className="text-[14px] md:text-[15px] font-medium text-white/90">
                  {article.date}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[14px] md:text-[15px] font-semibold text-white group-hover:translate-x-0.5 transition-transform">
                  Read Now
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </a>
          ))}
        </div>

        {/* Mobile swipe hint */}
        <div className="flex md:hidden items-center justify-center gap-2 text-slate-500 text-sm mt-4">
          <span>Swipe</span>
          <svg width="28" height="16" viewBox="0 0 20 12" fill="none" className="text-slate-500">
            <path d="M1 6h17M14 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </section>
  );
};

export default ContactUsArticlesSection;
