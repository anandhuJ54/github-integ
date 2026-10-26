import { useEffect, useRef, useState } from "react";
import { ogImageUrl } from "@v3/marketing/lib/marketing/seo";

import { LogoSliderBar } from "@v3/marketing/components/marketing/sections/xmp/LogoSliderBar";
import { XMPTestimonialsSection } from "@v3/marketing/components/marketing/sections/xmp/XMPTestimonialsSection";
import g2Leader from "@v3/marketing/assets/awards/g2-leader-w26.png";
import g2BestUsability from "@v3/marketing/assets/awards/g2-best-usability-w26.png";
import g2BestResults from "@v3/marketing/assets/awards/g2-best-results-w26.png";
import g2BestROI from "@v3/marketing/assets/awards/g2-best-roi-w26.png";
import capterraEaseOfUse from "@v3/marketing/assets/awards/capterra-ease-of-use-26.png";
import capterraShortlist from "@v3/marketing/assets/awards/capterra-shortlist-26.png";

const STEP_LABELS = ["Qualify", "Your info", "Business", "Confirmation"];

const BADGES = [
  { src: g2Leader, alt: "G2 Winter 2026 Leader badge" },
  { src: g2BestUsability, alt: "G2 Winter 2026 Best Usability badge" },
  { src: capterraEaseOfUse, alt: "Capterra Best Ease of Use 2026 badge" },
  { src: capterraShortlist, alt: "Capterra Shortlist 2026 badge" },
  { src: g2BestResults, alt: "G2 Winter 2026 Best Results badge" },
  { src: g2BestROI, alt: "G2 Winter 2026 Best Est. ROI Small Business badge" },
];

const HUBSPOT_SCRIPT_SRC = "https://js-na2.hsforms.net/forms/embed/244454239.js";

const FormHeader = ({
  align = "center",
  as: Heading = "h1",
}: {
  align?: "left" | "center";
  as?: "h1" | "h2";
}) => (
  <div className={align === "center" ? "text-center" : "text-left"}>
    <Heading className="text-[36px] md:text-[44px] lg:text-[52px] text-slate-900 leading-[1.05] tracking-[-0.02em] mb-4">
      <span className="font-light">Command the experience.</span>
      <br />
      <span className="font-bold">Master search.</span>
    </Heading>
    <p className={`text-base md:text-lg text-slate-500 leading-relaxed ${align === "center" ? "mx-auto" : ""} max-w-xl`}>
      One platform for local search visibility, reputation management, and AI search — built to scale with you, whether you're a team of one or a thousand.
    </p>
  </div>
);


