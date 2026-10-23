#!/usr/bin/env bun
// Usage: bun tools/enrichment/harvest/cli.ts <config.json> [--dry-run] [--resume] [--budget <usd>] [--env <path>]
import { join } from "node:path";
import { Budget, BudgetExceededError } from "./budget";
import { DataForSeoClient } from "./client";
import { loadConfig } from "./config";
import { DEFAULT_ENV_PATH, loadCredentials } from "./env";
import { OUTPUT_FILES, formatCostSummary, runHarvest } from "./pipeline";
import { formatPlan, planCalls } from "./plan";

export function parseArgs(argv: string[]) {
  const o = { config: "", dryRun: false, resume: false, budget: undefined as number | undefined, env: DEFAULT_ENV_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--resume") o.resume = true;
    else if (a === "--budget") o.budget = Number(argv[++i]);
    else if (a === "--env") o.env = argv[++i];
    else if (a.startsWith("--")) throw new Error(`Unknown flag ${a}`);
    else if (!o.config) o.config = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  if (!o.config) throw new Error("Usage: cli.ts <config.json> [--dry-run] [--resume] [--budget <usd>] [--env <path>]");
  if (o.budget !== undefined && !(o.budget >= 0)) throw new Error("--budget must be a non-negative number");
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config);
  if (args.budget !== undefined) cfg.budget_usd = args.budget;

  if (args.dryRun) {
    console.log(formatPlan(cfg, planCalls(cfg)));
    return;
  }

  const budget = new Budget(cfg.budget_usd, join(cfg.out_dir, OUTPUT_FILES.spend));
  const client = new DataForSeoClient(loadCredentials(args.env), budget);
  console.log(`Harvest ${cfg.gcid} (${cfg.name}) mode=${cfg.mode} cap=$${cfg.budget_usd.toFixed(2)} already spent=$${budget.spent.toFixed(4)}`);
  try {
    await runHarvest(cfg, { client, budget, resume: args.resume, log: (m) => console.log(m) });
  } catch (e) {
    console.log(formatCostSummary(budget));
    if (e instanceof BudgetExceededError) {
      console.error(e.message);
      console.error("Completed steps are on disk; raise the cap (--budget / budget_usd) and re-run with --resume.");
      process.exit(2);
    }
    throw e;
  }
  console.log(formatCostSummary(budget));
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
