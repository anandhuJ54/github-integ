// _base parity: the shared @v3/ui libs, each now served by the Surface that owns its tables.
import { cases as adminSearchSrpCases } from "./base-admin-search-srp";
import { cases as xmpNoraCases } from "./base-xmp-nora";
import type { ParityCase } from "./types";

export const cases: ParityCase[] = [...adminSearchSrpCases, ...xmpNoraCases];
