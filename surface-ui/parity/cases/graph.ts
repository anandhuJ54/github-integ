// graph parity: the category pages and the entity pages, kept in two files.
import { cases as categoryCases } from "./graph-categories";
import { cases as entityCases } from "./graph-entities";
import type { ParityCase } from "./types";

export const cases: ParityCase[] = [...categoryCases, ...entityCases];
