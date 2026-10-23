import { createFileRoute } from "@tanstack/react-router";

/**
 * Sitemap index. Held-below-floor pages are excluded by design. While the
 * site-wide indexing switch is OFF the index is empty (no partitions listed).
 */
export const Route = createFileRoute("/api/public/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { loadPartitions, loadSiteIndexingEnabled, sitemapIndexXml, xmlResponse } = await import(
          "@/lib/sitemap.server"
        );
        const origin = new URL(request.url).origin;
        const enabled = await loadSiteIndexingEnabled();
        return xmlResponse(sitemapIndexXml(origin, enabled ? await loadPartitions() : [], enabled));
      },
    },
  },
});
