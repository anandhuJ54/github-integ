import { useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import allenJohnsonImg from "@/assets/testimonials/allen-johnson.jpg";
import allenJohnsonOverlay from "@/assets/testimonials/allen-johnson-overlay.jpg";
import ruoffLogoWhite from "@/assets/testimonials/ruoff-logo-white.webp";
import jenniferBallheimerImg from "@/assets/testimonials/jennifer-ballheimer.png";
import xIconBlankImg from "@/assets/testimonials/x-icon-blank.png";
import jimInzerImg from "@/assets/testimonials/jim-inzer.jpg";
import deborahNaylorImg from "@/assets/testimonials/deborah-naylor.png";
import markGregoImg from "@/assets/testimonials/mark-grego.jpg";
import nicoleAlmeidaImg from "@/assets/testimonials/nicole-almeida.jpg";
import ruoffLogo from "@/assets/testimonials/ruoff-logo.webp";
import mfsLogo from "@/assets/testimonials/mfs-logo.png";
import crosscountryLogo from "@/assets/testimonials/crosscountry-logo.png";
import eliteLogo from "@/assets/testimonials/elite-logo.png";
import guildLogo from "@/assets/testimonials/guild-logo.png";

type TestimonialItem = {
  type?: "quote" | "video";
  avatar?: string;
  name: string;
  title: string;
  quote?: string;
  companyLogo?: string;
  logoClassName?: string;
  videoId?: string;
};

const testimonials: TestimonialItem[] = [
  {
    avatar: xIconBlankImg,
    name: "CX Leader",
    title: "20+ Years of Industry Experience",
    quote: "There's more agility with your platform than there is on any other one that's out there today. I've worked with Qualtrics, Medallia, and Concentrix—it's like moving heaven and earth to get a new survey stood up with them. We can launch a campaign on Experience.com in about a week."
  },
  {
    type: "video",
    name: "Allen Johnson",
    title: "VP of Customer Experience, Ruoff Mortgage",
    videoId: "hs73pTkjawY"
  },
  {
    avatar: jenniferBallheimerImg,
    name: "Jennifer Ballheimer",
    title: "Regional Production Manager, Mortgage Financial Services",
    quote: "Experience.com has truly revolutionized my business. The platform provides insightful customer feedback and actionable data analysis that have directly enhanced customer engagement and service quality. It has given me a competitive edge in my market.",
    companyLogo: mfsLogo
  },
  {
    avatar: xIconBlankImg,
    name: "Donald H.",
    title: "Business Professional",
    quote: "The feature that automatically posts Google reviews across platforms has been a game-changer... The incorporation of AI, which helps in improving search engine visibility, ensures I am easily recognized as a top option."
  },
  {
    avatar: nicoleAlmeidaImg,
    name: "Nicole Almeida",
    title: "Mortgage Loan Originator, CrossCountry Mortgage, LLC",
    quote: "The integration with my CRM is particularly helpful as it automates the review request process for clients who have closed transactions... helping me stand out among my competition.",
    companyLogo: crosscountryLogo
  },
  {
    avatar: jimInzerImg,
    name: "Jim Inzer",
    title: "Loan Officer, HMA Mortgage",
    quote: "The setup process was extremely easy, which made my initial interaction with Experience.com seamless... clients who find me can easily notice the reviews. Furthermore, I value the automation feature that notifies clients and provides me simultaneously with the necessary information."
  },
  {
    avatar: deborahNaylorImg,
    name: "Deborah Naylor",
    title: "Real Estate Broker, Elite Realty Alliance",
    quote: "I love the ability to connect all of my online review platforms to one location... The Experience.com platform is very easy to use and has several ways to boost my reviews rating and publicity within Google ranking.",
    companyLogo: eliteLogo,
    logoClassName: "h-9 md:h-10"
  },
  {
    avatar: markGregoImg,
    name: "Mark Grego",
    title: "Sales Manager, Guild Mortgage",
    quote: "The Pro version has some great features that helps with SEO. Being able to share experience.com reviews on Google, LinkedIn and other platforms is really beneficial... Review requests are sent automatically once a loan closes.",
    companyLogo: guildLogo
  },
  {
    avatar: allenJohnsonImg,
    name: "Allen Johnson",
    title: "VP of Customer Experience, Ruoff Mortgage",
    quote: "The Experience.com team has provided invaluable assistance. The custom reporting I received clearly demonstrates the power of the platform. Frankly, the way Experience.com successfully redirects our survey recipients to our loan officer Google pages to leave reviews is an outstanding feature and a great testimony to the product. By my calculations, this process has led to over 90% of our total Google reviews this year.",
    companyLogo: ruoffLogo
  }
];

export const XMPTestimonialsSection = () => {
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);

  return (
    <section className="py-16 md:py-24 px-4 bg-white relative overflow-hidden">
      <div className="container mx-auto max-w-7xl relative z-10">

        {/* Heading */}
        <div className="mb-10 md:mb-14">
          <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-semibold text-slate-900 leading-tight mb-2" style={{ letterSpacing: '-0.02em' }}>
            The proof is in the experience.
          </h2>
          <div className="flex items-start justify-between">
            <p className="text-[17px] md:text-[20px] font-light text-slate-500" style={{ letterSpacing: '0.01em' }}>
              See why professionals, teams, and enterprises trust Experience.com to manage reputation, feedback, and customer experience.
            </p>
          </div>
          <button 
            onClick={() => {
              const container = document.querySelector('[data-testimonials-scroll]');
              if (container) container.scrollBy({ left: 300, behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-full border border-slate-300 text-slate-600 hover:border-primary hover:text-primary transition-all duration-300 cursor-pointer group"
          >
            <span className="text-sm font-semibold">Scroll for more</span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />
          </button>
        </div>

        {/* Horizontal scroll cards */}
        <div data-testimonials-scroll className="flex gap-4 md:gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 pl-4 md:mx-0 md:pl-0 md:-mr-[calc((100vw-100%)/2)] md:pr-8" style={{ WebkitOverflowScrolling: 'touch' }}>
          {testimonials.map((t, i) => {
            // Video card
            if (t.type === "video" && t.videoId) {
              const isPlaying = playingVideoId === t.videoId;
              const thumbUrl = `https://img.youtube.com/vi/${t.videoId}/hqdefault.jpg`;
              return (
                <div
                  key={i}
                  className="flex-shrink-0 w-[280px] md:w-[340px] snap-start rounded-2xl overflow-hidden relative"
                >
                  {isPlaying ? (
                    <div className="relative w-full" style={{ paddingBottom: '177.78%' }}>
                      <iframe
                        className="absolute inset-0 w-full h-full"
                        src={`https://www.youtube.com/embed/${t.videoId}?autoplay=1`}
                        title="Video testimonial"
                        allow="autoplay; encrypted-media"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <div className="cursor-pointer group" onClick={() => setPlayingVideoId(t.videoId!)}>
                      <img
                        src={allenJohnsonOverlay}
                        alt={t.name}
                        className="w-full h-full object-cover absolute inset-0 grayscale"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                      <div className="absolute bottom-4 left-4">
                        <img src={ruoffLogoWhite} alt="Ruoff Mortgage" className="h-8 md:h-10 w-auto object-contain opacity-90" />
                      </div>
                      <div className="absolute bottom-4 right-4">
                        <button className="px-6 py-2.5 bg-white/20 backdrop-blur-md border border-white/30 rounded-full text-white font-semibold text-sm flex items-center gap-2 hover:bg-white/30 hover:scale-110 transition-all duration-300">
                          <Play className="w-4 h-4 ml-0.5" fill="white" />
                          Watch
                        </button>
                      </div>
                      {/* Invisible spacer to maintain card height */}
                      <div className="invisible p-6 md:p-8 flex flex-col">
                        <div className="w-12 h-12 md:w-14 md:h-14 mb-5 md:mb-6" />
                        <p className="text-[15px] leading-relaxed flex-1 mb-6 md:mb-8">&nbsp;<br/>&nbsp;<br/>&nbsp;<br/>&nbsp;<br/>&nbsp;</p>
                        <div className="mt-auto">
                          <p className="text-[20px]">&nbsp;</p>
                          <p className="text-[13px]">&nbsp;</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // Standard quote card
            return (
              <div
                key={i}
                className="flex-shrink-0 w-[280px] md:w-[340px] snap-start rounded-2xl border border-gray-200 bg-white p-6 md:p-8 flex flex-col relative"
              >
                {t.companyLogo && (
                  <img
                    src={t.companyLogo}
                    alt={`${t.name} company`}
                    className={`absolute top-5 right-5 md:top-7 md:right-7 max-w-[100px] md:max-w-[110px] w-auto object-contain opacity-60 ${t.logoClassName || 'h-7 md:h-8'}`}
                  />
                )}
                <img
                  src={t.avatar}
                  alt={t.name}
                  className="w-12 h-12 md:w-14 md:h-14 rounded-full object-cover mb-5 md:mb-6"
                />
                <p className="text-[15px] md:text-[16px] text-slate-700 leading-relaxed flex-1 mb-6 md:mb-8">
                  "{t.quote}"
                </p>
                <div className="mt-auto">
                  <p className="text-[20px] md:text-[24px] text-slate-900" style={{ fontFamily: "'Homemade Apple', cursive" }}>{t.name}</p>
                  <p className="text-[13px] md:text-[14px] text-slate-500">{t.title}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
