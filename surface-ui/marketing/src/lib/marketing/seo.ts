/**
 * Canonical site origin used for canonical / og:url / og:image tags.
 */
export const SITE_URL = "https://www.experience.com";

/**
 * Absolute URL for a page's social preview image.
 *
 * Preview images live in `public/og/<slug>.png` (1200x630, generated from each
 * page's hero graphic). In production the Vite build base is `/marketing/`, so
 * static files under `public/` are served from `/marketing/...`.
 */
export const ogImageUrl = (slug: string) => `${SITE_URL}/marketing/og/${slug}.png`;

/** Absolute canonical URL for a marketing route path (e.g. "/listings"). */
export const canonical = (path: string) => `${SITE_URL}${path}`;
