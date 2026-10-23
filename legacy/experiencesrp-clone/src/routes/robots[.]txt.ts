import { createFileRoute } from "@tanstack/react-router";

/**
 * robots.txt. Site-wide indexing switch OFF (default): "Disallow: /" and no
 * Sitemap line. ON: points crawlers at the sitemap index; console and API stay out.
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { robotsTxt } = await import("@/lib/index-floor");
        const { loadSiteIndexingEnabled } = await import("@/lib/sitemap.server");
        const origin = new URL(request.url).origin;
        const enabled = await loadSiteIndexingEnabled();
        return new Response(robotsTxt(origin, enabled), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": enabled ? "public, max-age=3600" : "public, max-age=300",
          },
        });
      },
    },
  },
});
