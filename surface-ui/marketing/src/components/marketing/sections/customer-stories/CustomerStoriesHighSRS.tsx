import { Gauge, ArrowUpRight } from "lucide-react";
import { Link } from "@v3/marketing/components/marketing/link";

import avatar01 from "@v3/marketing/assets/avatars/avatar-01.jpg";
import avatar02 from "@v3/marketing/assets/avatars/avatar-02.jpg";
import avatar03 from "@v3/marketing/assets/avatars/avatar-03.jpg";
import avatar04 from "@v3/marketing/assets/avatars/avatar-04.jpg";
import avatar05 from "@v3/marketing/assets/avatars/avatar-05.jpg";
import avatar06 from "@v3/marketing/assets/avatars/avatar-06.jpg";
import avatar07 from "@v3/marketing/assets/avatars/avatar-07.jpg";
import avatar08 from "@v3/marketing/assets/avatars/avatar-08.jpg";
import avatar09 from "@v3/marketing/assets/avatars/avatar-09.jpg";
import avatar10 from "@v3/marketing/assets/avatars/avatar-10.jpg";
import avatar11 from "@v3/marketing/assets/avatars/avatar-11.jpg";
import avatar12 from "@v3/marketing/assets/avatars/avatar-12.jpg";
import avatar13 from "@v3/marketing/assets/avatars/avatar-13.jpg";
import avatar14 from "@v3/marketing/assets/avatars/avatar-14.jpg";
import avatar15 from "@v3/marketing/assets/avatars/avatar-15.jpg";
import avatar16 from "@v3/marketing/assets/avatars/avatar-16.jpg";
import avatar17 from "@v3/marketing/assets/avatars/avatar-17.jpg";
import avatar18 from "@v3/marketing/assets/avatars/avatar-18.jpg";

type RankType = "local-rank" | "state-rank" | "reviews" | "views";

interface Professional {
  name: string;
  title: string;
  score: number;
  rankType: RankType;
  stat: string;
  photo: string;
}

const professionals: Professional[] = [
  { name: "Sarah Chen", title: "Loan Officer", score: 782, rankType: "local-rank", stat: "#1 in Seattle", photo: avatar01 },
  { name: "Marcus Rivera", title: "Electrician", score: 814, rankType: "reviews", stat: "2,400+ Reviews", photo: avatar02 },
  { name: "Jennifer Okafor", title: "Insurance Agent", score: 756, rankType: "state-rank", stat: "#1 in Georgia", photo: avatar03 },
  { name: "David Patel", title: "General Contractor", score: 839, rankType: "views", stat: "5.1k Profile Views", photo: avatar04 },
  { name: "Amanda Brooks", title: "Realtor", score: 725, rankType: "local-rank", stat: "#1 in Austin", photo: avatar05 },
  { name: "Ryan Nakamura", title: "HVAC Technician", score: 840, rankType: "reviews", stat: "3,100+ Reviews", photo: avatar06 },
  { name: "Lisa Fernandez", title: "Mortgage Advisor", score: 768, rankType: "local-rank", stat: "#1 in Miami", photo: avatar07 },
  { name: "Kevin O'Brien", title: "Financial Advisor", score: 802, rankType: "views", stat: "Trending in Chicago", photo: avatar08 },
  { name: "Priya Sharma", title: "Plumber", score: 831, rankType: "local-rank", stat: "#1 in Denver", photo: avatar09 },
  { name: "James Morton", title: "Real Estate Broker", score: 738, rankType: "reviews", stat: "1,800+ Reviews", photo: avatar10 },
  { name: "Angela Wu", title: "Home Inspector", score: 793, rankType: "state-rank", stat: "#1 in California", photo: avatar11 },
  { name: "Carlos Mendez", title: "Roofer", score: 827, rankType: "local-rank", stat: "#1 in Dallas", photo: avatar12 },
  { name: "Diana Kozlov", title: "Escrow Officer", score: 745, rankType: "views", stat: "Trending in Portland", photo: avatar13 },
  { name: "Michael Hayes", title: "Property Manager", score: 821, rankType: "reviews", stat: "2,900+ Reviews", photo: avatar14 },
  { name: "Tanya Bridges", title: "Interior Designer", score: 778, rankType: "state-rank", stat: "#1 in Texas", photo: avatar15 },
  { name: "Robert Kim", title: "Landscaper", score: 836, rankType: "local-rank", stat: "#1 in Phoenix", photo: avatar16 },
  { name: "Stephanie Ngo", title: "Pest Control Tech", score: 734, rankType: "views", stat: "4.2k Profile Views", photo: avatar17 },
  { name: "Brandon Clarke", title: "Real Estate Agent", score: 809, rankType: "local-rank", stat: "#1 in Tampa", photo: avatar18 },
];

const toSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const TickerCell = ({ pro }: { pro: Professional }) => (
  <div className="flex items-center gap-3 px-5 py-2.5 group/cell transition-all duration-300 hover:bg-black/[0.04] cursor-default shrink-0">
    {/* Avatar */}
    <img
      src={pro.photo}
      alt={pro.name}
      className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm shrink-0"
    />

    {/* Name & Title — stacked */}
    <div className="flex flex-col min-w-0">
      <span className="text-[13px] font-semibold text-[#262626] whitespace-nowrap leading-tight">{pro.name}</span>
      <span className="text-[11px] text-gray-500 whitespace-nowrap leading-tight">{pro.title}</span>
    </div>

    {/* SRS & Stat — stacked */}
    <div className="flex flex-col items-center gap-0.5 shrink-0 ml-1">
      <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#1a8ff1] to-[#28c3ef] text-[11px] font-bold text-white tracking-wide shadow-sm">
        <Gauge className="w-3 h-3" />
        <span>SRS {pro.score}</span>
      </div>
      <div className="flex items-center">
        <span className="text-[10px] font-medium whitespace-nowrap text-emerald-600">{pro.stat}</span>
      </div>
    </div>

    {/* Arrow link */}
    <Link
      to={`/customer-stories/${toSlug(pro.name)}`}
      className="shrink-0 w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center hover:bg-[#28c3ef] hover:border-[#28c3ef] hover:text-white text-gray-400 transition-colors"
      aria-label={`View ${pro.name}'s profile`}
    >
      <ArrowUpRight className="w-3.5 h-3.5" />
    </Link>
  </div>
);

export const CustomerStoriesHighSRS = () => {
  const items = [...professionals, ...professionals];

  return (
    <div className="w-full h-[90px] bg-[#F9FAFB] border-y border-gray-200/60 overflow-hidden flex items-center relative">
      {/* Edge fades */}
      <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#F9FAFB] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#F9FAFB] to-transparent z-10 pointer-events-none" />

      {/* Scrolling track */}
      <div className="flex items-center animate-ticker hover:[animation-play-state:paused]">
        {items.map((pro, i) => (
          <div key={i} className="flex items-center shrink-0">
            <TickerCell pro={pro} />
            <div className="w-px h-10 bg-gray-200 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
};
