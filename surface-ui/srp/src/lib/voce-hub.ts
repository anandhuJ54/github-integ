import { supabase } from "@v3/ui/integrations/supabase/client";
import { DEFAULT_QUERY, decodeName, runSearch, type SearchDoc } from "@v3/ui/lib/search";
import { loadHubArticles, topicsOf, type VoceArticle } from "@v3/ui/lib/voce";

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
  const { data } = await supabase
    .from("gbp_categories")
    .select("display_name, slug")
    .eq("gcid", gcid)
    .maybeSingle();
  const row = data as { display_name?: string | null; slug?: string | null } | null;
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
