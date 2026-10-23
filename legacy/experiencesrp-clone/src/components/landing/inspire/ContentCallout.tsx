import { TrendingUp } from "lucide-react";
import aiContentImg from "@/assets/inspire/ai-content-writing.png";

export function ContentCallout() {
  return (
    <section className="flex flex-col justify-center pearl py-8 sm:py-10">
      <div className="mx-auto w-full max-w-[1200px] px-8 sm:px-12">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.15fr]">
          <div className="flex justify-center lg:order-1">
            <img
              src={aiContentImg}
              alt="VOCE AI writing a polished local article in seconds"
              className="h-auto w-full max-w-[30rem] rounded-2xl object-cover"
              loading="lazy"
            />
          </div>

          <div className="lg:order-2">
            <h2 className="font-insp-display text-[1.625rem] font-bold leading-tight text-navy sm:text-[2.75rem]">
              AI-optimized content, written in{" "}
              <span className="text-ai-gradient">minutes.</span>
            </h2>
            <p className="mt-3 text-[0.85rem] leading-relaxed text-ink/75">
              VOCE turns a simple prompt into a polished local article - the kind of expertise AI
              looks for when it decides who to recommend. One article a week, about ten minutes.
            </p>

            <div className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-lg">
              <TrendingUp className="h-6 w-6 text-brand-blue" aria-hidden="true" />
              <p className="mt-2 text-[1.75rem] font-extrabold leading-tight tracking-tight text-navy">
                8 inbound leads in 3 months
              </p>
              <p className="mt-2 text-[0.78rem] leading-snug text-ink/70">
                One agent publishing weekly went from zero inbound leads the prior year to eight in
                three months.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
