import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, HelpCircle, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeHtml, type Block, type BlockCta, type BlockItem } from "@/lib/public-site";
import { resolveSectionImage } from "@/lib/marketing/section-images";
import { iconByName } from "./icon";

/* ────────────────────────── shared bits ────────────────────────── */

const ACCENT = "#1a8ff1";

function Cta({ cta, size = "md" }: { cta: BlockCta; size?: "md" | "lg" }) {
  const base = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors",
    size === "lg" ? "h-12 px-8 text-[15px]" : "h-11 px-6 text-sm",
  );
  const style =
    cta.variant === "secondary"
      ? "border border-slate-300 bg-white text-slate-900 hover:border-slate-900"
      : cta.variant === "ghost"
        ? "text-slate-900 hover:bg-slate-100"
        : cta.variant === "white"
          ? "bg-white text-slate-900 shadow-lg hover:bg-slate-100"
          : "bg-[#1a8ff1] text-white shadow-lg hover:bg-[#1478cc]";
  const external = cta.external ?? /^https?:/i.test(cta.href ?? "");
  return (
    <a
      href={cta.href || "#"}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(base, style)}
    >
      {cta.label}
      {cta.variant ? null : <ArrowRight className="h-4 w-4" />}
    </a>
  );
}

function Ctas({ ctas, size = "md", center }: { ctas?: BlockCta[]; size?: "md" | "lg"; center?: boolean }) {
  if (!ctas?.length) return null;
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start", center && "sm:justify-center")}>
      {ctas.map((cta) => (
        <div key={`${cta.label}-${cta.href}`} className={cn("flex flex-col gap-2", center && "items-center")}>
          <Cta cta={cta} size={size} />
          {cta.note ? <span className="text-[13px] text-slate-500">{cta.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function Eyebrow({ children, tone = "light" }: { children?: string; tone?: "light" | "dark" }) {
  if (!children) return null;
  return (
    <span
      className={cn("mb-4 inline-block text-xs font-semibold uppercase tracking-wide sm:text-sm")}
      style={{ color: tone === "dark" ? "#7cc4fb" : ACCENT }}
    >
      {children}
    </span>
  );
}

function Headline({ block, className, as }: { block: Block; className?: string; as?: "h1" | "h2" }) {
  if (!block.headline) return null;
  const Tag = as ?? "h2";
  return (
    <Tag className={cn("font-heading leading-[1.1] tracking-tight", className)}>
      {block.headline}
      {block.accent ? (
        <>
          {" "}
          <span className="bg-gradient-to-r from-[#1a8ff1] to-[#28c3ef] bg-clip-text text-transparent">
            {block.accent}
          </span>
        </>
      ) : null}
    </Tag>
  );
}


function Img({ src, alt, className }: { src?: string; alt?: string; className?: string }) {
  const url = resolveSectionImage(src);
  if (!url) return null;
  return <img src={url} alt={alt ?? ""} loading="lazy" className={className} />;
}

function Wrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("px-4 py-12 sm:py-16 lg:py-20", className)}>
      <div className="container mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

/* ────────────────────────── sections ────────────────────────── */

function HeroSection({ block }: { block: Block }) {
  const image = resolveSectionImage(block.image);
  return (
    <section className="relative overflow-hidden bg-white px-3 sm:px-4">
      <div className="absolute inset-0 bg-gradient-to-b from-purple-50/80 via-white to-blue-50/40" />
      <div className="absolute left-1/4 top-0 h-[600px] w-[600px] rounded-[50%] bg-purple-200/40 blur-[120px]" />
      <div className="absolute right-1/4 top-0 h-[600px] w-[600px] rounded-[50%] bg-blue-200/40 blur-[120px]" />
      <div className="container relative z-10 mx-auto max-w-[1296px] pb-0 pt-24 md:pt-28 lg:pt-32">
        <div className={cn("lg:grid lg:gap-16", image ? "lg:grid-cols-2 lg:items-center lg:pb-24" : "lg:pb-16")}>
          <div>
            <Eyebrow>{block.eyebrow}</Eyebrow>
            <Headline as="h1" block={block} className="mb-4 text-[42px] text-slate-900 md:mb-6 lg:text-[60px]" />
            {block.subhead ? (
              <p className="mb-6 max-w-3xl text-[17px] leading-relaxed text-slate-600 sm:text-[18px] md:mb-8 md:text-[21px]">
                {block.subhead}
              </p>
            ) : null}
            <Ctas ctas={block.ctas} size="lg" />
            {block.note ? <p className="mt-4 text-sm text-slate-500">{block.note}</p> : null}
          </div>
          {image ? (
            <div className="mt-10 lg:mt-0">
              <Img src={block.image} alt={block.imageAlt} className="h-auto w-full" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PillarBand({ block }: { block: Block }) {
  const items = block.items ?? [];
  return (
    <section style={{ backgroundColor: "#262626" }}>
      <div className="px-8 py-14 sm:px-10 md:py-20 lg:px-16">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-2 md:gap-10 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-2">
              <Eyebrow tone="dark">{block.eyebrow}</Eyebrow>
              {block.headline ? (
                <h2 className="font-heading text-[30px] font-bold leading-tight tracking-[-0.02em] text-white md:text-[36px] lg:text-[42px]">
                  {block.headline}
                </h2>
              ) : null}
              {block.subhead ? (
                <p className="mt-4 text-sm leading-relaxed text-white/60 md:text-base">{block.subhead}</p>
              ) : null}
            </div>
            {items.map((item) => {
              const Icon = iconByName(item.icon);
              return (
                <div key={item.title} className="space-y-4">
                  <div className="h-px w-full bg-white/20" />
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5" style={{ color: ACCENT }} />
                    <h3 className="font-heading text-base font-semibold text-white md:text-lg">{item.title}</h3>
                  </div>
                  {item.body ? (
                    <p className="text-sm leading-relaxed text-white/60">{item.body}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureSplit({ block }: { block: Block }) {
  const items = block.items ?? [];
  if (!items.length) return null;
  return (
    <Wrap className="bg-white">
      {block.headline || block.subhead ? (
        <div className="mb-12 max-w-3xl">
          <Eyebrow>{block.eyebrow}</Eyebrow>
          <Headline block={block} className="text-3xl text-slate-900 lg:text-[42px]" />
          {block.subhead ? <p className="mt-4 text-lg text-slate-600">{block.subhead}</p> : null}
        </div>
      ) : null}
      <div className="space-y-16 sm:space-y-20 lg:space-y-24">
        {items.map((item, i) => {
          const right = (item.imagePosition ?? (i % 2 === 0 ? "left" : "right")) === "right";
          const image = resolveSectionImage(item.image);
          return (
            <div key={item.title ?? i} className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-16">
              {image ? (
                <div className={cn("order-1", right ? "lg:order-2" : "lg:order-1")}>
                  <Img src={item.image} alt={item.imageAlt} className="h-auto w-full rounded-xl" />
                </div>
              ) : null}
              <div className={cn("order-2 space-y-4", right ? "lg:order-1" : "lg:order-2")}>
                {item.eyebrow ? <Eyebrow>{item.eyebrow}</Eyebrow> : null}
                <h3 className="font-heading text-3xl leading-[1.15] text-slate-900 lg:text-[42px] lg:leading-[1.1]">
                  {item.title}
                </h3>
                {item.body ? (
                  <p className="text-base leading-relaxed text-slate-600 sm:text-lg">{item.body}</p>
                ) : null}
                {item.bullets?.length ? (
                  <ul className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-3 lg:grid-cols-1">
                    {item.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-center gap-3">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[50%]"
                          style={{ backgroundColor: "rgba(26,143,241,0.12)" }}
                        >
                          <Check className="h-5 w-5" style={{ color: ACCENT }} />
                        </span>
                        <span className="text-sm font-medium text-slate-700 md:text-base">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.ctas?.length ? <div className="pt-2"><Ctas ctas={item.ctas} /></div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {block.ctas?.length ? <div className="mt-12"><Ctas ctas={block.ctas} /></div> : null}
    </Wrap>
  );
}

function FeatureGrid({ block }: { block: Block }) {
  const items = block.items ?? [];
  if (!items.length) return null;
  return (
    <Wrap className="bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {block.headline ? (
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <Eyebrow>{block.eyebrow}</Eyebrow>
          <Headline block={block} className="text-3xl text-slate-900 lg:text-[42px]" />
          {block.subhead ? <p className="mt-4 text-lg text-slate-600">{block.subhead}</p> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const Icon = iconByName(item.icon);
          const image = resolveSectionImage(item.image);
          const inner = (
            <div className="flex h-full flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white">
              <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[50%]"
                    style={{ backgroundColor: "rgba(26,143,241,0.12)" }}
                  >
                    <Icon className="h-5 w-5" style={{ color: ACCENT }} />
                  </span>
                  <h3 className="font-heading text-lg font-semibold text-slate-900 sm:text-xl">{item.title}</h3>
                </div>
                {item.body ? <p className="text-sm leading-relaxed text-slate-600">{item.body}</p> : null}
                {item.bullets?.length ? (
                  <ul className="mt-1 space-y-2">
                    {item.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-3">
                        <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT }} />
                        <span className="text-sm font-medium text-slate-700">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {image ? (
                <div className="flex h-[215px] items-center justify-center bg-gradient-to-b from-blue-100 via-blue-50 to-purple-100 px-6">
                  <Img
                    src={item.image}
                    alt={item.imageAlt}
                    className="max-h-[170px] w-auto max-w-[85%] object-contain drop-shadow-lg"
                  />
                </div>
              ) : null}
            </div>
          );
          return item.href ? (
            <a key={item.title ?? i} href={item.href} className="block transition-transform hover:-translate-y-0.5">
              {inner}
            </a>
          ) : (
            <div key={item.title ?? i}>{inner}</div>
          );
        })}
      </div>
      {block.ctas?.length ? <div className="mt-10 flex justify-center"><Ctas ctas={block.ctas} center /></div> : null}
    </Wrap>
  );
}

function StatBand({ block }: { block: Block }) {
  const items = block.items ?? [];
  if (!items.length) return null;
  const dark = block.theme === "dark";
  return (
    <section className={cn("px-4 py-14 md:py-16", dark ? "bg-[#262626]" : "bg-slate-50")}>
      <div className="container mx-auto max-w-6xl">
        {block.headline ? (
          <h2
            className={cn(
              "mb-10 text-center font-heading text-2xl lg:text-3xl",
              dark ? "text-white" : "text-slate-900",
            )}
          >
            {block.headline}
          </h2>
        ) : null}
        <dl className={cn("grid grid-cols-1 gap-8", items.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {items.map((item) => (
            <div key={item.label ?? item.value} className="text-center">
              <dt className={cn("font-heading text-4xl font-bold", dark ? "text-white" : "text-slate-900")}>
                {item.value}
              </dt>
              <dd className={cn("mt-2 text-sm", dark ? "text-white/60" : "text-slate-600")}>{item.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function LogoStrip({ block }: { block: Block }) {
  const items = block.items ?? [];
  if (!items.length) return null;
  return (
    <section className="border-y border-slate-200 bg-white px-4 py-10">
      <div className="container mx-auto max-w-6xl">
        {block.headline ? (
          <p className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {block.headline}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
          {items.map((item) => {
            const logo = resolveSectionImage(item.logo ?? item.image);
            return logo ? (
              <img
                key={item.title ?? logo}
                src={logo}
                alt={item.imageAlt ?? item.title ?? ""}
                loading="lazy"
                className="h-8 w-auto opacity-70"
              />
            ) : (
              <span key={item.title} className="font-heading text-lg font-semibold text-slate-400">
                {item.title}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Testimonial({ block }: { block: Block }) {
  const items = block.items?.length ? block.items : block.body ? [{ quote: block.body } as BlockItem] : [];
  if (!items.length) return null;
  return (
    <Wrap className="bg-slate-50">
      {block.headline ? (
        <Headline block={block} className="mb-10 text-center text-3xl text-slate-900" />
      ) : null}
      <div className={cn("grid gap-6", items.length > 1 ? "md:grid-cols-2" : "max-w-3xl mx-auto")}>
        {items.map((item, i) => (
          <figure key={i} className="rounded-[10px] border border-slate-200 bg-white p-6">
            <Quote className="h-6 w-6" style={{ color: ACCENT }} />
            <blockquote className="mt-4 text-lg leading-relaxed text-slate-800">{item.quote ?? item.body}</blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              {resolveSectionImage(item.image) ? (
                <img
                  src={resolveSectionImage(item.image)!}
                  alt={item.imageAlt ?? item.title ?? ""}
                  className="h-10 w-10 rounded-[50%] object-cover"
                />
              ) : null}
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                {item.role ? <p className="text-sm text-slate-500">{item.role}</p> : null}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </Wrap>
  );
}

function DualCta({ block }: { block: Block }) {
  const panels = block.panels ?? [];
  return (
    <section className="relative overflow-hidden bg-[#262626] px-4 py-16 md:py-24">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-[50%] bg-[#7C3AED]/10 blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 h-[500px] w-[500px] rounded-[50%] bg-[#0052FF]/10 blur-[120px]" />
      </div>
      <div className="container relative z-10 mx-auto max-w-4xl space-y-6 text-center">
        {block.eyebrow ? (
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/60 md:text-[12px]">{block.eyebrow}</p>
        ) : null}
        {block.headline ? (
          <h2 className="font-heading text-[28px] leading-[1.1] text-white md:text-[36px] lg:text-[44px]">
            {block.headline}
          </h2>
        ) : null}
        {block.subhead ? (
          <p className="mx-auto max-w-2xl text-[16px] leading-relaxed text-white/85 md:text-[18px]">{block.subhead}</p>
        ) : null}
        {panels.length ? (
          <div className="flex flex-col justify-center gap-4 pt-4 sm:flex-row">
            {panels.map((panel) => (
              <div key={panel.label} className="flex flex-col items-center gap-2">
                {panel.headline ? (
                  <p className="font-heading text-lg text-white">{panel.headline}</p>
                ) : null}
                {panel.cta ? <Cta cta={{ variant: "white", ...panel.cta }} size="lg" /> : null}
                <span className="text-[13px] text-white/60">{panel.label}</span>
                {panel.body ? <p className="max-w-xs text-sm text-white/70">{panel.body}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex justify-center pt-4">
            <Ctas ctas={block.ctas} size="lg" center />
          </div>
        )}
      </div>
    </section>
  );
}

function CtaBand({ block }: { block: Block }) {
  return (
    <section className="bg-[#12294D] px-4 py-16 md:py-20">
      <div className="container mx-auto max-w-4xl space-y-5 text-center">
        {block.eyebrow ? (
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">{block.eyebrow}</p>
        ) : null}
        {block.headline ? (
          <h2 className="font-heading text-[28px] leading-[1.1] text-white md:text-[38px]">{block.headline}</h2>
        ) : null}
        {block.subhead ? <p className="text-white/80 md:text-lg">{block.subhead}</p> : null}
        <div className="flex justify-center pt-2">
          <Ctas ctas={block.ctas} size="lg" center />
        </div>
        {block.note ? <p className="text-sm text-white/60">{block.note}</p> : null}
      </div>
    </section>
  );
}

function Collection({ block }: { block: Block }) {
  const items = block.items ?? [];
  if (!items.length) return null;
  return (
    <Wrap className="bg-white">
      {block.headline ? (
        <div className="mb-10 max-w-3xl">
          <Eyebrow>{block.eyebrow}</Eyebrow>
          <Headline block={block} className="text-3xl text-slate-900 lg:text-[38px]" />
          {block.subhead ? <p className="mt-4 text-lg text-slate-600">{block.subhead}</p> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const image = resolveSectionImage(item.image);
          const card = (
            <div className="flex h-full flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white">
              {image ? <img src={image} alt={item.imageAlt ?? ""} loading="lazy" className="h-40 w-full object-cover" /> : null}
              <div className="flex flex-1 flex-col gap-2 p-5">
                {item.eyebrow ? (
                  <span className="w-fit rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    {item.eyebrow}
                  </span>
                ) : null}
                <h3 className="font-heading text-lg font-semibold text-slate-900">{item.title}</h3>
                {item.body ? <p className="text-sm leading-relaxed text-slate-600">{item.body}</p> : null}
              </div>
            </div>
          );
          return item.href ? (
            <a key={item.title ?? i} href={item.href} className="block transition-transform hover:-translate-y-0.5">
              {card}
            </a>
          ) : (
            <div key={item.title ?? i}>{card}</div>
          );
        })}
      </div>
    </Wrap>
  );
}

function RichText({ block }: { block: Block }) {
  const html = block.html
    ? sanitizeHtml(block.html)
    : block.markdown || block.body
      ? null
      : null;
  return (
    <Wrap className="bg-white">
      <div className="mx-auto max-w-3xl">
        {block.headline ? <Headline block={block} className="mb-6 text-3xl text-slate-900" /> : null}
        {html ? (
          <div
            className="prose prose-slate max-w-none prose-a:text-[#1a8ff1]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="space-y-4 text-base leading-relaxed text-slate-700">
            {(block.markdown ?? block.body ?? "")
              .split(/\n{2,}/)
              .filter(Boolean)
              .map((para, i) => (
                <p key={i}>{para}</p>
              ))}
          </div>
        )}
      </div>
    </Wrap>
  );
}

function Faq({ block }: { block: Block }) {
  const items = block.items ?? [];
  const categories = useMemo(() => {
    const set: string[] = [];
    for (const item of items) {
      const c = item.category?.trim();
      if (c && !set.includes(c)) set.push(c);
    }
    return set;
  }, [items]);
  const [active, setActive] = useState<string>("all");
  const [open, setOpen] = useState<number | null>(0);
  const [showAll, setShowAll] = useState(false);

  if (!items.length) return null;
  const filtered = active === "all" ? items : items.filter((i) => i.category === active);
  const visible = showAll ? filtered : filtered.slice(0, 6);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items
      .filter((i) => i.question && i.answer)
      .map((i) => ({
        "@type": "Question",
        name: i.question,
        acceptedAnswer: { "@type": "Answer", text: i.answer },
      })),
  };

  return (
    <section className="bg-gradient-to-b from-[#EFF4FB] to-[#E4ECF7] px-4 py-16 sm:py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="container mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <HelpCircle className="mx-auto mb-3 h-7 w-7" style={{ color: ACCENT }} />
          <h2 className="font-heading text-3xl text-slate-900 lg:text-[38px]">
            {block.headline ?? "Frequently asked questions"}
          </h2>
          {block.subhead ? <p className="mt-3 text-slate-600">{block.subhead}</p> : null}
        </div>

        {categories.length > 1 ? (
          <div className="mb-6 flex flex-wrap justify-center gap-2">
            {["all", ...categories].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setActive(cat);
                  setOpen(0);
                  setShowAll(false);
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                  active === cat
                    ? "bg-[#1a8ff1] text-white"
                    : "border border-slate-300 bg-white text-slate-600 hover:border-[#1a8ff1]",
                )}
              >
                {cat === "all" ? "All" : cat}
              </button>
            ))}
          </div>
        ) : null}

        <div className="space-y-3">
          {visible.map((item, i) => (
            <div key={item.question ?? i} className="overflow-hidden rounded-[10px] border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-heading text-base font-semibold text-slate-900">{item.question}</span>
                <ChevronDown
                  className={cn("h-5 w-5 shrink-0 text-slate-400 transition-transform", open === i && "rotate-180")}
                />
              </button>
              {open === i && item.answer ? (
                <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{item.answer}</p>
              ) : null}
            </div>
          ))}
        </div>

        {filtered.length > 6 && !showAll ? (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:border-[#1a8ff1]"
            >
              Show all questions
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ────────────────────────── dispatcher ────────────────────────── */

export function MarketingSection({ block }: { block: Block }) {
  switch (block.type) {
    case "hero":
      return <HeroSection block={block} />;
    case "pillar_band":
    case "problem":
      return <PillarBand block={block} />;
    case "feature_split":
      return <FeatureSplit block={block} />;
    case "feature_grid":
    case "product_grid":
    case "platform_grid":
    case "pricing":
      return <FeatureGrid block={block} />;
    case "stat_band":
      return <StatBand block={block} />;
    case "logo_strip":
    case "logos":
      return <LogoStrip block={block} />;
    case "testimonial":
      return <Testimonial block={block} />;
    case "dual_cta":
      return <DualCta block={block} />;
    case "cta":
      return <CtaBand block={block} />;
    case "collection":
      return <Collection block={block} />;
    case "faq":
      return <Faq block={block} />;
    case "rich_text":
      return <RichText block={block} />;
    default:
      return <RichText block={block} />;
  }
}

export function MarketingSections({ blocks }: { blocks: Block[] }) {
  if (!blocks?.length) return null;
  return (
    <>
      {blocks.map((block, i) => (
        <MarketingSection key={`${block.type}-${i}`} block={block} />
      ))}
    </>
  );
}

/** Section types this renderer supports (used by the CMS coverage check). */
export const SUPPORTED_SECTION_TYPES = [
  "hero",
  "feature_grid",
  "feature_split",
  "pillar_band",
  "stat_band",
  "logo_strip",
  "faq",
  "testimonial",
  "dual_cta",
  "collection",
  "rich_text",
  "cta",
] as const;
