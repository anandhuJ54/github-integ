// sales parity, one file per PR group (S1 catalog & pricing, S1 CPQ, then S2–S4 as they land).
import { cases as catalogCases } from "./sales-s1-catalog";
import { cases as cpqCases } from "./sales-s1-cpq";
import { cases as contractsCases } from "./sales-s2-contracts";
import { cases as coreCases } from "./sales-s2-core";
import type { ParityCase } from "./types";

export const cases: ParityCase[] = [...catalogCases, ...cpqCases, ...contractsCases, ...coreCases];
