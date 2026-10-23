// Static check of Growth Hub sales surfaces: routes, internal links, table names.
// Run: bun scripts/check-sales-surfaces.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let pass = 0;
const fails = [];
const ok = (cond, msg) => (cond ? pass++ : fails.push(msg));

// 1. Registered route paths (fullPath values) from routeTree.gen.ts
const tree = read("src/routeTree.gen.ts");
const routes = new Set([...tree.matchAll(/fullPath:\s*'([^']+)'/g)].map((m) => m[1]));
for (const m of tree.matchAll(/'(\/[^']*)':\s*typeof/g)) routes.add(m[1]);
const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p).replace(/\$[A-Za-z_]\w*|\$\{[^}]+\}/g, "$");
const normRoutes = new Set([...routes].map(norm));
console.log(`Registered routes: ${routes.size}`);

// 2. Sales route files
const routeDir = "src/routes/_authenticated";
const salesRoutes = readdirSync(join(root, routeDir)).filter((f) => /^sales.*\.tsx$/.test(f));
let linkCount = 0;
for (const f of salesRoutes) {
  const src = read(join(routeDir, f));
  ok(src.includes("createFileRoute("), `${f}: no createFileRoute(`);
  const targets = [
    ...[...src.matchAll(/\bto="(\/[^"]*)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/\bto=\{`(\/[^`]*)`\}/g)].map((m) => m[1]),
    ...[...src.matchAll(/\bhref="(\/sales[^"]*)"/g)].map((m) => m[1]),
  ];
  for (const t of targets) {
    linkCount++;
    const clean = t.split(/[?#]/)[0];
    ok(normRoutes.has(norm(clean)), `${f}: link target ${t} matches no registered route`);
  }
}
console.log(`Sales route files: ${salesRoutes.length}, internal links checked: ${linkCount}`);

// 3. Tables referenced from src/lib/sales-*.ts
const types = read("src/integrations/supabase/types.ts");
const pub = types.slice(types.indexOf("public: {"));
const tablesBlock = pub.slice(pub.indexOf("Tables: {"), pub.indexOf("Views: {"));
const viewsBlock = pub.slice(pub.indexOf("Views: {"), pub.indexOf("Functions: {"));
const keys = (b) => new Set([...b.matchAll(/^      (\w+): \{$/gm)].map((m) => m[1]));
const tables = keys(tablesBlock);
const views = keys(viewsBlock);
const libs = readdirSync(join(root, "src/lib")).filter((f) => /^sales-.*\.ts$/.test(f));
let tableRefs = 0;
for (const f of libs) {
  const src = read(join("src/lib", f));
  for (const m of src.matchAll(/\.from\(\s*["'`](\w+)["'`]/g)) {
    tableRefs++;
    const t = m[1];
    if (!tables.has(t) && views.has(t)) console.log(`  note: ${f}: ${t} is a view, not a table`);
    ok(tables.has(t), `${f}: table ${t} not in Database["public"]["Tables"]`);
  }
}
console.log(`Sales lib files: ${libs.length}, table references checked: ${tableRefs} (known tables: ${tables.size})`);

for (const x of fails) console.log(`FAIL ${x}`);
console.log(`\nSUMMARY: ${pass} PASS, ${fails.length} FAIL`);
process.exit(fails.length ? 1 : 0);
