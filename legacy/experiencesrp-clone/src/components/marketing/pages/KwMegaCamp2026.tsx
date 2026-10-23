import { useState, useEffect } from "react";
import { ogImageUrl } from "@/lib/marketing/seo";
import { Button } from "@/components/marketing/ui/button";
import { Input } from "@/components/marketing/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/marketing/ui/accordion";
import { getSignUpUrl } from "@/lib/marketing/envUrls";
import { generateAssessment, type AssessmentLead } from "@/lib/marketing/assessment-store";
import { KwMegaCampPageSchema } from "@/components/marketing/sections/kw-mega-camp/KwMegaCampPageSchema";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  Loader2,
  MapPin,
  MessageSquare,
  Search,
  
  Star,
  ShieldCheck,
  Globe2,
  FileText,
  Gauge,
  Award,
  Clock,
  LogIn,
  TrendingUp,
  BadgeCheck,
  Users,
  Building2,
  X,
  ChevronDown,
} from "lucide-react";
import kwMegaCampLogo from "@/assets/kw-mega-camp-2026-logo.png";
import kwMegaHero from "@/assets/keller-lp-hero-opt1.png";
import agentAvatar1 from "@/assets/kw-agent-avatar-1.png";
import agentAvatar2 from "@/assets/kw-agent-avatar-2.png";
import agentAvatar3 from "@/assets/kw-agent-avatar-3.png";

const agentAvatarImages = [
  { src: agentAvatar1, alt: "Real estate agent using Experience.com dashboard to improve her AI visibility score" },
  { src: agentAvatar2, alt: "Mortgage professional building online reputation with Experience.com platform" },
  { src: agentAvatar3, alt: "Realtor tracking her Search Rank Score on the Experience.com dashboard" },
];
import remaxLogo from "@/assets/client-logos/remax.png";
import bhhsLogo from "@/assets/client-logos/bhhs.png";
import magnoliaLogo from "@/assets/client-logos/magnolia-realty.png";
import crossCountryLogo from "@/assets/client-logos/crosscountry-mortgage.png";
import guildMortgageAsset from "@/assets/client-logos/guild-mortgage-white.png";
import wfgTitleLogo from "@/assets/client-logos/wfg-title.png";
import aiSignalsImage from "@/assets/ai-signals.png";
import kwChildVisibility from "@/assets/kw-child-visibility.png";
import kwChildVisibilityMobile from "@/assets/Keller_Williams_Child_Mobile.png";

import srsAuthorityScoreImage from "@/assets/srs-authority-score-combined.png";
import reputationVisual from "@/assets/reputation-collect.png";
import expertiseVisual from "@/assets/expertise-content.png";
import accuracyVisual from "@/assets/accuracy-listings.png";
import activityVisual from "@/assets/activity-social.png";
import visibilityVisual from "@/assets/visibility-score.png";

const signalVisuals: Record<string, { src: string; alt: string }> = {
  Reputation: {
    src: reputationVisual,
    alt: "Review request sent by SMS and email generating a five-star Google review",
  },
  Expertise: {
    src: expertiseVisual,
    alt: "AI writing assistant drafting a local expertise article with rewrite, simplify and expand options",
  },
  Accuracy: {
    src: accuracyVisual,
    alt: "Realtor profile details syncing to Google Business Profile, Apple Maps, Facebook, Bing, Yelp and other directories",
  },
  Activity: {
    src: activityVisual,
    alt: "Five-star review auto-posted to Facebook, Google and LinkedIn from the social posts dashboard",
  },
  Visibility: {
    src: visibilityVisual,
    alt: "Search Rank Score dashboard showing a 470 score with profile, reviews, listings and connections signals",
  },
};


/* Brand pill badge — matches the Experience.com homepage category pill */
const EYEBROW =
  "inline-block mb-4 px-4 py-1.5 rounded-full font-body text-[12px] font-semibold uppercase tracking-wider text-[#2196F3] bg-[rgba(33,150,243,0.1)]";
const EYEBROW_DARK =
  "inline-block mb-4 px-4 py-1.5 rounded-full font-body text-[12px] font-semibold uppercase tracking-wider text-[#28c3ef] bg-white/10";
const CONTAINER = "max-w-7xl mx-auto px-6 sm:px-10 lg:px-8";

/* ------------------------------------ 1 ----------------------------------- */

const Hero = () => (
  <section className="relative overflow-hidden bg-[#262626] px-8 sm:px-10 lg:px-8">
    <div className={`${CONTAINER} relative z-10 pt-[8.5rem] md:pt-[12rem]`}>

      <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start lg:min-h-[520px]">
        <div className="pb-16 md:pb-24">
          <h1 className="font-heading text-[42px] lg:text-[60px] leading-[1.1] tracking-[-0.02em] text-white mb-4 md:mb-6">
            One platform to get found everywhere.
          </h1>
          <p className="font-body-light text-[17px] sm:text-[18px] md:text-[21px] text-white/80 leading-relaxed max-w-xl mb-8 md:mb-12">
            Your clients are searching Google, scrolling social, and asking AI who they should work
            with.
            <br /><br />
            Experience.com helps you build the visibility and reputation that turn those moments into
            opportunities.
          </p>

          {/* Buttons — stacked below the subtext on all breakpoints */}
          <div className="flex flex-col sm:flex-row gap-3 mb-8 md:mb-12">
            <a href="https://ai-signal-check.lovable.app/kiosk?utm_source=kw_lp&utm_medium=hero_check_ai_visibility&utm_campaign=kw-mega-camp-2026" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
              <Button
                size="lg"
                className="w-full rounded-full font-semibold px-8 shadow-lg bg-[#1a8ff1] hover:bg-[#158ae0] text-white border-none"
              >
                Check My AI Visibility
                <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
            <a href="https://app.experience.com/user/signup?utm_source=kw_lp&utm_medium=hero_sec_create_free_account&utm_campaign=kw-mega-camp-2026" className="w-full sm:w-auto" target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                variant="outline"
                className="w-full rounded-full font-semibold px-8 bg-transparent border border-white/40 text-white hover:bg-white/10 hover:text-white"
              >
                Create Free Account
              </Button>
            </a>
          </div>

        </div>

        <div className="relative flex flex-col lg:self-stretch min-w-0">
          <img
            src={kwMegaHero}
            alt="Real estate agent checking her phone while AI search platforms evaluate her online reputation"
            className="block h-auto w-screen -ml-[56px] max-w-none scale-[1.4] origin-bottom sm:scale-100 sm:origin-center sm:w-full sm:ml-0 sm:max-w-full lg:max-w-[880px] lg:scale-125 lg:origin-bottom lg:mt-auto"
            loading="eager"
          />
        </div>
      </div>
    </div>
  </section>
);

