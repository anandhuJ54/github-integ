import { Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  Clock,
  Globe,
  Home,
  Mail,
  MapPin,
  Percent,
  Phone,
  ShieldCheck,
  Star,
  Utensils,
} from "lucide-react";
import { useOptionalRole } from "@v3/ui/lib/roles";
import { cn } from "@v3/ui/lib/utils";
import { hubPath, prettyTopic, servesIn } from "@v3/ui/lib/voce";
import { EntityAvatar, displayPhone } from "@v3/ui/components/public/visual";
import { ProfileExpertise } from "@v3/search/components/profile/profile-expertise";
import { ScoreExplainer } from "@v3/ui/components/public/score-explainer";
import { useRecordView } from "@v3/ui/lib/visitor-lists";
import {
  Card,
  ClaimButton,
  Chips,
  JsonLd,
  OfferingGrid,
  PublicFooter,
  RatingSummary,
  ReviewCard,
  Section,
  SocialLinks,
  Stars,
  UnclaimedBadge,
} from "@v3/search/components/profile/profile-parts";
import {
  AdvertiseHereUnit,
  ClaimConversionUnit,
  useUnclaimedAdUnits,
} from "@v3/search/components/profile/claim-conversion";
import { usePageViewPing } from "@v3/search/lib/monetization";
import {
  breadcrumbs,
  buildJsonLd,
  completeness,
  renderableSections,
  type ProfileBundle,
} from "@v3/search/lib/profile-render";

/* ------------------------------- pieces ------------------------------- */

