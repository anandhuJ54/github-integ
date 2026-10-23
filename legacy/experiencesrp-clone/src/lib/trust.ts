/** Trust Center helpers — shared, browser-safe. */
import type { Block, PublicPage } from "@/lib/public-site";

export const TRUST_CATEGORIES = ["Legal", "Privacy", "Security", "Compliance"] as const;
export type TrustCategory = (typeof TRUST_CATEGORIES)[number];

/** External data / privacy request intake (link only — we never mirror that form). */
export const DATA_REQUEST_URL =
  "https://app.sixfifty.com/request-easy/6385-4387/questions/5303735";

export type TrustMeta = {
  category: string;
  summary: string;
  sourceUrl: string | null;
  importPending: boolean;
};

/**
 * Trust documents keep their catalog metadata in a leading `trust_meta` block so the
 * whole document stays a normal CMS page (editable in the visual/WYSIWYG editor).
 */
export function trustMeta(page: PublicPage): TrustMeta {
  const meta = page.body.find((b) => b.type === "trust_meta");
  const category = (meta?.eyebrow ?? "").trim();
  return {
    category: (TRUST_CATEGORIES as readonly string[]).includes(category) ? category : "Legal",
    summary: (meta?.body ?? page.seo_desc ?? "").trim(),
    sourceUrl: meta?.note?.trim() ? meta.note.trim() : null,
    importPending: meta?.headline === "import pending",
  };
}

/** Content blocks (everything except the metadata block). */
export function trustBlocks(page: PublicPage): Block[] {
  return page.body.filter((b) => b.type !== "trust_meta");
}

export function formatTrustDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