/* ------------------------------------ 2 ----------------------------------- */

const brokerageLogos = [
  { src: remaxLogo, alt: "RE/MAX logo" },
  { src: bhhsLogo, alt: "Berkshire Hathaway HomeServices logo" },
  { src: magnoliaLogo, alt: "Magnolia Realty logo" },
  { src: crossCountryLogo, alt: "CrossCountry Mortgage logo" },
  { src: guildMortgageAsset, alt: "Guild Mortgage logo" },
  { src: wfgTitleLogo, alt: "WFG National Title logo" },
];

const ScrollingLogos = () => {
  const loop = [...brokerageLogos, ...brokerageLogos];

  return (
    <section
      aria-label="Experience.com trusted by RE/MAX, Berkshire Hathaway HomeServices, Magnolia Realty, CrossCountry Mortgage, Guild Mortgage, and WFG National Title"
      className="bg-[#262626] py-10 md:py-14 overflow-hidden border-t border-white/5"
    >
      <div className="flex flex-col gap-6">
        <span className="font-body text-[11px] uppercase tracking-[0.16em] text-white/45 text-center">
          Trusted by
        </span>
        <div className="relative w-full overflow-hidden">
          <div className="flex items-center gap-16 animate-[scroll-logos_40s_linear_infinite] w-max">
            {loop.map((l, i) => (
              <img
                key={`${l.alt}-${i}`}
                src={l.src}
                alt={l.alt}
                loading="lazy"
                className="h-8 md:h-10 w-auto object-contain brightness-0 invert opacity-80 shrink-0"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

/* ------------------------------------ 3 ----------------------------------- */

const HowAiWorks = () => {
  const [openSignal, setOpenSignal] = useState<string>("Reputation");

  return (
  <section className="relative bg-[#262626] px-8 sm:px-10 lg:px-8 py-16 md:py-24 overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-[#1a8ff1]/15 via-transparent to-[#28c3ef]/10 pointer-events-none" />
    <div className={`${CONTAINER} relative`}>
      {/* split header */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-start mb-10 md:mb-14">
        <div className="lg:col-span-7">
          <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-[1.12] tracking-[-0.02em] text-white">
            Everything AI looks for.<br className="hidden lg:block" />{" "}
            <span className="relative inline-block">
              One platform.
              <svg
                className="absolute left-0 -bottom-2 w-full h-[0.28em]"
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2 8.5C40 3.5 108 1.5 198 5.5"
                  stroke="#1a8ff1"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h2>
        </div>
        <div className="lg:col-span-5 lg:pt-2">
          <p className="font-body-light text-[15px] md:text-[16px] text-white/70 leading-relaxed">
            AI doesn't rely on a single source. It looks across your digital presence to understand who you are and why clients should trust you.
          </p>
        </div>
      </div>

      {/* mobile: accordion */}
      <div className="sm:hidden space-y-3">
        {signals.map(({ title, body }) => {
          const isOpen = openSignal === title;
          return (
            <div
              key={title}
              className="overflow-hidden rounded-[20px] bg-white/[0.04] border border-white/10"
            >
              <button
                type="button"
                onClick={() => setOpenSignal(isOpen ? "" : title)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-heading text-[17px] font-semibold text-white">
                  {title}
                </span>
                <ChevronDown
                  className={`w-5 h-5 shrink-0 text-[#1a8ff1] transition-transform duration-300 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-5 pb-5">
                  {signalVisuals[title] && (
                    <img
                      src={signalVisuals[title].src}
                      alt={signalVisuals[title].alt}
                      loading="eager"
                      className="w-full h-[190px] object-contain object-center select-none mb-3"
                    />
                  )}
                  <p className="font-body-light text-[14px] text-white/60 leading-relaxed">
                    {body}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* tablet + desktop: grid */}
      <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
        {signals.map(({ title, body }, i) => (
          <div
            key={title}
            className="group relative overflow-hidden rounded-[20px] md:rounded-[32px] bg-white/[0.04] border border-white/10 p-5 md:p-9 min-h-[320px] md:min-h-[440px] flex flex-col justify-end transition-all duration-300 hover:bg-white/[0.08]"
          >
            {signalVisuals[title] ? (
              <img
                src={signalVisuals[title].src}
                alt={signalVisuals[title].alt}
                loading="eager"
                className="pointer-events-none absolute inset-x-0 top-0 w-full h-[60%] md:h-[68%] object-contain object-center select-none"
              />
            ) : (
              <span
                aria-hidden
                className="pointer-events-none absolute -top-3 right-2 font-heading text-[120px] md:text-[240px] leading-none font-bold text-white/[0.05] select-none"
              >
                {i + 1}
              </span>
            )}

            <div className="relative">
              <h3 className="font-heading text-[17px] md:text-[21px] font-semibold text-white leading-snug">
                {title}
              </h3>
              <p className="font-body-light text-[13px] md:text-[15px] text-white/60 leading-relaxed mt-2 md:mt-3">
                {body}
              </p>
            </div>
          </div>
        ))}

        {/* tablet + desktop statement block */}
        <div className="hidden sm:flex relative overflow-hidden rounded-[20px] md:rounded-[32px] bg-white/[0.04] border border-white/10 p-5 md:p-9 min-h-[320px] md:min-h-[440px] items-center">
          <h3 className="font-heading text-[24px] md:text-[36px] leading-[1.1] tracking-[-0.02em] font-bold bg-gradient-to-br from-[#f5efe9] via-[#e3e0f7] to-[#cfd0f2] bg-clip-text text-transparent">
            All the signals for a complete digital presence.
          </h3>
        </div>
      </div>

    </div>
  </section>
  );
};



/* ------------------------------------ 4 ----------------------------------- */

const signals = [
  {
    icon: Star,
    title: "Reputation",
    body: "Generate, manage, and respond to reviews.",
  },
  {
    icon: FileText,
    title: "Expertise",
    body: "Publish local content structured for AI discovery.",
  },
  {
    icon: MapPin,
    title: "Accuracy",
    body: "Keep your profile and business information consistent.",
  },
  {
    icon: Globe2,
    title: "Activity",
    body: "Stay visible with social posting and fresh content.",
  },
  {
    icon: ShieldCheck,
    title: "Visibility",
    body: "Track your Search Rank Score® and AI Authority Score.",
  },
];


/* ------------------------- Free interactive tool -------------------------- */

const CATEGORY_ICONS: Record<string, typeof Search> = {
  google: Globe2,
  reviews: Star,
  ai: Search,
  directories: MapPin,
  website: ShieldCheck,
  content: FileText,
};

const SCAN_STEPS = [
  "Finding your online presence",
  "Looking for your website",
  "Checking Google reviews",
  "Looking across major directories",
  "Evaluating trust signals",
  "Simulating AI search",
  "Calculating your AI Visibility Score",
];

const FIELDS = [
  { key: "firstName", label: "First name", placeholder: "Jane", span: false },
  { key: "lastName", label: "Last name", placeholder: "Realtor", span: false },
  { key: "email", label: "Email", placeholder: "jane@brokerage.com", span: true },
  { key: "city", label: "City", placeholder: "Austin", span: false },
  { key: "state", label: "State", placeholder: "TX", span: false },
  { key: "brokerage", label: "Brokerage", placeholder: "Keller Williams", span: true },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

const statusTone = (status: string) =>
  status === "Excellent" || status === "Strong"
    ? "text-[#16a34a]"
    : status === "Good"
      ? "text-[#1a8ff1]"
      : status === "Average"
        ? "text-[#d97706]"
        : "text-[#dc2626]";

const ScoreGauge = ({ score }: { score: number }) => {
  const size = 200;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;

  return (
    <div className="relative mx-auto flex h-[200px] w-[200px] shrink-0 items-center justify-center">
      <svg width={size} height={size} className="rotate-[-90deg]">
        <defs>
          <linearGradient id="kwScoreGauge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1a8ff1" />
            <stop offset="100%" stopColor="#28c3ef" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#kwScoreGauge)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-[56px] leading-none font-bold tracking-tight text-foreground">
          {score}
        </span>
        <span className="mt-1 font-body text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          of 100
        </span>
      </div>
    </div>
  );
};

const timeSavers = [
  {
    icon: Clock,
    title: "Minutes, Not Hours",
    body: "Strengthen your visibility in just 20 minutes a week.",
  },
  {
    icon: LogIn,
    title: "One Login",
    body: "Reviews, content, listings, social, and AI visibility in one place.",
  },
  {
    icon: TrendingUp,
    title: "Built for Growth",
    body: "Grow your business, not your workload.",
  },
];

const SpendLessTime = () => (
  <section className="bg-background px-8 sm:px-10 lg:px-8 py-16 md:py-24">
    <div className={CONTAINER}>
      <div className="text-center max-w-3xl mx-auto">
        <p className="font-body text-[13px] md:text-[14px] uppercase tracking-[0.1em] text-[#1a8ff1] font-semibold mb-4">
          Built for busy agents.
        </p>
        <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          Spend less time marketing.<br /> More time selling.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 mt-10 md:mt-14">
        {timeSavers.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-[24px] bg-secondary/60 border border-border/60 p-7 md:p-8"
          >
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[rgba(33,150,243,0.1)] text-[#1a8ff1]">
              <Icon className="w-5 h-5" strokeWidth={2.2} />
            </span>
            <h3 className="font-heading text-[20px] md:text-[22px] font-bold tracking-[-0.01em] text-foreground mt-6">
              {title}
            </h3>
            <p className="font-body-light text-[15px] md:text-base text-muted-foreground leading-relaxed mt-3">
              {body}
            </p>
          </div>
        ))}
      </div>
    </div>
  </section>
);


const VisibilityChecker = () => {
  const [form, setForm] = useState<Record<FieldKey, string>>({
    firstName: "",
    lastName: "",
    email: "",
    city: "",
    state: "",
    brokerage: "",
  });
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [assessment, setAssessment] = useState<AssessmentLead | null>(null);

  const runScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (scanning) return;
    setAssessment(null);
    setScanning(true);
    setScanStep(0);

    const result = generateAssessment({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      brokerage: form.brokerage.trim(),
    });

    let i = 0;
    const tick = () => {
      i += 1;
      if (i >= SCAN_STEPS.length) {
        setScanStep(SCAN_STEPS.length);
        setScanning(false);
        setAssessment(result);
        return;
      }
      setScanStep(i);
      window.setTimeout(tick, 800);
    };
    window.setTimeout(tick, 800);
  };

  return (
    <section
      id="ai-visibility-checker"
      className="relative bg-background px-8 sm:px-10 lg:px-8 py-16 md:py-24 overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a8ff1]/10 to-transparent pointer-events-none" />
      <div className={CONTAINER}>
        <div className="relative text-left lg:text-center max-w-2xl mx-auto mb-10">
          <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em] text-foreground">
            Check your AI Visibility for{" "}
            <span className="relative inline-block">
              FREE
              <svg
                aria-hidden
                viewBox="0 0 300 14"
                className="absolute left-0 -bottom-1 w-full h-[12px] text-[#1a8ff1]"
                preserveAspectRatio="none"
              >
                <path
                  d="M3 9C60 3 200 2 297 6C230 8 120 8 40 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h2>
          <p className="font-body-light text-base md:text-lg text-muted-foreground mt-4">
            See if your online presence makes the cut—or leaves you invisible to your next client.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
            <div className="flex items-center">
              {agentAvatarImages.map((img, i) => (
                <img
                  key={img.src}
                  src={img.src}
                  alt={img.alt}
                  className={`h-9 w-9 rounded-full object-cover ring-2 ring-foreground shadow-lg bg-background ${i > 0 ? "-ml-3" : ""}`}
                  loading="lazy"
                />
              ))}
            </div>
            <p className="font-body-light text-[14px] text-muted-foreground uppercase">
              Trusted by 100,000+ top-producing agents nationwide.
            </p>
          </div>

        </div>

        {/* Form + scan */}
        {!assessment && (
          <div className="relative max-w-2xl mx-auto rounded-3xl bg-white border border-gray-100 shadow-2xl shadow-black/20 p-6 sm:p-10">
            <form onSubmit={runScan}>
              <div className="grid gap-5 sm:grid-cols-2">
                {FIELDS.map(({ key, label, placeholder, span }) => (
                  <div key={key} className={span ? "sm:col-span-2" : undefined}>
                    <label
                      htmlFor={`checker-${key}`}
                      className="font-body text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block"
                    >
                      {label}
                    </label>
                    <Input
                      id={`checker-${key}`}
                      required
                      type={key === "email" ? "email" : "text"}
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="h-12 rounded-2xl"
                    />
                  </div>
                ))}
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={scanning}
                className="mt-8 w-full rounded-full bg-[#262626] sm:hover:bg-[#3a3a3a] text-white font-semibold"
              >
                {scanning ? "Scanning the internet for you…" : "Run my free assessment"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            {scanning && (
              <ul className="mt-8 space-y-2">
                {SCAN_STEPS.map((label, idx) => {
                  const state = idx < scanStep ? "done" : idx === scanStep ? "active" : "pending";
                  return (
                    <li
                      key={label}
                      className={`flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors ${
                        state === "active"
                          ? "bg-muted"
                          : state === "done"
                            ? "opacity-90"
                            : "opacity-40"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          state === "done"
                            ? "bg-[#1a8ff1] text-white"
                            : state === "active"
                              ? "bg-foreground text-background"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {state === "done" ? (
                          <Check className="h-4 w-4" />
                        ) : state === "active" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-current" />
                        )}
                      </span>
                      <span className="font-body text-[14px] sm:text-[15px] text-foreground">
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Results */}
        {assessment && (
          <div className="relative">
            <div className="grid gap-8 rounded-3xl bg-secondary border border-black/5 p-6 sm:p-10 md:grid-cols-[auto_1fr] md:items-center">
              <ScoreGauge score={assessment.score} />
              <div>
                <p className="font-body text-[12px] uppercase tracking-[0.16em] text-[#1a8ff1]">
                  {assessment.firstName}'s AI Visibility Score
                </p>
                <p className="font-body-light text-base md:text-lg text-foreground/75 leading-relaxed mt-3">
                  {assessment.aiSummary}
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {assessment.categories.map((c) => {
                const Icon = CATEGORY_ICONS[c.key] ?? Globe2;
                return (
                  <div
                    key={c.key}
                    className="rounded-3xl bg-white border border-gray-100 shadow-lg shadow-black/10 p-6"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(33,150,243,0.1)]">
                        <Icon className="h-5 w-5 text-[#1a8ff1]" />
                      </span>
                      <span className={`font-body text-[13px] font-semibold ${statusTone(c.status)}`}>
                        {c.status}
                      </span>
                    </div>
                    <h3 className="font-heading text-[18px] font-bold text-foreground mt-5">
                      {c.label}
                      <span className="text-muted-foreground font-body text-[14px] font-normal">
                        {" "}
                        · {c.score}
                      </span>
                    </h3>
                    <p className="font-body-light text-[14px] text-muted-foreground mt-1 leading-relaxed">
                      {c.blurb}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-[#1a8ff1]/40 bg-[#1a8ff1]/10 p-6 sm:p-8">
                <p className="font-body text-[12px] font-semibold uppercase tracking-[0.16em] text-[#1a8ff1]">
                  Biggest opportunity
                </p>
                <p className="font-body-light text-[16px] sm:text-[18px] text-foreground leading-snug mt-3">
                  {assessment.biggestOpportunity}
                </p>
              </div>
              <div className="rounded-3xl border border-[#16a34a]/40 bg-[#16a34a]/10 p-6 sm:p-8">
                <p className="font-body text-[12px] font-semibold uppercase tracking-[0.16em] text-[#16a34a]">
                  Biggest strength
                </p>
                <p className="font-body-light text-[16px] sm:text-[18px] text-foreground leading-snug mt-3">
                  {assessment.biggestStrength}
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:justify-center">
              <a
                href={getSignUpUrl(
                  "utm_source=kw_mega_camp_2026&utm_medium=unlock_report&utm_campaign=checker",
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  size="lg"
                  className="w-full sm:w-auto rounded-full bg-[#1a8ff1] sm:hover:bg-[#158ae0] text-white font-semibold px-8"
                >
                  Unlock my full report
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </a>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto rounded-full px-8"
                onClick={() => {
                  setAssessment(null);
                  setScanStep(0);
                }}
              >
                Run another assessment
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};


/* ------------------------------------ 5 ----------------------------------- */


/* ------------------------------------ 6 ----------------------------------- */

const aiSignalItems = [
  "Build trust before the first conversation.",
  "Showcase your expertise across search, social, and AI.",
  "Generate more leads with a stronger digital presence.",
];

const HowWeFixIt = () => (
  <section className="bg-secondary px-8 sm:px-10 lg:px-8 py-16 md:py-24">
    <div className={CONTAINER}>
      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="-mx-8 sm:mx-0 lg:scale-110 lg:origin-left">
          <img
            src={kwChildVisibilityMobile}
            alt="Real estate agent profile ranking first for 'top realtor west palm beach fl' on ChatGPT, Gemini, and Google with a 767 Search Rank Score"
            className="lg:hidden w-[120%] sm:w-full h-auto rounded-3xl"
            loading="lazy"
          />
          <img
            src={kwChildVisibility}
            alt="Real estate agent profile ranking first for 'top realtor west palm beach fl' on ChatGPT, Gemini, and Google with a 767 Search Rank Score"
            className="hidden lg:block w-full h-auto rounded-3xl"
            loading="lazy"
          />



        </div>

        <div>
          <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em] text-foreground">
            Turn visibility into opportunity
          </h2>
          <p className="font-body-light text-[15px] md:text-base text-muted-foreground leading-relaxed mt-4">
            Experience.com gives you the tools to:
          </p>

          <ul className="grid sm:grid-cols-1 gap-x-6 gap-y-4 mt-8">
            {aiSignalItems.map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="shrink-0 text-[#1a8ff1]">
                  <Check className="w-5 h-5" strokeWidth={2.5} />
                </span>
                <span className="font-body text-[15px] md:text-base text-foreground font-semibold">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </section>
);

/* --------------------------------- 6.5 ------------------------------------ */

const getStartedBenefits = [
  "Search Rank Score®",
  "AI Authority Score",
  "Reputation insights",
  "AI-powered content creation",
  "Review management",
  "Social publishing",
  "Listings management",
  "Personalized recommendations",
];

const GetStartedFree = () => (
  <section id="get-started-free" className="relative overflow-hidden bg-[#262626] px-8 sm:px-10 lg:px-8 py-16 md:py-24">
    <div className="absolute inset-0 bg-gradient-to-br from-[#1a8ff1]/15 via-transparent to-[#28c3ef]/10 pointer-events-none" />
    <div className={`${CONTAINER} relative`}>
      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        {/* Left: content */}
        <div className="text-left">
          <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em] text-white">
            Unlock even more with a FREE account
          </h2>

          <p className="font-body-light text-[15px] md:text-base text-white/70 leading-relaxed mt-6 lg:mt-8">
            Create your free Experience.com account to:
          </p>
          <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 lg:gap-x-10 lg:gap-y-4">
            {getStartedBenefits.map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="shrink-0 text-[#28c3ef]">
                  <Check className="w-5 h-5" strokeWidth={2.5} />
                </span>
                <span className="font-body text-[15px] md:text-base text-white font-semibold">
                  {item}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8 lg:mt-10">
            <a href="https://app.experience.com/user/signup?utm_source=kw_lp&utm_medium=bottom_btn_start_free&utm_campaign=kw-mega-camp-2026" className="inline-block" target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                className="rounded-full bg-[#1a8ff1] hover:bg-[#158ae0] text-white font-semibold border-none px-8"
              >
                Start Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>

        {/* Right: image */}
        <div className="flex justify-center">
          <img
            src={srsAuthorityScoreImage}
            alt="Search Rank Score of 672 feeding into an AI Authority Score of 79 out of 100 across review, listing, profile, and AI platform signals"
            className="w-[80%] h-auto"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  </section>
);



/* ------------------------------------ 7 ----------------------------------- */

/** Countdown for the KW Mega Camp 2026 special pricing window. */
const CAMP_START = new Date("2026-08-17T08:00:00");
const CAMP_END = new Date("2026-08-20T18:00:00");

const pad = (n: number) => String(n).padStart(2, "0");

function getRemaining(target: Date) {
  const total = Math.max(0, target.getTime() - Date.now());
  const days = Math.floor(total / 86400000);
  const hours = Math.floor((total % 86400000) / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return { total, days, hours, minutes, seconds };
}

const CountdownUnit = ({ value, label }: { value: number; label: string }) => (
  <div className="flex flex-col items-center">
    <div className="flex h-14 w-14 md:h-16 md:w-16 items-center justify-center rounded-2xl bg-white/10 font-mono text-2xl md:text-3xl font-bold text-white tabular-nums">
      {pad(value)}
    </div>
    <span className="mt-2 font-body text-[10px] md:text-xs uppercase tracking-[0.12em] text-white/60">
      {label}
    </span>
  </div>
);

const MegaCampCountdown = () => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const beforeStart = now < CAMP_START.getTime();
  const ended = now >= CAMP_END.getTime();
  const target = beforeStart ? CAMP_START : CAMP_END;
  const { total, days, hours, minutes, seconds } = getRemaining(target);

  if (ended) {
    return (
      <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-body text-sm text-white/80">
        <Clock className="h-4 w-4" /> Special pricing has ended
      </p>
    );
  }

  return (
    <div className="mt-6">
      <p className="mb-3 inline-flex items-center gap-2 font-body text-sm font-semibold text-[#28c3ef]">
        <Clock className="h-4 w-4" />
        {beforeStart ? "Starts August 17th at 8am in San Antonio, TX" : "Special pricing ends in"}
      </p>
      <div className="flex items-start gap-3 md:gap-4">
        <CountdownUnit value={days} label="Days" />
        <CountdownUnit value={hours} label="Hours" />
        <CountdownUnit value={minutes} label="Minutes" />
        <CountdownUnit value={seconds} label="Seconds" />
      </div>
    </div>
  );
};







const MegaCampOffer = () => {
  const [copied, setCopied] = useState(false);
  const promoCode = "KWMEGA2026";

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(promoCode);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = promoCode;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative overflow-hidden bg-[#262626] px-8 sm:px-10 lg:px-8 py-16 md:py-24">
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a8ff1]/15 via-transparent to-[#28c3ef]/10 pointer-events-none" />
      <div className={`${CONTAINER} relative`}>
        <div className="grid md:grid-cols-2 gap-10 items-center">
          {/* Left: logo */}
          <div className="flex flex-col items-center md:items-start">
            <span className="font-body text-[11px] tracking-[0.18em] uppercase text-white block">
              Exclusively for
            </span>
            <img
              src={kwMegaCampLogo}
              alt="Keller Williams Mega Camp 2026 official event logo"
              className="h-9 md:h-16 w-auto mt-3"
            />
          </div>

          {/* Right: H2, subtext, promo code, button */}
          <div className="text-center md:text-left">
            <h2 className="font-heading text-[30px] md:text-[42px] font-bold leading-tight tracking-[-0.02em] text-white">
              Limited time PRO offer
            </h2>
            <p className="font-body-light text-base md:text-lg text-white/85 mt-4 max-w-2xl">
              Get the Search Rank Platform for just{" "}
              <span className="text-white font-semibold">$49/month</span> (paid monthly) or{" "}
              <span className="text-white font-semibold">$490/year</span> (annual pre-payment)
            </p>
            <p className="font-body-light text-base md:text-lg text-white/85 mt-3 max-w-2xl">
              Use promo code:{" "}
              <button
                type="button"
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 align-baseline font-mono text-[#28c3ef] font-semibold underline decoration-dotted underline-offset-4 hover:text-white transition-colors"
                aria-label={`Copy promo code ${promoCode}`}
              >
                {promoCode}
                {copied ? (
                  <Check className="h-4 w-4 shrink-0" />
                ) : (
                  <Copy className="h-4 w-4 shrink-0" />
                )}
              </button>
            </p>
            <p className="font-body text-sm text-white/60 mt-3 max-w-2xl">
              *offer valid only during Mega Camp 2026
            </p>
            <MegaCampCountdown />
          </div>
        </div>
      </div>
    </section>
  );
};

/* ------------------------- Stronger Together flow ------------------------- */

const flowChannels = [
  { label: "Reviews", icon: Star },
  { label: "Content", icon: FileText },
  { label: "Listings", icon: MapPin },
  { label: "Social", icon: Globe2 },
];

const FlowConnector = () => (
  <div className="flex justify-center" aria-hidden="true">
    <div className="relative h-10 md:h-12 w-px bg-gradient-to-b from-[#1a8ff1]/20 via-[#1a8ff1]/60 to-[#1a8ff1]/20">
      <span className="absolute -bottom-[3px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#1a8ff1]" />
    </div>
  </div>
);

const StrongerTogether = () => (
  <section className="bg-secondary/40 px-8 sm:px-10 lg:px-8 py-16 md:py-24">
    <div className={`${CONTAINER} max-w-4xl`}>
      <div className="text-center">
        <p className="font-body text-[13px] md:text-[14px] uppercase tracking-[0.1em] text-[#1a8ff1] font-semibold mb-4">
          The office effect
        </p>
        <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          Stronger agents. Stronger offices.<br className="hidden lg:block" /> Stronger brand.
        </h2>
        <p className="font-body-light text-base md:text-lg text-muted-foreground leading-relaxed mt-6 max-w-2xl mx-auto">
          Every review, piece of content, social post, and profile update strengthens more
          than just your personal brand—it contributes to the online visibility and
          reputation of your Keller Williams office.
        </p>
      </div>

      <div className="mt-12 md:mt-16">
        {/* Step 1 */}
        <div className="rounded-[22px] bg-background border border-border/70 shadow-[0_2px_20px_-8px_rgba(15,23,42,0.15)] p-5 md:p-6 flex items-center gap-4">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[rgba(33,150,243,0.1)] text-[#1a8ff1] shrink-0">
            <Users className="w-5 h-5" strokeWidth={2.2} />
          </span>
          <div>
            <h3 className="font-heading text-[18px] md:text-[20px] font-bold tracking-[-0.01em] text-foreground">
              Individual agent activity
            </h3>
            <p className="font-body-light text-[14px] md:text-[15px] text-muted-foreground mt-1">
              One agent keeps their presence active and accurate.
            </p>
          </div>
        </div>

        <FlowConnector />

        {/* Step 2 — channels */}
        <div className="rounded-[22px] bg-[#262626] p-5 md:p-7">
          <p className="font-body text-[11px] tracking-[0.18em] uppercase text-white/60 text-center">
            Compounding signals
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {flowChannels.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-2 rounded-2xl bg-white/[0.07] border border-white/10 py-4"
              >
                <Icon className="w-5 h-5 text-[#5cc2ff]" strokeWidth={2.2} />
                <span className="font-body text-[13px] md:text-[14px] font-semibold text-white">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <FlowConnector />

        {/* Step 3 */}
        <div className="rounded-[22px] bg-gradient-to-r from-[#1a8ff1] to-[#28c3ef] p-5 md:p-6 flex items-center gap-4 shadow-[0_18px_40px_-20px_rgba(26,143,241,0.8)]">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 text-white shrink-0">
            <Search className="w-5 h-5" strokeWidth={2.2} />
          </span>
          <div>
            <h3 className="font-heading text-[18px] md:text-[20px] font-bold tracking-[-0.01em] text-white">
              Stronger agent visibility
            </h3>
            <p className="font-body-light text-[14px] md:text-[15px] text-white/85 mt-1">
              Search engines and AI models recommend you with confidence.
            </p>
          </div>
        </div>

        <FlowConnector />

        {/* Step 4 */}
        <div className="rounded-[22px] bg-background border-2 border-[#1a8ff1]/30 p-5 md:p-6 flex items-center gap-4">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[rgba(33,150,243,0.1)] text-[#1a8ff1] shrink-0">
            <Building2 className="w-5 h-5" strokeWidth={2.2} />
          </span>
          <div>
            <h3 className="font-heading text-[18px] md:text-[20px] font-bold tracking-[-0.01em] text-foreground">
              Stronger office &amp; team visibility
            </h3>
            <p className="font-body-light text-[14px] md:text-[15px] text-muted-foreground mt-1">
              As every agent improves, the entire office becomes more visible across
              search and AI.
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-12 md:mt-16 flex justify-center">
        <a
          href="https://meetings-na2.hubspot.com/richard-mackoy?utm_source=kw_lp&utm_medium=office_effect_book_demo&utm_campaign=kw-mega-camp-2026"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button
            size="lg"
            className="rounded-full bg-[#1a8ff1] sm:hover:bg-[#158ae0] text-white font-semibold px-8"
          >
            See Experience.com in Action
            <ArrowRight className="h-4 w-4" />
          </Button>
        </a>
      </div>
    </div>
  </section>
);

/* ---------------------------- Testimonials ---------------------------- */

const testimonials = [
  {
    quote:
      "The SEO help has been great to help potential clients find me. There are several mega agents in my area that spend huge amounts on SEO and I am now able to compete on that level with a small monthly investment.",
    name: "Rob B.",
    title: "Realtor",
  },
  {
    quote:
      "Experience.com helps me understand how I can help my clients in the future and improve my service. It makes the review process easy and lets me compare my performance with other agents in the local market.",
    name: "Bettina S.",
    title: "Small Business Owner",
  },
  {
    quote:
      "I use Experience.com to increase searchability on AI and find realtor clients. The fact that Experience.com connects to all my profiles across the Internet is really helpful. Also, the initial setup was extremely easy, which made things convenient for me.",
    name: "Marisa G.",
    title: "Small Business Owner",
  },
  {
    quote:
      "I like how Experience.com consolidates everything in one place, making it easily accessible for clients, employees, employers, and partners. This all-in-one feature simplifies the process of reaching out and interacting with various stakeholders effortlessly.",
    name: "Carmen C.",
    title: "Owner",
  },
];

const Testimonials = () => (
  <section className="bg-background px-8 sm:px-10 lg:px-8 py-16 md:py-24">
    <div className={`${CONTAINER} max-w-5xl`}>
      <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em] text-foreground text-center mb-12">
        Reviews Build Trust. Visibility Builds Business
      </h2>
      {/* Desktop / tablet: grid */}
      <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-6">
        {testimonials.map((t) => (
          <div
            key={t.name}
            className="rounded-3xl bg-white border border-gray-100 shadow-xl shadow-black/5 p-6 md:p-8 flex flex-col"
          >
            <div className="flex gap-1 mb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="w-4 h-4 fill-[#1a8ff1] text-[#1a8ff1]" />
              ))}
            </div>
            <p className="font-body-light text-[15px] md:text-base text-muted-foreground leading-relaxed flex-1">
              &ldquo;{t.quote}&rdquo;
            </p>
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="font-body text-[15px] font-semibold text-foreground">{t.name}</p>
              <p className="font-body-light text-[13px] text-muted-foreground">{t.title}</p>
            </div>
          </div>
        ))}
      </div>
      {/* Mobile: horizontal slider */}
      <div className="md:hidden -mx-8 px-8 overflow-x-auto snap-x snap-mandatory flex gap-4 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {testimonials.map((t) => (
          <div
            key={t.name}
            className="snap-center shrink-0 w-[80%] rounded-3xl bg-white border border-gray-100 shadow-xl shadow-black/5 p-6 flex flex-col"
          >
            <div className="flex gap-1 mb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="w-4 h-4 fill-[#1a8ff1] text-[#1a8ff1]" />
              ))}
            </div>
            <p className="font-body-light text-[15px] text-muted-foreground leading-relaxed flex-1">
              &ldquo;{t.quote}&rdquo;
            </p>
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="font-body text-[15px] font-semibold text-foreground">{t.name}</p>
              <p className="font-body-light text-[13px] text-muted-foreground">{t.title}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ------------------------------------ 8 ----------------------------------- */

const faqs = [
  {
    q: "Is the assessment really free?",
    a: "Yes. You get your baseline AI Visibility Score immediately without entering a credit card.",
  },
  {
    q: "Does high AI Visibility guarantee ChatGPT will recommend me?",
    a: "No single score guarantees placement, but higher visibility signals significantly increase the likelihood AI systems trust and recommend your business.",
  },
  {
    q: "Do I need technical skills to fix my score?",
    a: "Not at all. Experience.com automates profile sync, review management, and search signal optimization for you.",
  },
];

const FAQ = () => (
  <section className="bg-background px-8 sm:px-10 lg:px-8 py-16 md:py-24">
    <div className={`${CONTAINER} max-w-3xl`}>
      <div className="text-center mb-10">
        <h2 className="font-heading text-[30px] md:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-0.02em] text-foreground">
          Frequently asked questions
        </h2>
      </div>
      <Accordion type="single" collapsible className="w-full">
        {faqs.map((f, i) => (
          <AccordionItem key={f.q} value={`item-${i}`}>
            <AccordionTrigger className="text-left font-heading text-[17px] md:text-[19px] text-foreground">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="font-body-light text-[15px] md:text-base text-muted-foreground leading-relaxed">
              {f.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  </section>
);

/* ------------------------------------ 9 ----------------------------------- */

const FinalCTA = () => (
  <section className="relative overflow-hidden px-8 sm:px-10 lg:px-8 py-20 md:py-28" style={{ backgroundColor: "#262626" }}>
    <div className="absolute inset-0 bg-gradient-to-br from-[#1a8ff1]/20 via-transparent to-[#28c3ef]/10 pointer-events-none" />
    <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-[#1a8ff1]/20 blur-[100px] pointer-events-none" />
    <div className={`${CONTAINER} relative`}>
      <div className="max-w-3xl lg:max-w-none mx-auto text-center">
        <div className="relative">
          <p className="font-body text-[12px] md:text-[13px] font-bold uppercase tracking-[0.14em] text-white mb-5">
            Don&rsquo;t let competitors own AI search in your market
          </p>
          <h2 className="font-heading text-[30px] md:text-[44px] font-bold leading-tight tracking-[-0.02em] text-white lg:whitespace-nowrap">
            Ready to strengthen your online presence?
          </h2>
          <p className="font-body-light text-base md:text-lg text-white/75 mt-4 max-w-3xl mx-auto">
            Create your free account and start building visibility to help you get found everywhere.
          </p>

          <div className="mt-9 flex justify-center">
            <a href="https://app.experience.com/user/signup?utm_source=kw_lp&utm_medium=footer_btn_create_my_free_account&utm_campaign=kw-mega-camp-2026" target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                className="rounded-full bg-transparent border-2 border-white text-white sm:hover:bg-white sm:hover:text-[#1a8ff1] px-8 font-semibold"
              >
                Create My FREE Account
                <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ---------------------------------- Page ---------------------------------- */

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

const KwMegaCamp2026 = () => {
  return (
    <>
      <KwMegaCampPageSchema />


      <Hero />
      <ScrollingLogos />
      {/* <VisibilityChecker /> — hidden per request */}

      <SpendLessTime />
      <HowAiWorks />
      <HowWeFixIt />
      <GetStartedFree />

      <MegaCampOffer />
      <StrongerTogether />
      <Testimonials />
      <FAQ />
      <FinalCTA />
    </>
  );
};

export default KwMegaCamp2026;

export const seoMeta = [
  { title: "KW Mega Camp 2026 | Will AI Recommend You? | Experience.com" },
  { "name": "description", "content": "Run your free AI Visibility assessment at KW Mega Camp 2026 and see how ChatGPT, Gemini, and Google AI recommend your business to buyers and sellers." },
  { "name": "keywords", "content": "KW Mega Camp 2026, Experience.com Keller Williams, get found by AI as a realtor, how to rank on ChatGPT and Gemini, Will AI Recommend You?, how to get recommended by chatgpt, how to get recommended by ai" },
  { "name": "robots", "content": "index, follow" },
  { "property": "og:title", "content": "KW Mega Camp 2026 | Will AI Recommend You? | Experience.com" },
  { "property": "og:description", "content": "Run your free AI Visibility assessment and see how ChatGPT, Gemini, and Google AI recommend your real estate business to buyers and sellers." },
  { "property": "og:type", "content": "website" },
  { "property": "og:url", "content": "https://www.experience.com/kw-mega-camp-2026/" },
  { "property": "og:site_name", "content": "Experience.com" },
  { "name": "twitter:card", "content": "summary_large_image" },
  { "name": "twitter:title", "content": "KW Mega Camp 2026 | Will AI Recommend You? | Experience.com" },
  { "name": "twitter:description", "content": "Run your free AI Visibility assessment and see how ChatGPT, Gemini, and Google AI recommend your real estate business to buyers and sellers." },
  { "name": "twitter:site", "content": "@experience__com" },
  { "property": "og:image", "content": ogImageUrl("kw-mega-camp-2026") },
  { "property": "og:image:secure_url", "content": ogImageUrl("kw-mega-camp-2026") },
  { "property": "og:image:width", "content": "1200" },
  { "property": "og:image:height", "content": "630" },
  { "property": "og:image:type", "content": "image/png" },
  { "property": "og:image:alt", "content": "Keller Williams Mega Camp 2026 preview showing agent visibility across ChatGPT, Gemini, and Google." },
  { "name": "twitter:image", "content": ogImageUrl("kw-mega-camp-2026") },
  { "name": "twitter:image:alt", "content": "Keller Williams Mega Camp 2026 preview showing agent visibility across ChatGPT, Gemini, and Google." },
];

export const seoLinks = [
  { rel: "canonical", href: "https://www.experience.com/kw-mega-camp-2026" },
];
