// Client shim: the server implementation moved to FastAPI (surface-api/srp).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";
import type { PublicPage } from "@v3/ui/lib/public-site";

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

export const getPublicHome = serverFn<PublicPage | null>("srp", "getPublicHome");
export const getPublicPage = serverFn<PublicPage | null>("srp", "getPublicPage");
export const getPublicTrustDocs = serverFn<PublicPage[]>("srp", "getPublicTrustDocs");
export const getPublicPageBySlug = serverFn<PublicPage | null>("srp", "getPublicPageBySlug");
