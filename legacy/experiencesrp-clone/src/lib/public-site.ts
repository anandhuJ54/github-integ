/** Shared (browser-safe) types + block helpers for the public CMS-driven marketing site. */

export type PublicPage = {
  id: string;
  slug: string | null;
  title: string | null;
  page_type: string | null;
  status: string | null;
  /** Normalized block list (see blocksOf). */
  body: Block[];
  seo_title: string | null;
  seo_desc: string | null;
  published_at: string | null;
  updated_at: string | null;
  /** When set, the designed page lives at this coded route (CMS body is a reference copy). */
  route_path?: string | null;
  code_rendered?: boolean | null;
};

export type BlockType =
  | "hero"
  | "feature_grid"
  | "feature_split"
  | "pillar_band"
  | "stat_band"
  | "logo_strip"
  | "faq"
  | "testimonial"
  | "dual_cta"
  | "collection"
  | "rich_text"
  | "cta"
  // legacy types kept so already-published pages keep rendering
  | "problem"
  | "product_grid"
  | "platform_grid"
  | "pricing"
  | "logos";

export type BlockCta = {
  label: string;
  href: string;
  variant?: "primary" | "secondary" | "ghost" | "white";
  note?: string;
  external?: boolean;
};

export type BlockItem = {
  title?: string;
  body?: string;
  eyebrow?: string;
  href?: string;
  price?: string;
  note?: string;
  question?: string;
  answer?: string;
  /** feature_split / collection imagery: registry key or absolute URL. */
  image?: string;
  imageAlt?: string;
  /** lucide icon name, e.g. "MapPin". */
  icon?: string;
  /** stat_band */
  value?: string;
  label?: string;
  /** faq filter group */
  category?: string;
  /** testimonial */
  quote?: string;
  role?: string;
  logo?: string;
  /** feature_split / feature_grid checkmark bullets */
  bullets?: string[];
  /** feature_split image side */
  imagePosition?: "left" | "right";
  ctas?: BlockCta[];
};

export type Block = {
  type: BlockType | string;
  eyebrow?: string;
  headline?: string;
  /** highlighted (accent) tail of the headline */
  accent?: string;
  subhead?: string;
  body?: string;
  markdown?: string;
  /** Sanitized WYSIWYG HTML (rich_text blocks). */
  html?: string;
  items?: BlockItem[];
  ctas?: BlockCta[];
  note?: string;
  /** registry key or absolute URL */
  image?: string;
  imageAlt?: string;
  /** dark | light band treatment */
  theme?: "dark" | "light";
  tone?: "default" | "muted" | "gradient";
  /** dual_cta panels */
  panels?: { label: string; headline?: string; body?: string; cta?: BlockCta }[];
};

/** exp_web_pages.body may be an array of blocks, `{ blocks: [...] }`, or markdown. */
export function blocksOf(body: unknown): Block[] {
  if (Array.isArray(body)) return body as Block[];
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.blocks)) return obj.blocks as Block[];
    if (typeof obj.markdown === "string") return [{ type: "rich_text", markdown: obj.markdown }];
  }
  return [];
}

const ALLOWED_TAGS = new Set([
  "P","BR","STRONG","B","EM","I","U","H2","H3","H4","UL","OL","LI","A","BLOCKQUOTE","CODE","PRE","SPAN","DIV","HR",
]);

/**
 * Conservative HTML sanitizer for CMS rich text (WYSIWYG output).
 * Strips unknown tags, every event handler, style attribute and unsafe href scheme.
 * Runs in the browser (editor) and falls back to tag-stripping on the server.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") {
    return html.replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  }
  const root = document.createElement("div");
  root.innerHTML = html;

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        const text = document.createTextNode(child.textContent ?? "");
        child.replaceWith(text);
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const keep =
          (child.tagName === "A" && (name === "href" || name === "target" || name === "rel"));
        if (!keep) child.removeAttribute(attr.name);
      }
      if (child.tagName === "A") {
        const href = child.getAttribute("href") ?? "";
        if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) child.removeAttribute("href");
        child.setAttribute("rel", "noopener noreferrer");
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
