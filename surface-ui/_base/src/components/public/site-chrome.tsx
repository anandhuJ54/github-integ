import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Menu, Search, X } from "lucide-react";
import { BrandWordmark } from "@v3/ui/components/brand/logo";
import { SavedSheet } from "@v3/ui/components/public/visitor-lists";
import type { FooterNavData, HeaderNavData, NavLink as NavLinkItem } from "@v3/ui/lib/nav-menus";

type BusinessColumn = { title: string; links: NavLinkItem[] };

const BUSINESS_COLUMNS: BusinessColumn[] = [
  {
    title: "Platform",
    links: [
      { label: "Enterprise XMP", href: "/enterprise-xmp", blurb: "Manage every experience at brand scale" },
      { label: "Search Rank Platform", href: "/search-rank-platform", blurb: "Let Nora improve your search presence" },
      { label: "VOCE.com", href: "/voce", blurb: "Turn expertise into a complete content engine" },
      { label: "Brandiva.ai", href: "/brandiva", blurb: "See category-aware competitive intelligence" },
    ],
  },
  {
    title: "Products",
    links: [
      { label: "Listings", href: "/listings", blurb: "Keep business details accurate everywhere" },
      { label: "Reviews", href: "/reviews", blurb: "Turn customer feedback into trusted evidence" },
      { label: "Campaigns", href: "/campaigns", blurb: "Automate timely customer outreach" },
      { label: "Social", href: "/social", blurb: "Plan and publish across every channel" },
      { label: "Insights", href: "/insights", blurb: "Understand visibility, traffic, and growth" },
      { label: "Content", href: "/content", blurb: "Create useful answers customers can find" },
      { label: "Network", href: "/network", blurb: "Expand discovery across trusted surfaces" },
      { label: "Multi-Post", href: "/multi-post", blurb: "Publish once and distribute everywhere" },
      { label: "Nora", href: "/nora", blurb: "Keep your presence working around the clock" },
      { label: "Convert Agents", href: "/convert-agents", blurb: "Turn discovery into qualified conversations" },
      { label: "Competitor Analytics", href: "/competitor-analytics", blurb: "Find and close your visibility gaps" },
      { label: "Websites", href: "/website-marketing", blurb: "Build a faster, search-ready web presence" },
      { label: "VOCE Articles", href: "/voce-articles", blurb: "Publish citable, structured expertise" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Search Ranking", href: "/search-ranking", blurb: "Improve how customers discover you" },
      { label: "AI Visibility", href: "/ai-visibility", blurb: "Become a trusted answer in AI search" },
      { label: "Customer Stories", href: "/customer-stories", blurb: "See how leading teams grow" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Contact us", href: "/contact-us", blurb: "Talk with the Experience.com team" },
      { label: "Watch a demo", href: "/demo", blurb: "See the platform in action" },
      { label: "Request a Demo", href: "/request-a-demo", blurb: "Get a guided enterprise walkthrough" },
      { label: "Trust Center", href: "/trust", blurb: "Review privacy, security, and compliance" },
    ],
  },
];

const FOOTER_COLUMNS: FooterNavData["columns"] = [
  {
    title: "Explore",
    links: [
      { label: "Find Professionals", href: "/find?type=professional" },
      { label: "Find Businesses", href: "/find?type=location" },
      { label: "Guides & Q&A", href: "/guides" },
      { label: "Topics", href: "/topics" },
    ],
  },
  { title: "Platform", links: BUSINESS_COLUMNS[0]?.links ?? [] },
  { title: "Products", links: BUSINESS_COLUMNS[1]?.links ?? [] },
  { title: "Solutions", links: BUSINESS_COLUMNS[2]?.links ?? [] },
  { title: "Company", links: BUSINESS_COLUMNS[3]?.links ?? [] },
  {
    title: "Trust",
    links: [
      { label: "Trust Center", href: "/trust" },
      { label: "Terms of Use", href: "/trust/terms-of-use" },
      { label: "Privacy Notice", href: "/trust/privacy-notice" },
      { label: "Cookie Policy", href: "/trust/cookie-policy" },
      { label: "HIPAA Statement", href: "/trust/hipaa-statement" },
      { label: "Accessibility Statement", href: "/trust/accessibility-statement" },
      { label: "Responsible Disclosure", href: "/trust/responsible-disclosure-policy" },
      { label: "Fulfillment Policy", href: "/trust/fulfillment-policy" },
    ],
  },
];

function BusinessMenu({ mobile = false, close }: { mobile?: boolean; close?: () => void }) {
  if (mobile) {
    return (
      <div className="grid gap-7 py-5 sm:grid-cols-2">
        {BUSINESS_COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">{column.title}</p>
            <div className="space-y-1">
              {column.links.map((item) => (
                <a key={item.href} href={item.href} onClick={close} className="block rounded-lg px-2 py-2 hover:bg-muted">
                  <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{item.blurb}</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-[0.85fr_1.55fr_0.85fr_0.85fr] gap-6 rounded-xl border border-border bg-background p-7 shadow-2xl xl:gap-8 xl:p-8">
      {BUSINESS_COLUMNS.map((column) => (
        <div key={column.title}>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">{column.title}</p>
          <div className="space-y-1">
            {column.links.map((item) => (
              <a key={item.href} href={item.href} className="block rounded-lg px-2 py-2 transition-colors hover:bg-muted">
                <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{item.blurb}</span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Consumer-facing primary links (search-first site). */
const CONSUMER_LINKS: NavLinkItem[] = [
  { label: "Find Professionals", href: "/find" },
  { label: "Find Businesses", href: "/find" },
  { label: "Guides & Q&A", href: "/guides" },
  { label: "Topics", href: "/topics" },
];

export function SiteHeader({ data: _data }: { data?: HeaderNavData }) {
  const [businessOpen, setBusinessOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setBusinessOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur">
      <div ref={menuRef} className="relative mx-auto flex h-16 w-full max-w-[1320px] items-center px-5 sm:px-6" onMouseLeave={() => setBusinessOpen(false)}>
        <Link to="/" className="shrink-0" aria-label="Experience.com home"><BrandWordmark size={23} /></Link>
        <nav className="ml-7 hidden items-center gap-5 lg:flex" aria-label="Explore navigation">
          {CONSUMER_LINKS.map((link) => (
            <a key={link.label} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground">{link.label}</a>
          ))}
        </nav>
        <nav className="ml-auto hidden items-center gap-6 lg:flex" aria-label="Main navigation">
          <div className="group" onMouseEnter={() => setBusinessOpen(true)}>
            <button type="button" aria-expanded={businessOpen} onClick={() => setBusinessOpen((open) => !open)} className="inline-flex items-center gap-1 py-5 text-sm font-semibold text-foreground">
              For Business <ChevronDown className={`h-4 w-4 transition-transform ${businessOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          <SavedSheet />
          <a href="/auth" className="text-sm font-medium text-muted-foreground hover:text-foreground">Sign In</a>
          <a href="/nora" className="inline-flex h-10 items-center rounded-md bg-amber-500 px-5 text-sm font-semibold text-slate-950 hover:bg-amber-400">Get Started</a>
        </nav>
        <div className={`absolute inset-x-5 top-full hidden pt-2 transition-opacity duration-150 sm:inset-x-6 lg:block ${businessOpen ? "visible opacity-100" : "invisible opacity-0"}`}>
          <BusinessMenu />
        </div>
        <button type="button" onClick={() => setMobileOpen((open) => !open)} className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground lg:hidden" aria-label={mobileOpen ? "Close navigation" : "Open navigation"}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileOpen ? (
        <div className="max-h-[calc(100vh-64px)] overflow-y-auto border-t border-border bg-background px-5 pb-6 lg:hidden">
          <div className="grid gap-1 border-b border-border py-4">
            {CONSUMER_LINKS.map((link) => (
              <a key={link.label} href={link.href} onClick={() => setMobileOpen(false)} className="rounded-lg px-2 py-3 text-sm font-semibold text-foreground">{link.label}</a>
            ))}
          </div>
          <BusinessMenu mobile close={() => setMobileOpen(false)} />
          <div className="grid gap-2 border-t border-border pt-5">
            <a href="/find" className="rounded-lg px-2 py-3 text-sm font-semibold text-foreground">Search</a>
            <div className="px-2 py-1"><SavedSheet /></div>
            <a href="/auth" className="rounded-lg px-2 py-3 text-sm font-semibold text-foreground">Sign In</a>
            <a href="/nora" className="mt-2 inline-flex h-11 items-center justify-center rounded-md bg-amber-500 px-5 text-sm font-semibold text-slate-950">Get Started</a>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function SiteFooter({ data: _data }: { data?: FooterNavData }) {
  return (
    <footer className="border-t border-border bg-muted/55">
      <div className="mx-auto w-full max-w-[1320px] px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.1fr_repeat(6,1fr)]">
          <div>
            <BrandWordmark size={22} />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">Helping people find and choose the right professionals, offices, and brands.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/auth" className="text-sm font-semibold text-foreground">Sign In</a>
              <a href="/nora" className="text-sm font-semibold text-primary">Get Started</a>
            </div>
          </div>
          {FOOTER_COLUMNS.map((column) => <FooterCol key={column.title} title={column.title} links={column.links} />)}
        </div>
      </div>
      <div className="border-t border-border py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Experience.com. All rights reserved.</div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: NavLinkItem[] }) {
  return (
    <div>
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-foreground">{title}</p>
      <ul className="space-y-2.5">
        {links.map((link) => <li key={link.href}><a href={link.href} className="text-sm text-muted-foreground hover:text-foreground">{link.label}</a></li>)}
      </ul>
    </div>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground"><SiteHeader /><main>{children}</main><SiteFooter /></div>;
}