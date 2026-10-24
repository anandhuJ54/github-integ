// xmp parity: the website CMS and the enterprise / seat / dashboard pages, kept in two files.
import { cases as websiteCases } from "./xmp-website";
import { cases as seatCases } from "./xmp-seat";
import type { ParityCase } from "./types";

export const cases: ParityCase[] = [...websiteCases, ...seatCases];
