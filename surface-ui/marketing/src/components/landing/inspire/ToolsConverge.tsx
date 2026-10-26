import {
  ArrowDown,
  Globe,
  ListChecks,
  PenLine,
  Share2,
  Star,
  Store,
  type LucideIcon,
} from "lucide-react";
import { useInspireCopy } from "./copy";

type Chip = { label: string; icon: LucideIcon };

const CHIPS: Chip[] = [
  { label: "Google Business Profile", icon: Store },
  { label: "Review requests", icon: Star },
  { label: "Business Directories and Listings", icon: ListChecks },
  { label: "Social posting", icon: Share2 },
  { label: "Writing content", icon: PenLine },
  { label: "Website SEO", icon: Globe },
];

export function ToolsConverge() {
  const copy = useInspireCopy();
  return (
    <section className="flex flex-col justify-center pearl py-8 sm:py-10">
      <div className="mx-auto w-full max-w-[1200px] px-8 sm:px-12">
        <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-[#262626] sm:text-sm">
          {copy.toolsKicker}
        </p>
        <h2 className="mx-auto mt-3 max-w-2xl text-center font-insp-display text-[1.625rem] font-bold text-navy sm:text-[2.75rem]">
          {copy.toolsHeadline}
        </h2>

        <div className="mx-auto mt-7 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {CHIPS.map(({ label, icon: Icon }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
            >
              <Icon
                className="h-5 w-5 shrink-0 text-brand-blue"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <span className="text-[0.78rem] font-semibold leading-tight text-ink/75">
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-center" aria-hidden="true">
          <ArrowDown className="h-6 w-6 animate-bounce text-brand-blue" strokeWidth={2.2} />
        </div>

        <div className="mt-3 flex justify-center">
          <div className="inline-block rounded-full ai-gradient px-6 py-3.5 text-center shadow-lg">
            <p className="text-base font-extrabold text-white sm:text-lg">
              {copy.toolsBanner}
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-[0.95rem] font-bold text-ink">
          One platform. Every tool you need to get found, build trust, and stay{" "}
          <span className="text-ai-gradient">visible.</span>
        </p>
      </div>
    </section>
  );
}
