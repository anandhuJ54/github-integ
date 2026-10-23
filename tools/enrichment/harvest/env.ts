// Credential loading. Values are never printed or logged; errors name the variable only.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Credentials } from "./types";

// tools/enrichment/.env.local (gitignored via the repo's *.local rule)
export const DEFAULT_ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const quoted = v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")));
    v = quoted ? v.slice(1, -1) : v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

export function loadCredentials(
  path: string = DEFAULT_ENV_PATH,
  fallback: Record<string, string | undefined> = process.env,
): Credentials {
  const fromFile = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  const login = fromFile.DATAFORSEO_LOGIN || fallback.DATAFORSEO_LOGIN;
  const password = fromFile.DATAFORSEO_PASSWORD || fallback.DATAFORSEO_PASSWORD;
  const missing = [!login && "DATAFORSEO_LOGIN", !password && "DATAFORSEO_PASSWORD"].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(" and ")} (expected in tools/enrichment/.env.local, which is gitignored)`);
  }
  return { login: login as string, password: password as string };
}
