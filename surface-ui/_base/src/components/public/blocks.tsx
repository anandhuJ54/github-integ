import type { Block } from "@v3/ui/lib/public-site";
import { MarketingSections } from "@v3/ui/components/marketing/sections/premium/MarketingSections";

/**
 * Single renderer for every CMS-driven marketing page.
 * All section types live in the premium section renderer so the CMS editor,
 * the live preview and the public routes always agree.
 */
export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return <MarketingSections blocks={blocks} />;
}
