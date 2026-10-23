import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { blocksOf, type PublicPage } from "@/lib/public-site";

/**
 * Public (unauthenticated) CMS reads for the marketing site.
 * Uses the publishable key + the `published pages public` anon SELECT policy,
 * so it is safe to call from public route loaders during SSR/prerender.
 */
function publicClient() {
  return createClient<Database>(
    process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']!,
    process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['VITE_SUPABASE_PUBLISHABLE_KEY']!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

const COLUMNS =
  "id, slug, title, page_type, status, body, seo_title, seo_desc, published_at, updated_at, route_path, code_rendered";

type Row = {
  id: string;
  slug: string | null;
  title: string | null;
  page_type: string | null;
  status: string | null;
  body: unknown;
  seo_title: string | null;
  seo_desc: string | null;
  published_at: string | null;
  updated_at: string | null;
  route_path: string | null;
  code_rendered: boolean | null;
};

function normalize(row: Row | undefined): PublicPage | null {
  if (!row) return null;
  return { ...row, body: blocksOf(row.body) };
}

/** Home page = the newest published page with page_type='home'. */
export const getPublicHome = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await publicClient()
    .from("exp_web_pages")
    .select(COLUMNS)
    .eq("page_type", "home")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return normalize((data as Row[] | null)?.[0]);
});

export const getPublicPage = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string; pageType: string }) => ({
    slug: String(data.slug).slice(0, 200),
    pageType: String(data.pageType).slice(0, 40),
  }))
  .handler(async ({ data }) => {
    const { data: rows, error } = await publicClient()
      .from("exp_web_pages")
      .select(COLUMNS)
      .eq("slug", data.slug)
      .eq("page_type", data.pageType)
      .eq("status", "published")
      .limit(1);
    if (error) throw new Error(error.message);
    return normalize((rows as Row[] | null)?.[0]);
  });

/** All published Trust Center documents (public, unauthenticated). */
export const getPublicTrustDocs = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await publicClient()
    .from("exp_web_pages")
    .select(COLUMNS)
    .eq("page_type", "trust")
    .eq("status", "published")
    .order("title", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as Row[] | null) ?? []).map((r) => normalize(r)!) as PublicPage[];
});

/** Published CMS page by slug (used by the canonical marketing routes). */
export const getPublicPageBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => ({ slug: String(data.slug).slice(0, 200) }))
  .handler(async ({ data }) => {
    const { data: rows, error } = await publicClient()
      .from("exp_web_pages")
      .select(COLUMNS)
      .eq("slug", data.slug)
      .eq("status", "published")
      .limit(1);
    if (error) throw new Error(error.message);
    return normalize((rows as Row[] | null)?.[0]);
  });
