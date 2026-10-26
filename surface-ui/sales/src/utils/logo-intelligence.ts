export const CLAIM_SUCCESS_TYPES = new Set(["claimed", "engaged", "upgraded"]);

export type LogoClaimSignal = {
  id: string;
  entity_id: string | null;
  entity_label: string | null;
  entity_type: string | null;
  event_type: string | null;
  occurred_at: string | null;
  upgraded: boolean | null;
  nora_engagement: number | null;
};

export type LogoCatalogPrice = {
  product_key: string | null;
  product_name: string | null;
  scope: string | null;
  unit: string | null;
  billing_type: string | null;
  list_price: number | null;
};

export type LogoProfileSignal = {
  id: string;
  label: string;
  type: "professional" | "location";
  eventType: string | null;
  occurredAt: string | null;
  upgraded: boolean;
  score: number | null;
};

export type LogoProductSignal = {
  key: string;
  label: string;
  owned: boolean;
  likely: boolean;
  scopes: string[];
  annualPotential: number;
};

export type LogoIntelligence = {
  claims7d: number;
  claims30d: number;
  attempted: number;
  warmUp: number;
  outsideWarmUp: number;
  upgraded: number;
  currentArr: number;
  potentialArr: number;
  headroom: number;
  averageScore: number | null;
  professionalCount: number;
  locationCount: number;
  profiles: LogoProfileSignal[];
  products: LogoProductSignal[];
  ownedProductKeys: string[];
};

export function rollupClaimBuckets(claims: LogoClaimSignal[], now = Date.now()) {
  const day = 86_400_000;
  const successful = claims.filter((row) => CLAIM_SUCCESS_TYPES.has(row.event_type ?? ""));
  const within = (row: LogoClaimSignal, days: number) => !!row.occurred_at && now - Date.parse(row.occurred_at) <= days * day;
  return {
    claims7d: successful.filter((row) => within(row, 7)),
    claims30d: successful.filter((row) => within(row, 30)),
    attempted: claims.filter((row) => row.event_type === "attempted"),
    warmUp: successful.filter((row) => within(row, 30) && !row.upgraded),
    outsideWarmUp: successful.filter((row) => !within(row, 30) && !row.upgraded),
    upgraded: claims.filter((row) => row.event_type === "upgraded" || row.upgraded),
  };
}

const annualPrice = (row: LogoCatalogPrice) => {
  const price = Number(row.list_price ?? 0);
  if (row.billing_type === "subscription" && row.unit === "month") return price * 12;
  if (row.billing_type === "subscription" && row.unit === "year") return price;
  return 0;
};

const profileType = (value: string | null): "professional" | "location" | null =>
  value === "professional" ? "professional" : value === "location" ? "location" : null;

export function rollupLogoIntelligence(input: {
  claims: LogoClaimSignal[];
  catalog: LogoCatalogPrice[];
  ownedProductKeys: Iterable<string>;
  currentArr: number;
  likelyProductKeys: Iterable<string>;
  scores: Map<string, number>;
  now?: number;
}): LogoIntelligence {
  const now = input.now ?? Date.now();
  const owned = new Set(input.ownedProductKeys);
  const likely = new Set(input.likelyProductKeys);
  const latestByEntity = new Map<string, LogoClaimSignal>();
  for (const row of input.claims) {
    if (!row.entity_id || !profileType(row.entity_type)) continue;
    const previous = latestByEntity.get(row.entity_id);
    if (!previous || Date.parse(row.occurred_at ?? "") > Date.parse(previous.occurred_at ?? "")) latestByEntity.set(row.entity_id, row);
  }
  const profiles = [...latestByEntity.values()].flatMap((row): LogoProfileSignal[] => {
    const type = profileType(row.entity_type);
    if (!row.entity_id || !type) return [];
    return [{ id: row.entity_id, label: row.entity_label ?? row.entity_id, type, eventType: row.event_type, occurredAt: row.occurred_at, upgraded: !!row.upgraded, score: input.scores.get(row.entity_id) ?? null }];
  });
  const professionalCount = profiles.filter((row) => row.type === "professional").length;
  const locationCount = profiles.filter((row) => row.type === "location").length;
  const productMap = new Map<string, LogoProductSignal>();
  for (const row of input.catalog) {
    if (!row.product_key || row.billing_type === "free_with_nora") continue;
    const current = productMap.get(row.product_key) ?? { key: row.product_key, label: row.product_name ?? row.product_key, owned: owned.has(row.product_key), likely: likely.has(row.product_key), scopes: [], annualPotential: 0 };
    const count = row.scope === "professional" ? professionalCount : row.scope === "location" ? locationCount : 1;
    current.scopes.push(row.scope ?? "enterprise");
    if (!current.owned) current.annualPotential += annualPrice(row) * count;
    productMap.set(row.product_key, current);
  }
  for (const key of new Set([...owned, ...likely])) {
    if (!productMap.has(key)) productMap.set(key, { key, label: key.replaceAll("_", " "), owned: owned.has(key), likely: likely.has(key), scopes: [], annualPotential: 0 });
  }
  const buckets = rollupClaimBuckets(input.claims, now);
  const scores = profiles.map((row) => row.score).filter((score): score is number => score != null);
  const products = [...productMap.values()].sort((a, b) => Number(b.likely) - Number(a.likely) || Number(b.owned) - Number(a.owned) || a.label.localeCompare(b.label));
  const headroom = products.reduce((sum, row) => sum + row.annualPotential, 0);
  return {
    claims7d: buckets.claims7d.length,
    claims30d: buckets.claims30d.length,
    attempted: buckets.attempted.length,
    warmUp: buckets.warmUp.length,
    outsideWarmUp: buckets.outsideWarmUp.length,
    upgraded: buckets.upgraded.length,
    currentArr: input.currentArr,
    potentialArr: input.currentArr + headroom,
    headroom,
    averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    professionalCount,
    locationCount,
    profiles,
    products,
    ownedProductKeys: [...owned],
  };
}