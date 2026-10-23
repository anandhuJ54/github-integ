import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";

type Story = {
  id: string;
  name: string;
  title: string;
  description: string;
  poster: string;
  videoSrc: string;
  isYouTube?: boolean;
};

const stories: Story[] = [
  {
    id: "ryan-davis",
    name: "Ryan Davis",
    title: "Ryan Davis",
    description:
      "The #1 Insurance Agent on Experience.com shares how a relentless focus on client experience turned reviews into his most reliable growth channel.",
    poster: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Davis.png",
    videoSrc: "https://try.experience.com/wp-content/uploads/2025/05/Ryan.mp4",
  },
  {
    id: "ryan-leahy",
    name: "Ryan Leahy",
    title: "Ryan Leahy",
    description:
      "Winning in 18 states — Ryan explains how Experience.com helps his team scale trust and search visibility across every market they serve.",
    poster: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Leahy.png",
    videoSrc: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Leahy.mp4",
  },
  {
    id: "remax-victory",
    name: "RE/MAX Victory",
    title: "RE/MAX Victory + Affiliates",
    description:
      "How RE/MAX Victory turned a customer-experience platform into a 4,000% traffic increase — and a broker-owner recruiting advantage.",
    poster: "https://img.youtube.com/vi/Wns102pytXo/hqdefault.jpg",
    videoSrc: "https://www.youtube.com/embed/Wns102pytXo",
    isYouTube: true,
  },
  {
    id: "john-meussner",
    name: "John Meussner",
    title: "John Meussner",
    description:
      "The #1 Mortgage Professional in Roseville on how consistent reviews and search signals put him at the top of Google — and kept him there.",
    poster:
      "https://try.experience.com/wp-content/uploads/2025/05/1-Mortgage-Professional-in-Roseville-John-Meussners-Secret-to-Google-Ranking-Success-Its-Experience.com_.png",
    videoSrc:
      "https://try.experience.com/wp-content/uploads/2025/05/1-Mortgage-Professional-in-Roseville-John-Meussners-Secret-to-Google-Ranking-Success-Its-Experience.com_.png",
  },
  {
    id: "jason-cota",
    name: "Jason Cota",
    title: "Jason Cota",
    description:
      "A mortgage professional's take on how online credibility, built one review at a time, converts strangers into referrals.",
    poster:
      "https://try.experience.com/wp-content/uploads/2025/05/Feature-Image_Jason-Cota_1200x628.webp",
    videoSrc:
      "https://try.experience.com/wp-content/uploads/2025/05/Feature-Image_Jason-Cota_1200x628.webp",
  },
];

export const CustomerStoriesFeaturedVideo = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const active = stories[activeIndex];

  const goTo = (i: number) => {
    const next = (i + stories.length) % stories.length;
    setActiveIndex(next);
    setPlaying(false);
  };

  const handlePlay = () => {
    setPlaying(true);
    if (!active.isYouTube) setTimeout(() => videoRef.current?.play(), 0);
  };

  return (
    <section className="py-16 md:py-24 bg-white overflow-hidden">
      <div className="container mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 md:mb-14">
          <h2 className="font-heading text-3xl md:text-4xl lg:text-[42px] lg:leading-[1.1] text-foreground">
            Real impact. Real growth.
          </h2>
          <p className="mt-3 text-muted-foreground text-base md:text-lg">
            Watch success stories from Experience.com customers
          </p>
        </div>
      </div>

      {/* Featured stage with peek edges — full width, bleeds off left/right */}
      <div className="relative w-full">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_minmax(0,1080px)_1fr] items-stretch gap-4">
            {/* Left peek */}
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              aria-label="Previous story"
              className="hidden md:block relative rounded-[3px] overflow-hidden bg-neutral-900 group"
            >
              <img
                src={stories[(activeIndex - 1 + stories.length) % stories.length].poster}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity"
              />
              <div className="absolute inset-0 bg-black/40" />
            </button>

            {/* Center stage */}
            <div className="relative rounded-[3px] overflow-hidden bg-neutral-900 aspect-[16/9]">
              {playing && active.isYouTube ? (
                <iframe
                  src={`${active.videoSrc}${active.videoSrc.includes("?") ? "&" : "?"}autoplay=1`}
                  title={active.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                />
              ) : playing && !active.isYouTube ? (
                <video
                  ref={videoRef}
                  src={active.videoSrc}
                  poster={active.poster}
                  controls
                  autoPlay
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <>
                  <img
                    src={active.poster}
                    alt={active.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-center p-8 md:p-12 lg:p-16 max-w-[560px]">
                    <h3 className="text-white font-heading text-3xl md:text-4xl lg:text-5xl leading-tight">
                      {active.title}
                    </h3>
                    <p className="text-white/85 text-sm md:text-base mt-4 leading-relaxed">
                      {active.description}
                    </p>
                    <button
                      type="button"
                      onClick={handlePlay}
                      className="mt-6 inline-flex items-center gap-3 text-white font-medium text-base group w-fit"
                    >
                      <span>Watch testimonial</span>
                      <span className="w-9 h-9 rounded-full border border-white/70 flex items-center justify-center transition-all group-hover:bg-white group-hover:text-black">
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Right peek */}
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              aria-label="Next story"
              className="hidden md:block relative rounded-[3px] overflow-hidden bg-neutral-900 group"
            >
              <img
                src={stories[(activeIndex + 1) % stories.length].poster}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity"
              />
              <div className="absolute inset-0 bg-black/40" />
            </button>
          </div>

          {/* Arrow controls */}
          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            aria-label="Previous"
            className="absolute left-2 md:left-6 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/90 hover:bg-white shadow-md flex items-center justify-center text-black transition"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            aria-label="Next"
            className="absolute right-2 md:right-6 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/90 hover:bg-white shadow-md flex items-center justify-center text-black transition"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
    </section>
  );
};
