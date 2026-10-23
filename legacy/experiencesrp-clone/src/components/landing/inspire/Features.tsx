import {
  BarChart3,
  ChevronRight,
  Eye,
  ListChecks,
  MessageSquareText,
  MonitorCheck,
  Newspaper,
  Share2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useInspireCopy } from "./copy";

type Item = { icon: LucideIcon; title: string; body: string };
type Group = {
  tag: string;
  number: string;
  summary: string;
  items: Item[];
};

const GROUPS: Group[] = [
  {
    tag: "Presence",
    number: "01",
    summary:
      "Be found everywhere clients look — across search, maps, directories, and AI.",
    items: [
      {
        icon: Eye,
        title: "Profiles that Rank",
        body: "Highly indexed profiles that act as your source of truth across search and AI.",
      },
      {
        icon: ListChecks,
        title: "Listings that Stay Consistent",
        body: "Accurate business information across search, maps, directories, and voice.",
      },
      {
        icon: MonitorCheck,
        title: "Website Signals that Convert",
        body: "Optimize your web presence for stronger ranking and engagement.",
      },
    ],
  },
  {
    tag: "Reputation",
    number: "02",
    summary:
      "Turn every great experience into trust that clients can see and feel.",
    items: [
      {
        icon: MessageSquareText,
        title: "Reviews that Build Trust",
        body: "Automated with KW Command and Follow Up Boss so every closing asks on its own.",
      },
      {
        icon: Share2,
        title: "Social that Amplifies Reach",
        body: "Turn reviews into content and distribute it to expand visibility and trust.",
      },
    ],
  },
  {
    tag: "Authority",
    number: "03",
    summary:
      "Become the expert that search and AI recommend first.",
    items: [
      {
        icon: Newspaper,
        title: "Content that Proves Authority",
        body: "Publish high-quality local articles with VOCE to demonstrate expertise.",
      },
      {
        icon: Sparkles,
        title: "AI Visibility that Gets You Recommended",
        body: "Understand how AI sees your business and strengthen your authority.",
      },
      {
        icon: BarChart3,
        title: "Insights that Drive Growth",
        body: "Track visibility, engagement, and performance to make smarter decisions.",
      },
    ],
  },
];

export function Features() {
  const copy = useInspireCopy();
  return (
    <section className="bg-product-surface py-10 sm:py-14">
      <div className="mx-auto w-full max-w-[1200px] px-8 sm:px-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="font-insp-product text-[0.68rem] font-bold uppercase tracking-[0.16em] text-brand-blue">
              One connected platform
            </p>
            <h2 className="mt-3 font-insp-display text-[1.625rem] font-bold leading-tight text-navy sm:text-[2.75rem]">
              Everything you need to become the{" "}
              <span className="text-ai-gradient">first choice.</span>
            </h2>
          </div>
          <a
            href={copy.signupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-blue hover:underline"
          >
            Claim your profile
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
          {GROUPS.map(({ tag, number, summary, items }) => (
            <div
              key={tag}
              className="relative flex flex-col rounded-3xl bg-card p-6"
            >
              <p className="text-[0.8rem] font-semibold text-ink/60">
                <span className="text-brand-blue">{number}</span> · {tag}
              </p>
              <h3 className="mt-1.5 font-insp-display text-xl font-bold leading-snug text-ink">
                {summary}
              </h3>
              <ul className="mt-4 space-y-3">
                {items.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex gap-2.5">
                    <Icon
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue"
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <h4 className="font-insp-product text-[0.8rem] font-bold text-ink">
                        {title}
                      </h4>
                      <p className="mt-0.5 font-insp-product text-[0.72rem] leading-relaxed text-ink/65">
                        {body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-auto" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
