# Copy all pages from "Master Marketing Pages" into this project

Bring across the 15 live marketing pages from the pasted project so they render here at the same web addresses, look identical, and appear in the CMS page list.

## Pages to duplicate

| Page | Address |
|---|---|
| Reviews Management | /reviews-management |
| Listings | /listings |
| Campaigns | /campaigns |
| Insights | /insights |
| Social | /social |
| Search Ranking | /search-ranking |
| Website | /website-marketing (see note) |
| Demo | /demo |
| Request a Demo | /request-a-demo |
| 404 page | /404 |
| Contact Us | /contact-us |
| AI Visibility | /ai-visibility |
| Content | /content |
| Customer Stories | /customer-stories |
| KW Mega Camp 2026 | /kw-mega-camp-2026 |

Note: the source project's Website page lives at `/website`, which this project already uses for the internal Demand Engine admin area. The public copy goes to `/website-marketing` so nothing internal breaks.

The source project also has unrouted drafts (5 homepage variants, About, FAQs, Assets, Parent Pages, XMP, SearchRankPlatformV2, HomepageTest). These are not live pages there; they are excluded unless you want them too.

## How it will be done

- Copy every page, section, and layout component into a self-contained `src/marketing/` folder, plus the shadcn/UI pieces those pages use, so the existing admin console and public profile surfaces are untouched.
- Copy only the images those pages actually reference (the source has 91MB of assets; unused ones are skipped).
- Recreate the source design system (colours, gradients, shadows, SF Pro typography, keyframe animations) as a scoped block in `src/styles.css` applied through a wrapper class, so the marketing look is pixel-faithful without changing this project's existing token palette.
- Convert routing: source uses a different router. Each page becomes a route file under `src/routes/`, with the source page's `<Helmet>` title/description moved into the route's `head()` (title, description, og and twitter tags).
- Convert internal links and navigation calls to this project's router.
- Keep the shared page shell (top nav, breadcrumbs, sticky footer CTA) exactly as in the source, wrapped in a shared marketing layout so all 15 pages share it.
- Add one row per page to the CMS page list (`exp_web_pages`) so they show under Site content with a design tag, matching the existing bulk publish/unpublish behaviour.

## Technical notes

- Framer Motion is already installed here; any other missing source dependency (`embla-carousel-react`, `@dnd-kit/*`, `input-otp`, etc.) is installed only if a copied page actually imports it. The wizard/upload tooling in the source is not part of these pages and is skipped.
- No `react-router-dom` and no `react-helmet-async` will be introduced; both are replaced by the project's own router and route `head()` per the project's stack rules.
- Source Tailwind v3 config extensions (colours, gradients, shadows, radius, keyframes/animations) are translated to Tailwind v4 `@theme`/`@utility` entries namespaced for marketing use.
- Pages stay static/presentational; no backend writes, no changes to governed `exp_*` model tables other than adding CMS page rows.

## Verification

- Typecheck passes.
- Each of the 15 addresses returns 200 and renders its hero plus main sections, checked in the browser with no console errors, and screenshots compared against the source pages.
- CMS Site content shows the new pages.