function Breadcrumbs({ b }: { b: ProfileBundle }) {
  const crumbs = breadcrumbs(b);
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-[color:var(--color-ink-3)]">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex items-center gap-1.5">
            {c.url ? (
              <Link
                to={c.url}
                className="rounded-full px-2 py-1 transition-colors hover:bg-[color:var(--color-g-blue-soft)] hover:text-[color:var(--color-g-blue)]"
              >
                {c.name}
              </Link>
            ) : (
              <span
                className={cn(
                  "px-1 py-1",
                  i === crumbs.length - 1 && "font-medium text-[color:var(--color-ink-2)]",
                )}
              >
                {c.name}
              </span>
            )}
            {i < crumbs.length - 1 ? (
              <span aria-hidden className="text-[color:var(--color-hairline)]">
                ›
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function avatarKind(b: ProfileBundle): "professional" | "location" | "brand" {
  if (b.lane === "professional") return "professional";
  return b.lane === "brand" ? "brand" : "location";
}

function Hero({ b }: { b: ProfileBundle }) {
  const i = b.identity;
  const city = [i.city, i.state].filter(Boolean).join(", ");
  const rating = b.ratings.overall;
  const ratingValue = rating ? Number(rating.rating_value ?? 0) : null;
  const subtitle = [i.jobTitle ?? b.categoryLabel ?? b.config.entity_noun, b.parent?.name]
    .filter(Boolean)
    .join(" · ");
  const tel = displayPhone(i.phone);

  return (
    <header className="relative overflow-hidden border-b border-[color:var(--color-hairline)] bg-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-80 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(60% 100% at 20% 100%, var(--color-g-blue-soft) 0%, transparent 70%), radial-gradient(50% 100% at 85% 100%, var(--color-g-purple-soft) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-5 pt-4 sm:px-6">
        <Breadcrumbs b={b} />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 pb-8 pt-5 sm:px-6 sm:pb-10">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10">
          <div className="min-w-0">
            <div className="flex items-start gap-4 sm:gap-5">
              <EntityAvatar
                name={i.name}
                src={i.photo_url}
                kind={avatarKind(b)}
                size={88}
                eager
                className="sm:!h-28 sm:!w-28"
              />
              <div className="min-w-0 pt-1">
                <h1 className="text-[1.75rem] font-semibold leading-[1.1] tracking-tight text-ink sm:text-4xl">
                  {i.name}
                </h1>
                {subtitle ? (
                  <p className="mt-2 text-sm font-medium text-[color:var(--color-ink-2)] sm:text-base">
                    {subtitle}
                  </p>
                ) : null}
                {city ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[color:var(--color-ink-3)]">
                    <MapPin className="h-4 w-4 shrink-0" /> {city}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <UnclaimedBadge claimed={i.claimed} />
              {ratingValue !== null ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-hairline)] bg-white px-3 py-1 text-sm text-[color:var(--color-ink-2)]">
                  <Stars value={ratingValue} />
                  <span className="font-semibold tabular-nums text-ink">
                    {ratingValue.toFixed(2)}
                  </span>
                  <span className="text-[color:var(--color-ink-3)]">
                    ({(rating?.review_count ?? 0).toLocaleString()})
                  </span>
                </span>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <ClaimButton claimed={i.claimed} kind={heroKind(b)} slug={i.slug} size="lg" />
              {tel ? (
                <a
                  href={tel.href}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-[color:var(--color-hairline)] bg-white px-5 text-sm font-medium text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-g-blue)] hover:text-[color:var(--color-g-blue)]"
                >
                  <Phone className="h-4 w-4" /> {tel.text}
                </a>
              ) : null}
              {i.website_url ? (
                <a
                  href={i.website_url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-[color:var(--color-hairline)] bg-white px-5 text-sm font-medium text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-g-blue)] hover:text-[color:var(--color-g-blue)]"
                >
                  <Globe className="h-4 w-4" /> Website
                </a>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-3xl border border-[color:var(--color-hairline)] bg-white/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur lg:flex-col lg:gap-2 lg:p-6">
            <div className="grid h-[104px] w-[104px] shrink-0 place-items-center rounded-full border-8 border-[color:var(--color-surface-3)] bg-white text-center">
              <div>
                <div className="text-sm font-semibold leading-tight text-ink">Score pending</div>
                <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-ink-3)]">
                  Computing
                </div>
              </div>
            </div>
            <div className="lg:text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
                Search Rank Score
              </div>
              <p className="mt-1 max-w-[16rem] text-xs leading-snug text-[color:var(--color-ink-3)]">
                Proof signals are live. The overall score is not calculated yet.
              </p>
              <ScoreExplainer className="mt-1.5" label="How the score works" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/** Mobile conversion anchor: the claim CTA follows the scroll. */
function StickyClaimBar({ b }: { b: ProfileBundle }) {
  if (b.identity.claimed) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--color-hairline)] bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(32,33,36,0.5)] backdrop-blur sm:hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <p className="min-w-0 text-xs font-medium leading-snug text-[color:var(--color-ink-2)]">
          Is this you?{" "}
          <span className="block text-[color:var(--color-ink-3)]">Claim it to control this page.</span>
        </p>
        <ClaimButton claimed={false} kind={heroKind(b)} slug={b.identity.slug} label="Claim" />
      </div>
    </div>
  );
}

function heroKind(b: ProfileBundle): "professional" | "office" | "company" {
  if (b.lane === "professional") return "professional";
  return b.lane === "brand" ? "company" : "office";
}

function ClaimBanner({ b }: { b: ProfileBundle }) {
  if (b.identity.claimed) return null;
  return (
    <Card className="border-amber-200 bg-amber-50/60">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Is this you? Claim this profile</h2>
          <p className="mt-1 text-sm text-[color:var(--color-ink-2)]">
            Verify ownership to control the information, reply to reviews, and improve how this
            page ranks in search.
          </p>
        </div>
        <ClaimButton claimed={false} kind={heroKind(b)} slug={b.identity.slug} />
      </div>
    </Card>
  );
}

