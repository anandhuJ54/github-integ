import { ArrowRight, CalendarCheck, Check, ChevronRight, MessagesSquare, QrCode, Sparkles, type LucideIcon } from "lucide-react";
import { useInspireCopy } from "./copy";
import { SignupQrCode } from "./SignupQrCode";

type Step = {
  icon: LucideIcon;
  color: string;
  lead: string;
  highlight: string;
  rest: string;
};

const STEPS: Step[] = [
  {
    icon: QrCode,
    color: "text-brand-violet",
    lead: "Scan the code,",
    highlight: "claim your profile,",
    rest: "and you're set up.",
  },
  {
    icon: CalendarCheck,
    color: "text-brand-blue",
    lead: "Meet your",
    highlight: "Search Rank Expert",
    rest: "and see what to fix first.",
  },
  {
    icon: MessagesSquare,
    color: "text-brand-amber",
    lead: "Reviews send",
    highlight: "automatically",
    rest: "after every closing.",
  },
  {
    icon: Sparkles,
    color: "text-brand-green",
    lead: "Get found where",
    highlight: "clients actually ask.",
    rest: "",
  },
];

export function GettingStarted() {
  const copy = useInspireCopy();
  return (
    <section className="flex flex-col justify-center bg-product-surface pt-10 sm:pt-14">
      <div className="mx-auto w-full max-w-[1200px] px-8 pb-10 sm:px-12 sm:pb-14">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h2 className="font-insp-display text-[1.625rem] font-bold text-navy sm:text-[2.75rem]">
            Getting started is <span className="text-ai-gradient">easy.</span>
          </h2>
          <a
            href={copy.signupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-base font-medium text-[#262626] underline underline-offset-4 hover:underline sm:text-lg"
          >
            Claim your profile in minutes
            <ArrowRight className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          </a>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:mt-10">
          {STEPS.map(({ icon: Icon, color, lead, highlight, rest }, i) => (
            <div
              key={highlight}
              className="relative flex min-h-[190px] flex-col rounded-3xl bg-card p-6"
            >
              <Icon className={`h-8 w-8 ${color}`} strokeWidth={1.6} aria-hidden="true" />
              <p className="mt-5 text-lg font-bold leading-snug text-ink">
                {lead}{" "}
                <span className={color}>{highlight}</span>
                {rest ? ` ${rest}` : ""}
              </p>
              <span
                className="mt-auto self-end font-insp-display text-3xl font-bold text-[#262626]"
                aria-hidden="true"
              >
                {i + 1}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-10 sm:mt-14">
          <div className="grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
            <div className="flex justify-center">
              <SignupQrCode className="h-52 w-52 text-ink sm:h-64 sm:w-64" />
            </div>

            <div>
              <h3 className="font-insp-display text-2xl font-semibold leading-snug text-ink sm:text-3xl">
                Be the obvious choice in your market. Start with your{" "}
                <span className="italic">
                  Search Rank Score
                  <sup className="text-xs">&reg;</sup>
                </span>
              </h3>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a
                  href={copy.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-charcoal px-6 font-insp-product text-sm font-bold text-white shadow-lg transition-opacity hover:opacity-90"
                >
                  Sign up Today
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <span className="inline-flex items-center rounded-md border border-brand-blue/25 bg-brand-blue/10 px-4 py-1.5 font-insp-product text-sm font-bold text-brand-blue">
                  Promo code: {copy.promoCode}
                </span>
              </div>
              <p className="mt-3 inline-flex items-center gap-1.5 font-insp-product text-sm font-medium text-ink/70">
                <Check className="h-4 w-4 text-brand-green" strokeWidth={3} />
                Only takes 10 minutes
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
