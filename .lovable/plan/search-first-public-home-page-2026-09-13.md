# Search-first public home page

Rebuild `/` as a consumer search entry point, extend the primary nav, and add the two new
destination pages the nav points at. Every element reads live data; nothing is invented.
No migrations, no changes to graph / ring / taxonomy / scoring tables, `/find` untouched.

## 1. Navigation (public header + footer)

`src/components/public/site-chrome.tsx`

- Left of the logo group, add consumer links: **Find Professionals** (`/find?type=professional`),
  **Find Businesses** (`/find?type=location`), **Guides & Q&A** (`/guides`), **Topics** (`/topics`).
- Right side becomes: search icon (links to `/find`), **Sign In**, **Get Started**, with the
  existing **For Business** mega-menu kept exactly as it is.
- Mobile menu gets the same four consumer links above the business groups.
- Footer gains an "Explore" column with the same four links.

Note: `/find` currently ignores an unknown `type` param (its `validateSearch` only keeps known
keys), so those links land on the full search page. Wiring the `type` filter into `/find` is a
separate task, as requested.

## 2. Home page

`src/routes/index.tsx` (rewritten) + new `src/lib/home.functions.ts` + `src/components/public/home-search.tsx`

Hero: full-width dark editorial band with a generated city-skyline background image, one `<h1>`,
a subhead, and ONE large search field inside a real `<form method="get" action="/find">`
(placeholder: `Search people, offices, brands — try "best fish and chips near me"`). Submit
navigates client-side to `/find?q=…` and carries the detected location into the `loc` param.

Location chip: small, editable, dismissible chip beside the box. Source order:
1. silent IP hint from request headers in the loader (`cf-ipcity`/`cf-region-code`, and the
   common `x-vercel-ip-city` / `x-geo-city` fallbacks);
2. precise browser geolocation only when the user clicks "Use my exact location";
3. free-text edit.
If no header hint exists, no chip renders — nothing is guessed.

Sections below the hero, all live:
- **Quick category chips** — top categories by document count.
- **Explore by what matters to you** — same live category set as a grid with counts.
- **Trending searches** — top category × city combinations.
- **Guides & Q&A teaser** — from `content_items`; currently empty → graceful empty state.
- **Topics teaser** — from `exp_voce_article` (2 live rows) → topic links.

No business cards, no profile detail on home.

## 3. New routes

- `/guides` — Guides & Q&A index reading `content_items` (empty state today).
- `/topics` — topic index reading `exp_voce_article` topics + the live category set, linking to
  the existing `/topic/$gcid` hubs.

## 4. SEO

Unique `<title>` and meta description on `/`, `/guides`, `/topics`, plus og/twitter tags, a
single H1 per page, and a crawlable GET form pointing at `/find`.

## Data sources (for verification)

| Home element | Source |
| --- | --- |
| Category chips + explore grid | `search_docs_facets()` RPC → `search_documents.gcid` joined to `gbp_categories.display_name`, with counts |
| Trending searches | `search_docs_facets()` cities (`search_documents.city/state`) crossed with the top category |
| Detected location chip | request headers (`cf-ipcity`, `cf-region-code`, `x-vercel-ip-city`) or browser geolocation |
| Guides & Q&A row | `content_items` (title, slug, summary) |
| Topics row | `exp_voce_article.topic`, `gcid`, `title`, `slug` |
| Hero headline / subhead | published CMS home page (`exp_web_pages`, `page_type='home'`) when present, else site copy |

The facets RPC takes ~4s over the full 39,464-row table, so the home loader caches it
(`staleTime` 10 minutes) and the sections render from that single call.
