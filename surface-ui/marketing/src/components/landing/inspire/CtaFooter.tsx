import { Check, ChevronRight } from "lucide-react";
import { EXPERIENCE_LOGO_URL } from "./brand";
import { useInspireCopy } from "./copy";
import { SignupQrCode } from "./SignupQrCode";

export function CtaFooter() {
  const copy = useInspireCopy();
  return (
    <section className="bg-charcoal">
      <div className="mx-auto w-full max-w-[1200px] px-8 py-12 sm:px-12 sm:py-16">
        <div className="flex flex-wrap items-center justify-between gap-8">
          <div className="max-w-2xl">
            <h2 className="font-insp-display text-[1.625rem] font-bold text-white sm:text-[2.75rem]">
              Be the obvious choice{" "}
              <span className="text-ai-gradient">in your market.</span>
            </h2>
            <p className="mt-4 inline-flex items-center gap-1.5 font-insp-product text-sm font-medium text-white/70 sm:text-base">
              <Check className="h-4 w-4 text-brand-green" strokeWidth={3} />
              Only takes 10 minutes
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <a
                href={copy.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-white px-7 font-insp-product text-base font-bold text-charcoal shadow-lg transition-opacity hover:opacity-90"
              >
                Start with your{" "}
                <span className="italic">
                  Search Rank Score
                  <sup className="text-xs">&reg;</sup>
                </span>{" "}
                &mdash; Sign up Today{" "}
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <span className="inline-flex items-center border border-white/25 bg-white/10 px-4 py-1.5 font-insp-product text-sm font-bold text-white">
                Promo code: {copy.promoCode}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 justify-center rounded-2xl bg-white p-4">
            <SignupQrCode className="h-32 w-32 text-ink sm:h-36 sm:w-36" />
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/20 pt-6 sm:mt-12">
          <img
            src={EXPERIENCE_LOGO_URL}
            alt="Experience.com"
            className="h-4 w-auto brightness-0 invert sm:h-5"
            loading="lazy"
          />
          <p className="font-insp-product text-xs text-white/50 sm:text-sm">
            &copy; 2026 BuyersRoad Inc., DBA Experience.com. All rights reserved.
          </p>
        </div>
      </div>
    </section>
  );
}
