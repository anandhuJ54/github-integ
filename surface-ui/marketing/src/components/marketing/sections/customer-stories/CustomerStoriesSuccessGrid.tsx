import { useState, useRef } from "react";
import { ChevronDown, Play } from "lucide-react";

const isYouTubeEmbed = (src: string) => src.includes("youtube.com/embed") || src.includes("youtube.com");

type VideoItem = {
  kind: "video";
  title: string;
  image: string;
  videoSrc: string;
  name: string;
  role: string;
  avatar: string;
  href?: string;
};

type QuoteItem = {
  kind: "quote";
  quote: string;
  name: string;
  company: string;
  avatar?: string;
  stats?: { value: string; label: string }[];
};

type Item = VideoItem | QuoteItem;

const AVATAR_FALLBACK =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='20' fill='%23303035'/><circle cx='20' cy='16' r='7' fill='%23555'/><path d='M6 36c2-8 10-12 14-12s12 4 14 12' fill='%23555'/></svg>";

const items: Item[] = [
  {
    kind: "video",
    title: "Ryan Davis — #1 Insurance Agent",
    image: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Davis.png",
    videoSrc: "https://try.experience.com/wp-content/uploads/2025/05/Ryan.mp4",
    name: "Ryan Davis",
    role: "#1 Insurance Agent, Experience.com",
    avatar: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Davis.png",
  },
  {
    kind: "quote",
    quote:
      "Experience.com transformed how we connect with our customers. We've seen a 4,000% increase in website traffic since partnering with them.",
    name: "Marcus Johnson",
    company: "RE/MAX Victory",
  },
  {
    kind: "video",
    title: "RE/MAX Victory + Affiliates",
    image: "https://img.youtube.com/vi/Wns102pytXo/hqdefault.jpg",
    videoSrc: "https://www.youtube.com/embed/Wns102pytXo",
    name: "RE/MAX Victory",
    role: "Broker/Owner — Real Estate",
    avatar: "https://img.youtube.com/vi/Wns102pytXo/hqdefault.jpg",
  },
  {
    kind: "quote",
    quote:
      "The ROI is just that good. Our online presence has never been stronger, and the results speak for themselves.",
    name: "Rich Gega",
    company: "Mortgage Professional",
  },
  {
    kind: "quote",
    quote:
      "Experience.com helped us secure customer trust across multiple locations while keeping the review process simple enough for every team member.",
    name: "Justin Vedder",
    company: "WFG",
  },
  {
    kind: "video",
    title: "Ryan Leahy — Winning in 18 States",
    image: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Leahy.png",
    videoSrc: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Leahy.mp4",
    name: "Ryan Leahy",
    role: "Mortgage Professional, 18 States",
    avatar: "https://try.experience.com/wp-content/uploads/2025/05/Ryan-Leahy.png",
  },
  {
    kind: "quote",
    quote:
      "From 1.7 to 4.8 stars. Experience.com completely transformed our reputation and pipeline in under a year.",
    name: "First Continental",
    company: "Mortgage Leadership",
    stats: [
      { value: "1.7 → 4.8", label: "Star rating increase" },
      { value: "< 1 year", label: "Time to transform" },
    ],
  },
  {
    kind: "video",
    title: "Jason Cota — Online Credibility",
    image: "https://try.experience.com/wp-content/uploads/2025/05/Feature-Image_Jason-Cota_1200x628.webp",
    videoSrc: "https://try.experience.com/wp-content/uploads/2025/05/Feature-Image_Jason-Cota_1200x628.webp",
    name: "Jason Cota",
    role: "Mortgage Professional",
    avatar: "https://try.experience.com/wp-content/uploads/2025/05/Feature-Image_Jason-Cota_1200x628.webp",
  },
  {
    kind: "video",
    title: "John Meussner — #1 in Roseville",
    image:
      "https://try.experience.com/wp-content/uploads/2025/05/1-Mortgage-Professional-in-Roseville-John-Meussners-Secret-to-Google-Ranking-Success-Its-Experience.com_.png",
    videoSrc:
      "https://try.experience.com/wp-content/uploads/2025/05/1-Mortgage-Professional-in-Roseville-John-Meussners-Secret-to-Google-Ranking-Success-Its-Experience.com_.png",
    name: "John Meussner",
    role: "#1 Mortgage Pro, Roseville",
    avatar:
      "https://try.experience.com/wp-content/uploads/2025/05/1-Mortgage-Professional-in-Roseville-John-Meussners-Secret-to-Google-Ranking-Success-Its-Experience.com_.png",
  },
  {
    kind: "quote",
    quote:
      "The platform gave our team clear visibility into every customer touchpoint without overwhelming staff with complexity.",
    name: "Scott Evans",
    company: "CrossCountry Mortgage",
  },
];