const StepProgress = ({ currentStep = 1 }: { currentStep?: number }) => {
  const progressPercent = Math.round((currentStep / STEP_LABELS.length) * 100);
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[#262626]">
          Step {currentStep} of {STEP_LABELS.length}
        </span>
        <span className="text-sm font-medium text-[#262626]">{progressPercent}%</span>
      </div>
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#0052FF] to-[#28c3ef] transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="flex justify-between mt-3">
        {STEP_LABELS.map((label, i) => (
          <span
            key={label}
            className={`text-xs font-medium transition-colors ${
              currentStep >= i + 1 ? "text-[#0052FF]" : "text-slate-400"
            }`}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};

const HubSpotForm = ({ onAdvanceStep }: { onAdvanceStep?: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const existing = document.querySelector(`script[src="${HUBSPOT_SCRIPT_SRC}"]`);
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.src = HUBSPOT_SCRIPT_SRC;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!onAdvanceStep) return;
    const root = containerRef.current;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      const iframe = root?.querySelector("iframe");
      if (iframe && event.source && event.source !== iframe.contentWindow) return;

      const type: string = data.type || data.eventName || "";
      const name: string = data.eventName || data.id || "";
      const combined = `${type} ${name}`.toLowerCase();

      if (/step|page|next|advance/.test(combined) || combined.includes("hsformcallback")) {
        console.debug("[HubSpot form event]", data);
        onAdvanceStep();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onAdvanceStep]);

  return (
    <div ref={containerRef}>
      <div
        className="hs-form-frame"
        data-region="na2"
        data-form-id="365e9939-2e56-4338-9dd7-7ceb2d7fab9d"
        data-portal-id="244454239"
      />
    </div>
  );
};

const RequestADemo = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const advanceStep = () => setCurrentStep((s) => Math.min(s + 1, STEP_LABELS.length));
  const beyondStep1 = currentStep > 1;

  return (
    <>

      {/* ─── MOBILE LAYOUT ─── */}
      <section className="min-h-[90vh] lg:hidden bg-gradient-to-b from-white via-[#EAF4FC] to-[#CFE6F7]">
        <div className="container mx-auto max-w-xl px-4 pt-24 pb-16">
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100">
            {!beyondStep1 && (
              <>
                <div className="mb-8">
                  <FormHeader as="h2" />

                </div>
                <div className="mb-8 flex flex-wrap items-center justify-center gap-4">
                  {BADGES.map((b, i) => (
                    <img key={i} src={b.src} alt={b.alt} className="h-[56px] w-auto" />
                  ))}
                </div>
              </>
            )}
            {beyondStep1 && (
              <div className="mb-6 pb-6 border-b border-slate-100">
                <StepProgress currentStep={currentStep} />
              </div>
            )}
            <HubSpotForm onAdvanceStep={advanceStep} />
          </div>
        </div>
      </section>

      {/* ─── DESKTOP LAYOUT ─── */}
      <section className="min-h-[90vh] hidden lg:block bg-gradient-to-b from-white via-[#EAF4FC] to-[#CFE6F7]">
        <div className="container mx-auto max-w-3xl px-6 lg:px-12 pt-28 pb-20">
          <div className="bg-white rounded-2xl p-8 shadow-lg border border-slate-100">
            {!beyondStep1 && (
              <>
                <div className="mb-8">
                  <FormHeader />
                </div>
                <div className="mb-8 flex flex-wrap items-center justify-center gap-6">
                  {BADGES.map((b, i) => (
                    <img key={i} src={b.src} alt={b.alt} className="h-[64px] w-auto" />
                  ))}
                </div>
              </>
            )}
            {beyondStep1 && (
              <div className="mb-8 pb-6 border-b border-slate-100">
                <StepProgress currentStep={currentStep} />
              </div>
            )}
            <HubSpotForm onAdvanceStep={advanceStep} />
          </div>
        </div>
      </section>

      <LogoSliderBar />
      <XMPTestimonialsSection />
    </>
  );
};

export default RequestADemo;

export const seoMeta = [
  { title: "Request a Demo | Experience.com \u2014 Local Search & Reputation Management" },
  { "name": "description", "content": "Request a demo to learn how Experience.com improves local search visibility, reputation management, and AI search presence \u2014 for teams of any size." },
  { "name": "robots", "content": "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" },
  { "property": "og:title", "content": "Request a Demo | Experience.com \u2014 Local Search & Reputation Management" },
  { "property": "og:description", "content": "Request a demo to see how Experience.com improves your local search visibility, reputation, and AI search presence \u2014 for any size team." },
  { "property": "og:url", "content": "https://www.experience.com/request-a-demo/" },
  { "property": "og:type", "content": "website" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:title", "content": "Request a Demo | Experience.com \u2014 Local Search & Reputation Management" },
  { "name": "twitter:description", "content": "Request a demo to see how Experience.com improves your local search visibility, reputation, and AI search presence \u2014 for any size team." },
  { "name": "twitter:site", "content": "@experience__com" },
  { "property": "og:image", "content": ogImageUrl("contact-us") },
  { "property": "og:image:secure_url", "content": ogImageUrl("contact-us") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Experience.com platform demo showing local search visibility and reputation management in action." },
  { "name": "twitter:image", "content": ogImageUrl("contact-us") },
  { "name": "twitter:image:alt", "content": "Experience.com platform demo showing local search visibility and reputation management in action." },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/request-a-demo/" },
];
