// sales parity, one file per PR group (S1 catalog & pricing, S1 CPQ, then S2–S4 as they land).
import { cases as catalogCases } from "./sales-s1-catalog";
import { cases as cpqCases } from "./sales-s1-cpq";
import { cases as contractsCases } from "./sales-s2-contracts";
import { cases as coreCases } from "./sales-s2-core";
import { cases as opportunityCases } from "./sales-s3-opportunity";
import { cases as worklistCases } from "./sales-s3-worklist";
import { cases as territoriesCases } from "./sales-s4-territories";
import { cases as teamsCases } from "./sales-s4-teams";
import { cases as boardsCases } from "./sales-s4-boards";
import type { ParityCase } from "./types";

export const cases: ParityCase[] = [
  ...catalogCases,
  ...cpqCases,
  ...contractsCases,
  ...coreCases,
  ...opportunityCases,
  ...worklistCases,
  ...territoriesCases,
  ...teamsCases,
  ...boardsCases,
];
