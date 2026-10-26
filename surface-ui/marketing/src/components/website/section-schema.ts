import type { Block, BlockItem } from "@v3/shared/public/utils/public-site";

/**
 * One schema table describing every marketing section type the public renderer
 * supports, and which fields the CMS editor shows for it. The editor is generated
 * from this table, so the vocabulary can never drift from the renderer.
 */

export type ItemField =
  | "title"
  | "eyebrow"
  | "body"
  | "href"
  | "question"
  | "answer"
  | "category"
  | "price"
  | "note"
  | "value"
  | "label"
  | "quote"
  | "role"
  | "logo"
  | "icon"
  | "image"
  | "imageAlt"
  | "imagePosition"
  | "bullets";

export type SectionSpec = {
  type: string;
  label: string;
  description: string;
  /** Section-level fields. */
  fields: ("eyebrow" | "headline" | "accent" | "subhead" | "note" | "ctas" | "image" | "imageAlt" | "theme" | "tone" | "html" | "panels")[];
  itemFields?: ItemField[];
  itemLabel?: string;
  legacy?: boolean;
};

export const SECTION_SPECS: SectionSpec[] = [
  {
    type: "hero",
    label: "Hero",
    description: "Big opening headline, intro paragraph, buttons and an optional image.",
    fields: ["eyebrow", "headline", "accent", "subhead", "note", "ctas", "image", "imageAlt"],
  },
  {
    type: "pillar_band",
    label: "Branded pillar band",
    description: "Dark band with a statement and three supporting pillars.",
    fields: ["eyebrow", "headline", "subhead"],
    itemFields: ["icon", "title", "body"],
    itemLabel: "Pillar",
  },
  {
    type: "feature_split",
    label: "Feature rows (image + checkmarks)",
    description: "Alternating rows with an image, a heading, a paragraph and checkmark bullets.",
    fields: ["eyebrow", "headline", "accent", "subhead", "ctas"],
    itemFields: ["eyebrow", "title", "body", "bullets", "image", "imageAlt", "imagePosition"],
    itemLabel: "Row",
  },
  {
    type: "feature_grid",
    label: "Feature grid (3-up)",
    description: "Three cards with an icon or image, a heading and bullets.",
    fields: ["eyebrow", "headline", "accent", "subhead", "ctas"],
    itemFields: ["icon", "title", "body", "bullets", "image", "imageAlt", "href"],
    itemLabel: "Card",
  },
  {
    type: "stat_band",
    label: "Stat band",
    description: "A row of numbers with short labels.",
    fields: ["eyebrow", "headline", "subhead", "note"],
    itemFields: ["value", "label", "body"],
    itemLabel: "Stat",
  },
  {
    type: "logo_strip",
    label: "Logo strip",
    description: "A row of customer or partner logos.",
    fields: ["headline", "note"],
    itemFields: ["title", "logo", "imageAlt", "href"],
    itemLabel: "Logo",
  },
  {
    type: "faq",
    label: "FAQ (filterable)",
    description: "Questions and answers with category filters. Also emits FAQ search data.",
    fields: ["eyebrow", "headline", "subhead", "ctas"],
    itemFields: ["question", "answer", "category"],
    itemLabel: "Question",
  },
  {
    type: "testimonial",
    label: "Testimonial",
    description: "A quote with the person's name, role and optional photo.",
    fields: ["eyebrow", "headline", "subhead"],
    itemFields: ["quote", "title", "role", "image", "imageAlt", "logo"],
    itemLabel: "Quote",
  },
  {
    type: "dual_cta",
    label: "Two-panel call to action",
    description: 'Closing band with two panels, e.g. "For Professionals" and "For Enterprises".',
    fields: ["eyebrow", "headline", "subhead", "panels"],
  },
  {
    type: "cta",
    label: "Call to action band",
    description: "One centred headline with buttons.",
    fields: ["eyebrow", "headline", "accent", "subhead", "note", "ctas", "theme"],
  },
  {
    type: "collection",
    label: "Card collection",
    description: "A grid of linked cards with optional images.",
    fields: ["eyebrow", "headline", "subhead", "ctas"],
    itemFields: ["title", "body", "image", "imageAlt", "category", "href"],
    itemLabel: "Card",
  },
  {
    type: "rich_text",
    label: "Rich text",
    description: "Formatted text you write like a document.",
    fields: ["eyebrow", "headline", "html"],
  },
  // Legacy types kept so older pages stay editable.
  { type: "problem", label: "Problem list (legacy)", description: "Older list layout.", fields: ["eyebrow", "headline", "subhead"], itemFields: ["title", "body"], legacy: true },
  { type: "product_grid", label: "Product grid (legacy)", description: "Older product card grid.", fields: ["eyebrow", "headline", "subhead"], itemFields: ["title", "body", "href"], legacy: true },
  { type: "platform_grid", label: "Platform grid (legacy)", description: "Older platform card grid.", fields: ["eyebrow", "headline", "subhead"], itemFields: ["title", "body", "href"], legacy: true },
  { type: "pricing", label: "Pricing (legacy, retired)", description: "Retired hand-typed pricing table. Not addable; prices come from the catalog.", fields: ["eyebrow", "headline", "subhead"], itemFields: ["title", "price", "body", "note", "href"], legacy: true },
  { type: "logos", label: "Logos (legacy)", description: "Older logo row.", fields: ["headline"], itemFields: ["title"], legacy: true },
];

export const SPEC_BY_TYPE: Record<string, SectionSpec> = Object.fromEntries(
  SECTION_SPECS.map((s) => [s.type, s]),
);

export const ITEM_FIELD_LABEL: Record<ItemField, string> = {
  title: "Heading",
  eyebrow: "Small label above",
  body: "Text",
  href: "Link",
  question: "Question",
  answer: "Answer",
  category: "Filter category",
  price: "Price",
  note: "Small print",
  value: "Number",
  label: "Label",
  quote: "Quote",
  role: "Role / company",
  logo: "Logo image",
  icon: "Icon",
  image: "Image",
  imageAlt: "Image description (alt)",
  imagePosition: "Image side",
  bullets: "Checkmark bullets",
};

/** Starter content when a section is added, so nothing renders empty. */
export function blankSection(type: string): Block {
  const spec = SPEC_BY_TYPE[type];
  const block: Block = { type };
  if (spec?.fields.includes("headline")) block.headline = "New section headline";
  if (spec?.type === "rich_text") block.html = "";
  if (spec?.type === "dual_cta") {
    block.panels = [
      { label: "For Professionals & Locations", cta: { label: "Get started", href: "/", variant: "white" } },
      { label: "For Enterprises", cta: { label: "Schedule a Call", href: "/request-a-demo", variant: "secondary" } },
    ];
  }
  if (spec?.itemFields?.length) {
    const item: BlockItem = {};
    if (spec.itemFields.includes("question")) item.question = "New question";
    else if (spec.itemFields.includes("quote")) item.quote = "New quote";
    else if (spec.itemFields.includes("value")) { item.value = "0"; item.label = "Label"; }
    else item.title = "New item";
    block.items = [item];
  }
  return block;
}
