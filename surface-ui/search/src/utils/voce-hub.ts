import { api } from "@v3/state/api/server-fn";
import { DEFAULT_QUERY, decodeName, runSearch, type SearchDoc } from "@v3/shared/public/utils/search";
import { loadHubArticles, topicsOf, type VoceArticle } from "@v3/shared/public/utils/voce";

export type HubData = {
  gcid: string;
  topic: string | null;
  label: string;
  articles: VoceArticle[];
  topics: string[];
  directory: SearchDoc[];
  directoryTotal: number;
};

async function labelFor(gcid: string): Promise<string> {
  const row = await api.get<{ display_name?: string | null; slug?: string | null } | null>(
    `/search/category-label/${encodeURIComponent(gcid)}`,
  );
  return decodeName(row?.display_name ?? row?.slug ?? gcid);
}

/** Live category/topic hub: boosted VOCE placements + top entities in the category. */
export async function loadHub(gcid: string, topic: string | null): Promise<HubData> {
  const [label, articles, dir] = await Promise.all([
    labelFor(gcid),
    loadHubArticles(gcid, topic),
    runSearch({ ...DEFAULT_QUERY, gcid, sort: "rank" }),
  ]);
  return {
    gcid,
    topic,
    label,
    articles,
    topics: topicsOf(await loadHubArticles(gcid, null)),
    directory: dir.results.slice(0, 12),
    directoryTotal: dir.total,
  };
}