const VideoCard = ({ item }: { item: VideoItem }) => {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isYouTube = isYouTubeEmbed(item.videoSrc);

  const handlePlay = () => {
    setPlaying(true);
    if (!isYouTube) setTimeout(() => videoRef.current?.play(), 0);
  };

  return (
    <div className="relative w-full aspect-[2/3] rounded-2xl overflow-hidden bg-neutral-900 group">
      {playing && isYouTube ? (
        <iframe
          src={`${item.videoSrc}${item.videoSrc.includes("?") ? "&" : "?"}autoplay=1`}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      ) : playing && !isYouTube ? (
        <video
          ref={videoRef}
          src={item.videoSrc}
          poster={item.image}
          controls
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <button type="button" onClick={handlePlay} className="absolute inset-0 w-full h-full" aria-label={`Play ${item.title}`}>
          <img
            src={item.image}
            alt={item.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110">
              <Play className="w-5 h-5 fill-black text-black ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3">
            <img
              src={item.avatar || AVATAR_FALLBACK}
              alt=""
              className="w-9 h-9 rounded-full object-cover border border-white/20 shrink-0"
              onError={(e) => ((e.currentTarget.src = AVATAR_FALLBACK))}
            />
            <div className="min-w-0">
              <p className="text-white text-[14px] font-semibold leading-tight truncate">{item.name}</p>
              <p className="text-white/70 text-[12px] leading-tight truncate">{item.role}</p>
            </div>
          </div>
        </button>
      )}
    </div>
  );
};

const QuoteCard = ({ item }: { item: QuoteItem }) => (
  <div className="w-full rounded-2xl bg-[#141416] p-6 flex flex-col justify-between min-h-[360px]">
    <p className="text-white/85 text-[15px] leading-relaxed">{item.quote}</p>
    {item.stats && item.stats.length > 0 && (
      <div className="grid grid-cols-2 gap-4 mt-5">
        {item.stats.map((stat) => (
          <div key={stat.label}>
            <div className="text-white text-[22px] font-heading font-semibold leading-none">{stat.value}</div>
            <div className="text-white/60 text-[12px] mt-1 leading-tight">{stat.label}</div>
          </div>
        ))}
      </div>
    )}
    <div className="flex items-center gap-3 mt-6">
      <img
        src={item.avatar || AVATAR_FALLBACK}
        alt=""
        className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0"
        onError={(e) => ((e.currentTarget.src = AVATAR_FALLBACK))}
      />
      <div className="min-w-0">
        <p className="text-white text-[14px] font-semibold leading-tight truncate">{item.name}</p>
        <p className="text-white/60 text-[12px] leading-tight truncate">{item.company}</p>
      </div>
    </div>
  </div>
);

// Column pattern: [top, bottom] per column, repeating video/quote alternation
const videos = items.filter((i): i is VideoItem => i.kind === "video");
const quotes = items.filter((i): i is QuoteItem => i.kind === "quote");

const buildColumns = (): Item[][] => {
  const cols: Item[][] = [];
  let v = 0;
  let q = 0;
  for (let c = 0; c < 4; c++) {
    const videoTop = c % 2 === 0;
    const top = videoTop ? videos[v++ % videos.length] : quotes[q++ % quotes.length];
    const bottom = videoTop ? quotes[q++ % quotes.length] : videos[v++ % videos.length];
    cols.push([top, bottom]);
  }
  return cols;
};

export const CustomerStoriesSuccessGrid = () => {
  const columns = buildColumns();

  return (
    <section className="py-16 md:py-20 px-4 sm:px-6 lg:px-8 bg-[#0a0a0b]">
      <div className="container mx-auto max-w-[1400px]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-4 lg:gap-5">
              {col.map((item, i) => (
                <div key={i}>
                  {item.kind === "video" ? <VideoCard item={item} /> : <QuoteCard item={item} />}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex justify-center mt-10">
          <button className="inline-flex items-center gap-2 text-white/80 hover:text-white text-[14px] font-medium transition-colors">
            View all
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
};
