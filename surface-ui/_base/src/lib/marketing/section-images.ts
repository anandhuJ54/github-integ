/**
 * Resolves a CMS section's `image` value to a real URL.
 *
 * A section image is either
 *  1. a registry key naming a bundled asset (e.g. "listings/hero-image-v2"), or
 *  2. an absolute / root-relative URL (uploaded images, external URLs).
 *
 * The registry is built from the bundled marketing assets so CMS pages can keep
 * using the imagery that already ships with the app without re-uploading it.
 */

const modules = import.meta.glob("/src/assets/**/*.{png,jpg,jpeg,webp,svg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const registry: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const key = path.replace("/src/assets/", "").replace(/\.(png|jpe?g|webp|svg)$/i, "");
  registry[key] = url;
}

/** Every bundled image key, sorted — used by the CMS image picker. */
export const sectionImageKeys = Object.keys(registry).sort();

/** Bucket used for CMS image uploads. */
export const MARKETING_IMAGE_BUCKET = "marketing-images";

export function isExternalImage(value: string): boolean {
  return /^(https?:|data:|blob:|\/)/i.test(value);
}

/** Returns a usable src for a section image value, or null when unresolvable. */
export function resolveSectionImage(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (isExternalImage(v)) return v;
  const key = v.replace(/^\/?src\/assets\//, "").replace(/\.(png|jpe?g|webp|svg)$/i, "");
  return registry[key] ?? null;
}
