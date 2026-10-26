// Hard budget guard. Cumulative spend is summed from each response's `cost` field and
// persisted to spend.json after every call, so the cap holds across --resume runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Mode } from "./types";

export const DEFAULT_BUDGET_USD: Record<Mode, number> = { full: 3, lean: 0.6 };

export class BudgetExceededError extends Error {
  constructor(
    public spent: number,
    public limit: number,
    public estimate: number,
  ) {
    super(
      `Budget guard: spent $${spent.toFixed(4)} + next call ~$${estimate.toFixed(4)} would exceed limit $${limit.toFixed(2)}; aborting before the call`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface SpendEntry {
  step: string;
  endpoint: string;
  cost: number;
  at: string;
}

export interface SpendFile {
  limit_usd: number;
  spent_usd: number;
  calls: SpendEntry[];
  by_step: Record<string, number>;
  by_endpoint: Record<string, number>;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export class Budget {
  spent = 0;
  calls: SpendEntry[] = [];

  constructor(
    public limit: number,
    private path?: string,
  ) {
    if (path && existsSync(path)) {
      try {
        const prev = JSON.parse(readFileSync(path, "utf8")) as Partial<SpendFile>;
        if (Array.isArray(prev.calls)) {
          this.calls = prev.calls;
          this.spent = round(prev.calls.reduce((s, c) => s + (Number(c.cost) || 0), 0));
        }
      } catch {
        // Corrupt spend file: refuse to run rather than silently reset the guard.
        throw new Error(`Cannot parse existing spend file ${path}; fix or remove it deliberately`);
      }
    }
  }

  // Throws BEFORE a call if the limit is already reached or the estimate would push past it.
  assertCanSpend(estimate = 0): void {
    if (this.spent >= this.limit || this.spent + estimate > this.limit) {
      throw new BudgetExceededError(this.spent, this.limit, estimate);
    }
  }

  record(step: string, endpoint: string, cost: number): void {
    const c = Number.isFinite(cost) && cost > 0 ? cost : 0;
    this.spent = round(this.spent + c);
    this.calls.push({ step, endpoint, cost: c, at: new Date().toISOString() });
    this.save();
  }

  summary(): SpendFile {
    const by_step: Record<string, number> = {};
    const by_endpoint: Record<string, number> = {};
    for (const c of this.calls) {
      by_step[c.step] = round((by_step[c.step] ?? 0) + c.cost);
      by_endpoint[c.endpoint] = round((by_endpoint[c.endpoint] ?? 0) + c.cost);
    }
    return { limit_usd: this.limit, spent_usd: this.spent, calls: this.calls, by_step, by_endpoint };
  }

  save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.summary(), null, 2));
  }
}
