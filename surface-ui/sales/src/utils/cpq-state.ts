/** CPQ quote state — ported verbatim (types only). */
import type { PackageId } from "./cpq-catalog";
import { includedAddOnQuantities } from "./cpq-pricing";

export interface QuoteState {
  quoteId: string;
  accountName: string;
  packageId: PackageId | null;
  professionals: number;
  locations: number;
  discount: number;
  enterpriseEnabled: boolean;
  addOns: {
    listingsProfessionals: number;
    listingsLocations: number;
    voceUsers: number;
    sponsoredSearchSelected: boolean;
    sponsoredSearchZips: number;
    sponsoredSearchMonthlyRate: number;
    conversionAgentsSelected: boolean;
    conversionAgentProfessionals: number;
    conversionAgentLocations: number;
  };
  enterprise: {
    platformFee: { users: number; pricingMode: "standard" | "included" };
    engageCredits: { selected: boolean; users: number; pricePerUser: number };
    amplifyCredits: { selected: boolean; users: number; pricePerUser: number };
    voceCredits: { selected: boolean; users: number; pricePerCredit: number };
    conversionAgents: { selected: boolean; agents: number; packagePrice: number };
    sponsoredSearch: { selected: boolean; zips: number; monthlyRate: number };
    campaigns5Pack: { selected: boolean; quantity: number };
    benchmarkCampaign: { selected: boolean; quantity: number };
    customIntegration: { selected: boolean; quantity: number };
    customDevelopment: { selected: boolean; hours: number };
  };
  /** Build-2 additions remain optional so existing saved drafts stay readable. */
  productQuantities?: Record<string, { professionals: number; locations: number }>;
  enterpriseQuantities?: Record<string, number>;
  adPassthrough?: number;
  referralPartner?: number;
  creditUtilizationPct?: number;
  /** Optional promo applied to this quote (code only; discount lives in `discount`). */
  promoCode?: string | null;
  /** Customer step: selected exp_accounts row (accountName mirrors its name). */
  accountId?: string | null;
  accountOrgId?: string | null;
  /** Deal-level pricing lane: per-user products (default) or consumption/credits. */
  pricingModel?: "ppu" | "credits";
  /** Consumption lane: annual credit-pool quantity. */
  creditPool?: number;
  /** VOCE enterprise tier variant (pooled | publish_first | platform_only). */
  voceVariant?: string;
  /** Tiered products the seller forced back to the SMB rate card. */
  smbFallback?: string[];
  /** CRM handoff context; pricing remains owned by the CPQ builder. */
  opportunityId?: string | null;
  preselectedProductKeys?: string[];
  contractId?: string;
}

export function initialState(): QuoteState {
  return {
    quoteId: "Q-10482",
    accountName: "Acme Mortgage",
    packageId: "amplify",
    professionals: 250,
    locations: 35,
    discount: 12000,
    enterpriseEnabled: true,
    addOns: {
      listingsProfessionals: 250,
      listingsLocations: 35,
      voceUsers: 285,
      sponsoredSearchSelected: true,
      sponsoredSearchZips: 12,
      sponsoredSearchMonthlyRate: 0,
      conversionAgentsSelected: false,
      conversionAgentProfessionals: 0,
      conversionAgentLocations: 0,
    },
    enterprise: {
      platformFee: { users: 285, pricingMode: "standard" },
      engageCredits: { selected: true, users: 250, pricePerUser: 0 },
      amplifyCredits: { selected: false, users: 35, pricePerUser: 0 },
      voceCredits: { selected: true, users: 285, pricePerCredit: 0 },
      conversionAgents: { selected: true, agents: 20, packagePrice: 0 },
      sponsoredSearch: { selected: true, zips: 12, monthlyRate: 0 },
      campaigns5Pack: { selected: false, quantity: 1 },
      benchmarkCampaign: { selected: false, quantity: 1 },
      customIntegration: { selected: false, quantity: 1 },
      customDevelopment: { selected: false, hours: 0 },
    },
  };
}

export function normalizePackageInclusions(state: QuoteState): QuoteState {
  const next = structuredClone(state);
  const included = includedAddOnQuantities(next);
  if (next.packageId && (included.listings.professionals || included.listings.locations || included.voce.users)) {
    next.addOns.listingsProfessionals = Math.max(next.addOns.listingsProfessionals, included.listings.professionals);
    next.addOns.listingsLocations = Math.max(next.addOns.listingsLocations, included.listings.locations);
    next.addOns.voceUsers = Math.max(next.addOns.voceUsers, included.voce.users);
  }
  const defaultUsers = Number(next.professionals || 0) + Number(next.locations || 0);
  if (!next.enterprise.platformFee.users) next.enterprise.platformFee.users = defaultUsers;
  return next;
}
