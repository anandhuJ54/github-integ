import { createFileRoute } from "@tanstack/react-router";

/**
 * Per-partition urlset. Accepts "priority-high" or "priority-high.xml".
 * While the site-wide indexing switch is OFF every partition is an empty urlset.
 */
export const Route = createFileRoute("/api/public/sitemap/$partition")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const {
          loadPartitions,
          loadPartitionUrls,
          loadSiteIndexingEnabled,
          urlSetXml,
          xmlResponse,
          INDEXABLE_PARTITIONS,
        } = await import("@/lib/sitemap.server");
        const key = String(params.partition).replace(/\.xml$/i, "");
        if (!(INDEXABLE_PARTITIONS as readonly string[]).includes(key)) {
          return new Response("Not found", { status: 404 });
        }
        const origin = new URL(request.url).origin;
        if (!(await loadSiteIndexingEnabled())) {
          const empty = {
            partition_key: key,
            min_score: null,
            max_score: null,
            changefreq: null,
            priority: null,
            url_count: 0,
            last_built_at: null,
          };
          return xmlResponse(urlSetXml(origin, empty, [], false));
        }
        const partitions = await loadPartitions();
        const partition = partitions.find((p) => p.partition_key === key);
        if (!partition) return new Response("Not found", { status: 404 });
        return xmlResponse(urlSetXml(origin, partition, await loadPartitionUrls(key, partitions), true));
      },
    },
  },
});