function CtaCard({
  title,
  body,
  label,
  href,
}: {
  title: string;
  body: string;
  label: string;
  href: string;
}) {
  return (
    <Card className="border-[color:var(--color-g-blue)]/30 bg-[color:var(--color-g-blue)]/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm text-[color:var(--color-ink-2)]">{body}</p>
        </div>
        <a
          href={href}
          target={href.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer nofollow"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[color:var(--color-g-blue)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          {label}
        </a>
      </div>
    </Card>
  );
}

function ctaHref(b: ProfileBundle) {
  return (
    b.ctaUrl ?? displayPhone(b.identity.phone)?.href ?? b.identity.website_url ?? "#contact"
  );
}

function MenuList({ b }: { b: ProfileBundle }) {
  const bySection = new Map<string, typeof b.menu>();
  for (const item of b.menu) {
    const k = item.section ?? "Menu";
    bySection.set(k, [...(bySection.get(k) ?? []), item]);
  }
  return (
    <div className="space-y-5">
      {[...bySection.entries()].map(([name, items]) => (
        <Card key={name} className="px-5 py-6 sm:px-8 sm:py-8">
          <div className="mb-6 text-center">
            <span className="inline-flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.28em] text-[color:var(--color-ink-2)]">
              <Utensils className="h-3.5 w-3.5" /> {name}
            </span>
            <div
              aria-hidden
              className="mx-auto mt-3 h-px w-24 bg-[color:var(--color-hairline)]"
            />
          </div>
          <ul className="space-y-5">
            {items.map((it, idx) => (
              <li key={`${it.name}-${idx}`} className="flex gap-4">
                {it.image ? (
                  <img
                    src={it.image}
                    alt={it.name}
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-2xl object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-[0.95rem] font-semibold text-ink">
                      {it.name}
                    </span>
                    <span
                      aria-hidden
                      className="mb-1 min-w-4 flex-1 border-b border-dotted border-[color:var(--color-hairline)]"
                    />
                    {it.price ? (
                      <span className="shrink-0 text-[0.95rem] font-semibold tabular-nums text-[color:var(--color-ink-2)]">
                        {it.price}
                      </span>
                    ) : null}
                  </div>
                  {it.description ? (
                    <p className="mt-1 text-sm leading-relaxed text-[color:var(--color-ink-3)]">
                      {it.description}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function HoursTable({ b }: { b: ProfileBundle }) {
  return (
    <Card>
      {b.hours.length > 0 ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {b.hours.map((h, i) => (
            <li key={`${h.day}-${i}`} className="flex items-center justify-between py-2">
              <span className="font-medium text-ink">{h.day}</span>
              <span className="tabular-nums text-[color:var(--color-ink-2)]">
                {h.opens && h.closes ? `${h.opens} – ${h.closes}` : "Closed"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1.5 text-sm text-[color:var(--color-ink-2)]">
          {b.hoursNotes.map((line, i) => (
            <li key={`${line}-${i}`}>{line}</li>
          ))}
        </ul>
      )}
      {b.timezone ? (
        <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">Time zone: {b.timezone}</p>
      ) : null}
    </Card>
  );
}

/** Team members are surfaced here only — they never get their own page. */
function TeamGrid({ team }: { team: ProfileBundle["team"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {team.map((m) => (
        <Card key={m.id} className="flex items-center gap-3 p-4">
          {m.photo_url ? (
            <img
              src={m.photo_url}
              alt={m.name}
              loading="lazy"
              className="h-11 w-11 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-[color:var(--color-ink-2)]">
              {m.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{m.name}</div>
            {m.role ? (
              <div className="truncate text-xs text-[color:var(--color-ink-3)]">{m.role}</div>
            ) : null}
            {m.license ? (
              <div className="truncate text-xs text-[color:var(--color-ink-3)]">
                License {m.license}
              </div>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Listings({ b }: { b: ProfileBundle }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {b.listings.map((l, i) => (
        <Card key={`${l.title}-${i}`} className="p-0 overflow-hidden">
          {l.image ? (
            <img src={l.image} alt={l.title} loading="lazy" className="h-40 w-full object-cover" />
          ) : null}
          <div className="p-4">
            <div className="text-sm font-semibold text-ink">{l.title}</div>
            {l.price ? (
              <div className="mt-1 text-sm font-medium text-[color:var(--color-g-blue)]">
                {l.price}
              </div>
            ) : null}
            {l.address ? (
              <div className="mt-1 text-xs text-[color:var(--color-ink-3)]">{l.address}</div>
            ) : null}
            {l.detail ? (
              <p className="mt-2 text-sm text-[color:var(--color-ink-2)]">{l.detail}</p>
            ) : null}
            {l.url ? (
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-3 inline-block text-sm font-medium text-[color:var(--color-g-blue)]"
              >
                View listing
              </a>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

function PeopleGrid({ people }: { people: ProfileBundle["staff"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {people.map((p) => {
        const inner = (
          <Card className="flex items-center gap-3 p-4">
            {p.photo_url ? (
              <img
                src={p.photo_url}
                alt={p.name}
                loading="lazy"
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-[color:var(--color-ink-2)]">
                {p.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{p.name}</div>
              {p.subtitle ? (
                <div className="truncate text-xs text-[color:var(--color-ink-3)]">{p.subtitle}</div>
              ) : null}
            </div>
          </Card>
        );
        return p.slug ? (
          <Link key={p.id} to="/p/$slug" params={{ slug: p.slug }} className="block">
            {inner}
          </Link>
        ) : (
          <div key={p.id}>{inner}</div>
        );
      })}
    </div>
  );
}

function OrgGrid({ orgs }: { orgs: ProfileBundle["directory"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {orgs.map((o) => {
        const inner = (
          <Card className="flex items-center gap-3 p-4">
            {o.logo_url ? (
              <img
                src={o.logo_url}
                alt={o.name}
                loading="lazy"
                className="h-11 w-11 rounded-full border border-slate-200 object-contain"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-[color:var(--color-ink-2)]">
                {o.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{o.name}</div>
              {o.subtitle ? (
                <div className="truncate text-xs text-[color:var(--color-ink-3)]">{o.subtitle}</div>
              ) : null}
            </div>
          </Card>
        );
        return o.slug ? (
          <Link key={o.id} to="/o/$slug" params={{ slug: o.slug }} className="block">
            {inner}
          </Link>
        ) : (
          <div key={o.id}>{inner}</div>
        );
      })}
    </div>
  );
}

function MapEmbed({ b }: { b: ProfileBundle }) {
  const { latitude, longitude, name } = b.identity;
  const q = `${latitude},${longitude}`;
  return (
    <Card className="overflow-hidden p-0">
      <iframe
        title={`Map of ${name}`}
        loading="lazy"
        className="h-72 w-full border-0"
        src={`https://maps.google.com/maps?q=${q}&z=14&output=embed`}
      />
    </Card>
  );
}

/* ------------------------------ renderer ------------------------------ */

export function CategoryProfile({ bundle }: { bundle: ProfileBundle }) {
  const b = bundle;
  const role = useOptionalRole();
  const comp = completeness(b);
  const sections = renderableSections(b);
  const adUnits = useUnclaimedAdUnits(b);
  useRecordView({
    id: `${b.kind}:${b.identity.slug}`,
    entity_id: b.identity.id,
    entity_type: (b.kind === "c" ? "brand" : b.kind === "o" ? "location" : "professional") as "professional",
    slug: b.identity.slug,
    name: b.identity.name,
    title: b.identity.jobTitle ?? b.identity.headline,
    city: b.identity.city,
    state: b.identity.state,
    gcid: b.gcid,
    photo_url: b.identity.photo_url,
    rating: b.ratings.overall?.rating_value ?? null,
    review_count: b.ratings.overall?.review_count ?? null,
    rank_score: null,
    categoryLabel: b.categoryLabel,
  });
  usePageViewPing({
    gcid: b.gcid,
    zip: b.identity.zip,
    claimCta: !b.identity.claimed,
  });
  const cfg = b.config;

  const node = (section: string) => {
    switch (section) {
      case "claim_cta":
        // The live claim-conversion ad unit replaces the static banner when one serves.
        if (adUnits.some((u) => u.creative?.variant === "claim")) return null;
        return <ClaimBanner key={section} b={b} />;
      case "about":
        return (
          <Section key={section} id="about" title={`About ${b.identity.name}`}>
            <Card>
              {b.about ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--color-ink-2)]">
                  {b.about}
                </p>
              ) : null}
              {b.facts.length > 0 ? (
                <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {b.facts.map((f) => (
                    <div key={f.label}>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                        {f.label}
                      </dt>
                      <dd className="mt-0.5 text-sm text-ink">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Card>
          </Section>
        );
      case "specialties":
        return (
          <Section key={section} id="specialties" title="Specialties">
            <Chips items={b.specialties} />
          </Section>
        );
      case "credentials":
        return (
          <Section key={section} id="credentials" title={cfg.credential_label}>
            <div className="grid gap-3 sm:grid-cols-2">
              {b.credentials.map((c) => (
                <Card key={c.id} className="p-4">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-[color:var(--color-g-blue)]" />
                    <div>
                      <div className="text-sm font-medium text-ink">{c.name ?? "Credential"}</div>
                      <div className="mt-0.5 text-xs text-[color:var(--color-ink-3)]">
                        {[
                          c.identifier ? `${cfg.credential_id_label} ${c.identifier}` : null,
                          c.issuing_state,
                          c.issuing_org,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
              {b.credentials.length === 0 && b.identity.licenseNumber ? (
                <Card className="p-4">
                  <div className="text-sm font-medium text-ink">
                    {cfg.credential_id_label} {b.identity.licenseNumber}
                  </div>
                  {b.identity.licenseState ? (
                    <div className="mt-0.5 text-xs text-[color:var(--color-ink-3)]">
                      {b.identity.licenseState}
                    </div>
                  ) : null}
                </Card>
              ) : null}
            </div>
          </Section>
        );
      case "services":
      case "coverage_products":
      case "loan_products":
        return (
          <Section
            key={section}
            id="services"
            eyebrow={section === "loan_products" ? "Programs offered" : "What they offer"}
            title={cfg.service_label}
          >
            <OfferingGrid
              items={b.services}
              icon={
                section === "loan_products" ? (
                  <Percent className="h-4 w-4" />
                ) : section === "coverage_products" ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : b.gcid?.includes("real_estate") ? (
                  <Home className="h-4 w-4" />
                ) : undefined
              }
            />
          </Section>
        );
      case "menu":
        return (
          <Section key={section} id="menu" title="Menu">
            <MenuList b={b} />
          </Section>
        );
      case "hours":
        return (
          <Section key={section} id="hours" title="Hours" eyebrow="Open times">
            <HoursTable b={b} />
          </Section>
        );
      case "listings":
        return (
          <Section key={section} id="listings" title="Listings">
            <Listings b={b} />
          </Section>
        );
      case "staff":
        return (
          <Section key={section} id="staff" title="Team">
            <PeopleGrid people={b.staff} />
          </Section>
        );
      case "team":
        return (
          <Section key={section} id="team" title="Team" eyebrow="My network">
            <TeamGrid team={b.team} />
          </Section>
        );
      case "languages":
        return (
          <Section key={section} id="languages" title="Languages spoken">
            <Chips items={b.languages} />
          </Section>
        );
      case "agents_directory":
        return (
          <Section key={section} id="agents" title={`${cfg.entity_noun} directory`}>
            <PeopleGrid people={b.staff} />
          </Section>
        );
      case "directory":
        return (
          <Section key={section} id="directory" title="Locations">
            <OrgGrid orgs={b.directory} />
          </Section>
        );
      case "service_areas":
        return (
          <Section key={section} id="service-areas" title="Areas served">
            <Chips items={b.serviceAreas} />
          </Section>
        );
      case "map":
        return (
          <Section key={section} id="map" title="Location">
            <MapEmbed b={b} />
          </Section>
        );
      case "gallery":
        return (
          <Section key={section} id="gallery" title="Photos">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {b.gallery.slice(0, 12).map((g, i) => (
                <img
                  key={`${g.url}-${i}`}
                  src={g.url}
                  alt={g.title ?? b.identity.name}
                  loading="lazy"
                  className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
                />
              ))}
            </div>
          </Section>
        );
      case "aggregate_reputation":
        return (
          <Section key={section} id="reputation" title="Reputation">
            <Card>
              <RatingSummary overall={b.ratings.overall} bySource={b.ratings.bySource} />
            </Card>
          </Section>
        );
      case "reviews":
        return (
          <Section key={section} id="reviews" title="Reviews" eyebrow="Verified feedback">
            {sections.includes("aggregate_reputation") ? null : (
              <Card className="mb-4">
                <RatingSummary overall={b.ratings.overall} bySource={b.ratings.bySource} />
              </Card>
            )}
            {b.reviews.length > 0 ? (
              <div className="space-y-3">
                {b.reviews.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-[color:var(--color-ink-3)]">
                Rating and review counts are verified. Individual review text is coming soon.
              </p>
            )}
          </Section>
        );
      case "content":
        return (
          <Section key={section} id="content" title="Articles & insights">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {b.voce.map((a) => {
                const featured = servesIn(a, "profile");
                return (
                  <Card
                    key={a.id}
                    className={cn(
                      "p-4",
                      featured && "border-[color:var(--color-g-blue)]/40 bg-blue-50/40",
                    )}
                  >
                    {featured ? (
                      <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-blue)]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--color-g-blue)]">
                        Featured
                      </span>
                    ) : null}
                    <div className="text-sm font-semibold text-ink">{a.title}</div>
                    {a.body_excerpt ? (
                      <p className="mt-1 text-sm text-[color:var(--color-ink-3)]">
                        {a.body_excerpt}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.topic ? (
                        <a
                          href={hubPath(b.gcid ?? "", a.topic)}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-[color:var(--color-ink-2)]"
                        >
                          {prettyTopic(a.topic)}
                        </a>
                      ) : null}
                      {a.knows_about.slice(0, 3).map((k) => (
                        <span
                          key={k}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-[color:var(--color-ink-3)]"
                        >
                          {k.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </Card>
                );
              })}
              {b.content.map((a) => (
                <Card key={a.id} className="p-0 overflow-hidden">
                  {a.cover_image_url ? (
                    <img
                      src={a.cover_image_url}
                      alt={a.title ?? ""}
                      loading="lazy"
                      className="h-36 w-full object-cover"
                    />
                  ) : null}
                  <div className="p-4">
                    <div className="text-sm font-semibold text-ink">{a.title}</div>
                    {a.excerpt ? (
                      <p className="mt-1 text-sm text-[color:var(--color-ink-3)]">{a.excerpt}</p>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          </Section>
        );
      case "social":
        return (
          <Section key={section} id="social" title="Connected profiles">
            <SocialLinks socials={b.socials} />
          </Section>
        );
      case "quote_cta":
        return (
          <CtaCard
            key={section}
            title={`${cfg.cta_label} from ${b.identity.name}`}
            body="Talk through your needs and get a personalized answer."
            label={cfg.cta_label}
            href={ctaHref(b)}
          />
        );
      case "rates_prequalify_cta":
        return (
          <CtaCard
            key={section}
            title="Get pre-qualified"
            body="Start a pre-qualification and review your options. Not a commitment to lend."
            label={cfg.cta_label}
            href={ctaHref(b)}
          />
        );
      case "reservation_cta":
        return (
          <CtaCard
            key={section}
            title="Book a table"
            body="Reserve a time that works for you."
            label="Reserve"
            href={ctaHref(b)}
          />
        );
      case "order_cta":
        return (
          <CtaCard
            key={section}
            title="Order online"
            body="Pickup and delivery options."
            label="Order now"
            href={ctaHref(b)}
          />
        );
      case "contact":
        return (
          <Section key={section} id="contact" title="Contact">
            <Card>
              <ul className="grid gap-3 sm:grid-cols-2">
                {displayPhone(b.identity.phone) ? (
                  <li>
                    <a
                      href={displayPhone(b.identity.phone)!.href}
                      className="flex items-center gap-2 text-sm text-[color:var(--color-ink-2)]"
                    >
                      <Phone className="h-4 w-4" /> {displayPhone(b.identity.phone)!.text}
                    </a>
                  </li>
                ) : null}
                {b.identity.email ? (
                  <li>
                    <a
                      href={`mailto:${b.identity.email}`}
                      className="flex items-center gap-2 text-sm text-[color:var(--color-ink-2)]"
                    >
                      <Mail className="h-4 w-4" /> {b.identity.email}
                    </a>
                  </li>
                ) : null}
                {b.identity.website_url ? (
                  <li>
                    <a
                      href={b.identity.website_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="flex items-center gap-2 text-sm text-[color:var(--color-ink-2)]"
                    >
                      <Globe className="h-4 w-4" /> Website
                    </a>
                  </li>
                ) : null}
                {b.identity.city ? (
                  <li className="flex items-center gap-2 text-sm text-[color:var(--color-ink-2)]">
                    <MapPin className="h-4 w-4" />
                    {[b.identity.street, b.identity.city, b.identity.state, b.identity.zip]
                      .filter(Boolean)
                      .join(", ")}
                  </li>
                ) : null}
              </ul>
              {b.socials.length > 0 && !sections.includes("social") ? (
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <SocialLinks socials={b.socials} />
                </div>
              ) : null}
            </Card>
          </Section>
        );
      default:
        return null;
    }
  };

  return (
    <div className="consumer-search min-h-screen bg-[color:var(--color-surface-2)]">
      <JsonLd data={buildJsonLd(b)} />
      {sections.includes("hero") ? <Hero b={b} /> : null}

      {role?.isSuperAdmin && !comp.indexable ? (
        <div className="mx-auto mt-4 max-w-6xl px-5 sm:px-6">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
            Below index floor — {comp.pct}% of required sections vs {comp.floor}% floor. Missing:{" "}
            {comp.missing.join(", ") || "—"} (page is noindex,follow)
          </div>
        </div>
      ) : null}

      {!b.identity.claimed ? (
        <div className="mt-6">
          <ClaimConversionUnit b={b} units={adUnits} />
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl space-y-12 px-5 pb-24 pt-8 sm:px-6 sm:pb-14 sm:pt-10">
        <ProfileExpertise b={b} />
        {sections.filter((s) => s !== "hero").map((s) => node(s))}
        {!b.identity.claimed ? <AdvertiseHereUnit units={adUnits} /> : null}
      </main>
      <PublicFooter disclaimer={b.disclaimer} />
      <StickyClaimBar b={b} />
    </div>
  );
}

/** Route-level head() metadata built from the same bundle. */
export function profileHead(b: ProfileBundle) {
  const i = b.identity;
  const city = [i.city, i.state].filter(Boolean).join(", ");
  const title = `${i.name} — ${i.jobTitle ?? b.categoryLabel ?? b.config.entity_noun}${
    city ? ` in ${city}` : ""
  }`.slice(0, 70);
  const rating = b.ratings.overall;
  const desc = `${i.name}${b.parent ? ` · ${b.parent.name}` : ""}${
    rating
      ? ` · ${Number(rating.rating_value ?? 0).toFixed(2)}★ from ${(
          rating.review_count ?? 0
        ).toLocaleString()} reviews`
      : ""
  }.${b.services.length ? ` ${b.config.service_label}: ${b.services.slice(0, 4).join(", ")}.` : ""}`
    .slice(0, 158);
  const comp = completeness(b);
  const meta: Record<string, string>[] = [
    { title },
    { name: "description", content: desc },
    { property: "og:title", content: title },
    { property: "og:description", content: desc },
    { property: "og:url", content: b.canonical },
    { property: "og:type", content: b.lane === "professional" ? "profile" : "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ];
  if (!comp.indexable) meta.push({ name: "robots", content: "noindex,follow" });
  const img = i.cover_url ?? i.photo_url;
  if (img?.startsWith("https://")) {
    meta.push({ property: "og:image", content: img });
    meta.push({ name: "twitter:image", content: img });
  }
  return { meta, links: [{ rel: "canonical", href: b.canonical }] };
}

export { Clock, Star, BadgeCheck };
