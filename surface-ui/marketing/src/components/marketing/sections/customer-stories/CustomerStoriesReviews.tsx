import { Play } from "lucide-react";
import person1 from "@v3/marketing/assets/customer-stories/person-1.jpg";
import person2 from "@v3/marketing/assets/customer-stories/person-2.jpg";
import person3 from "@v3/marketing/assets/customer-stories/person-3.jpg";
import person4 from "@v3/marketing/assets/customer-stories/person-4.jpg";
import person5 from "@v3/marketing/assets/customer-stories/person-5.jpg";

const reviews = [
  {
    kind: "text" as const,
    quote:
      "There's more agility with your platform than there is on any other one that's out there today. I've worked with Qualtrics, Medallia, and Concentrix—it's like moving heaven and earth to get a new survey stood up with them. We can launch a campaign on Experience.com in about a week.",
    name: "CX Leader",
    role: "20+ Years of Industry Experience",
    photo: person1,
  },
  {
    kind: "video" as const,
    name: "Ruoff Mortgage",
    role: "Watch",
    photo: person2,
  },
  {
    kind: "text" as const,
    quote:
      "Experience.com has truly revolutionized the platform. The platform provides insightful customer feedback and actionable data analysis that have directly enhanced customer engagement and service quality. It has given me a competitive edge in my market.",
    name: "Jennifer Ballkeimer",
    role: "Regional Production Manager, Mortgage Financial Services",
    photo: person3,
  },
  {
    kind: "text" as const,
    quote:
      "The feature that automatically posts Google reviews across platforms has been a game-changer… The incorporation of AI, which helps in improving search engine visibility, ensures I am easily recognized as a top option.",
    name: "Donald H.",
    role: "Business Professional",
    photo: person4,
  },
  {
    kind: "text" as const,
    quote:
      "There's more agility with your platform than there is on any other one that's out there today. I've worked with Qualtrics, Medallia, and Concentrix—it's like moving heaven and earth to get a new survey stood up with them. We can launch a campaign on Experience.com in about a week.",
    name: "CX Leader",
    role: "20+ Years of Industry Experience",
    photo: person5,
  },
];

export const CustomerStoriesReviews = () => {
  return (
    <section className="py-16 md:py-20 px-4 sm:px-6 lg:px-8 bg-white">
      <div className="container mx-auto max-w-[1296px]">
        <h2 className="font-heading text-[28px] md:text-[34px] lg:text-[40px] leading-[1.1] tracking-[-0.02em] text-[#0f0f0f] mb-3">
          The proof is in the experience
        </h2>
        <p className="font-body-light text-[14px] md:text-[15px] text-black/60 max-w-2xl mb-6">
          See why professionals, teams, and enterprises trust Experience.com to manage reputation, feedback, and customer experience.
        </p>

        <button className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-black/15 text-[12px] font-medium text-black/60 hover:border-[#2196F3] hover:text-[#2196F3] transition-colors">
          Scroll for more
        </button>

        <div className="flex gap-4 lg:gap-5 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0">
          {reviews.map((r, i) => (
            <div
              key={i}
              className="snap-start shrink-0 w-[75%] sm:w-[45%] lg:w-auto"
            >
              {r.kind === "video" ? (
                <div className="relative rounded-2xl overflow-hidden aspect-[3/4] group cursor-pointer">
                  <img
                    src={r.photo}
                    alt={r.name}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover grayscale"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                    <span className="font-heading text-white text-[15px]">{r.name}</span>
                    <span className="inline-flex items-center gap-1.5 bg-white/90 text-[#0f0f0f] text-[11px] font-medium px-2.5 py-1 rounded-full">
                      <Play className="w-3 h-3 fill-[#0f0f0f]" /> {r.role}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-black/10 p-5 h-full flex flex-col aspect-[3/4]">
                  <div className="text-[#2196F3] text-2xl leading-none mb-3">✕</div>
                  <p className="font-body-light text-[12px] lg:text-[13px] text-black/70 leading-relaxed flex-1 overflow-hidden">
                    {r.quote}
                  </p>
                  <div className="mt-4 pt-4 border-t border-black/5">
                    <p className="font-heading text-[13px] text-[#0f0f0f]">{r.name}</p>
                    <p className="font-body-light text-[11px] text-black/50">{r.role}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
