// ============================================================================
// Category boundary generation (2026-10-16) — generic, for any category (gcid).
//
// A category boundary (exp_category_boundary: definition, includes, excludes, subtypes) tells discovery what one
// profile of the category is and which neighbouring kinds belong to other categories. Authored boundaries exist for a
// few categories; every other category had none, so discovery ran without a definition (accountant round 2 then
// returned general marketplaces). generateCategoryBoundary writes one for a category that has none:
//   - grounded in our own category list: the model sees the category's name and type and the real categories whose
//     names share a word with it; every "goes to" it returns is resolved against gbp_categories by name, and a name
//     that is not a real category is kept only as "adjacent: <name>";
//   - generic: brand / company examples ("e.g. ...", "such as ...", parentheses with examples) are removed;
//   - checked: an empty or malformed answer is refused (nothing saved);
//   - never overwrites an authored boundary (source not starting with "generated"); regenerate replaces only a
//     generated one. Saved with source "generated:<model>" (updated_at = when).
// Used by disco-ai-worker (discover step, when the category has no boundary) and by the Regenerate button
// (src/lib/category-boundary.functions.ts).
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GeneratedBoundary = {
  definition: string;
  includes: string[];
  excludes: Array<{ type: string; goes_to: string }>;
  subtypes: Array<{ name: string; criteria: string }>;
};

const BOUNDARY_TOOL = {
  name: 'define_category_boundary',
  description: 'Define what one profile of this category is, and which neighbouring kinds belong to other categories.',
  input_schema: {
    type: 'object',
    properties: {
      definition: { type: 'string', description: 'One or two sentences: what one profile of this category is.' },
      includes: { type: 'array', items: { type: 'string' }, description: '2-6 kinds of profiles that belong to this category.' },
      subtypes: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, criteria: { type: 'string' } }, required: ['name', 'criteria'] },
        description: '0-5 sub-types of profile, snake_case names, with how to tell them apart.',
      },
      excludes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'The kind of profile or site that is NOT this category.' },
            goes_to: { type: 'string', description: 'Exact name of the category it belongs to, from the RELATED CATEGORIES list, or "not a source".' },
          },
          required: ['type', 'goes_to'],
        },
        description: '3-12 neighbouring kinds that belong elsewhere.',
      },
    },
    required: ['definition', 'includes', 'excludes'],
  },
};

const STOP = new Set(['service', 'services', 'agency', 'company', 'office', 'shop', 'store', 'center', 'centre', 'and', 'the', 'of', 'for', 'a', 'an', 'association', 'department', 'school', 'club']);
const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, '').replace(/(ing|ants?|ents?|ers?|ors?|ists?|ies|es|s)$/, '');
const tokens = (s: string) => s.split(/[\s/&,()-]+/).map(stem).filter((t) => t.length >= 3 && !STOP.has(t));

/** Remove brand / company examples so the boundary stays generic. Fix (boundary answer check, 2026-10-16): an
 *  "e.g. / such as / for example" part is removed only when it names something (a capitalised word); generic wording
 *  ("such as staff and senior accountants") is kept. */
const NAMES_SOMETHING = /(^|[\s,(])[A-Z][A-Za-z0-9&.'-]*[A-Za-z0-9]/;
function stripExamples(s: string): string {
  let t = String(s ?? '');
  t = t.replace(/\((?:e\.g\.|eg\.?|for example|such as|like|including)([^)]*)\)/gi, (m, rest) => (NAMES_SOMETHING.test(String(rest)) ? '' : m));
  t = t.replace(/([,;]?\s*(?:e\.g\.|for example|such as|including)\s)(.*)$/i, (m, _lead, rest) => (NAMES_SOMETHING.test(String(rest)) ? '' : m));
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
}

/** Fix (boundary answer check, 2026-10-16): the model sometimes sends a list as a JSON string; parse it. */
function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) { try { const j = JSON.parse(t); if (Array.isArray(j)) return j; } catch { /* not JSON */ } }
    if (t) return t.split(/\n+|;\s*/).map((x) => x.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  }
  return [];
}
const kindOf = (v: unknown) => (Array.isArray(v) ? `list of ${v.length}` : v == null ? 'nothing' : typeof v === 'string' ? `text (${v.length} chars)` : typeof v);

export async function generateCategoryBoundary(
  db: any,
  model: string,
  gcid: string,
  ask: (prompt: string, tool: any) => Promise<any>,
  opts: { regenerate?: boolean } = {},
): Promise<{ boundary: GeneratedBoundary | null; saved: boolean; reason: string }> {
  const { data: existing } = await db.from('exp_category_boundary').select('definition, includes, excludes, subtypes, source').eq('gcid', gcid).maybeSingle();
  const existingIsGenerated = !!existing && String(existing.source ?? '').startsWith('generated');
  if (existing && !existingIsGenerated) return { boundary: existing, saved: false, reason: 'authored boundary kept' };
  if (existing && !opts.regenerate) return { boundary: existing, saved: false, reason: 'generated boundary already exists' };

  const { data: cat } = await db.from('gbp_categories').select('display_name, entity_type').eq('gcid', gcid).maybeSingle();
  if (!cat?.display_name) throw new Error(`unknown category ${gcid}`);
  const { data: all } = await db.from('gbp_categories').select('gcid, display_name').neq('gcid', gcid).limit(10000);
  const own = new Set(tokens(cat.display_name));
  const byName = new Map<string, string>();
  for (const c of (all ?? []) as Array<{ gcid: string; display_name: string }>) byName.set(c.display_name.toLowerCase(), c.gcid);
  const related = ((all ?? []) as Array<{ gcid: string; display_name: string }>)
    .filter((c) => tokens(c.display_name).some((t) => own.has(t)))
    .map((c) => c.display_name)
    .slice(0, 80);

  const unit = cat.entity_type === 'location' ? 'a single physical location (a place)' : 'an individual professional (a person)';
  const prompt = [
    `CATEGORY: ${cat.display_name} (${gcid})`,
    `ONE PROFILE IS: ${unit}.`,
    '',
    'Define the boundary of this category for a US directory of profiles: what one profile is, what kinds of profiles belong',
    'to it, optional sub-types, and which neighbouring kinds of profiles or sites belong to OTHER categories.',
    '',
    related.length ? `RELATED CATEGORIES (real categories in our list; use these exact names in goes_to):\n${related.join('; ')}` : 'RELATED CATEGORIES: none found by name.',
    '',
    'Rules:',
    '- Be generic: describe kinds of professionals, places or sites. Never name a company, brand or website.',
    '- goes_to must be an exact name from RELATED CATEGORIES, another real business category name, or "not a source" (for software, tools,',
    '  general marketplaces or sites that are not about this category).',
    '- General multi-industry marketplaces and review sites are not sources of this category unless they have a dedicated section for it.',
    '- Keep each item short (one line).',
  ].join('\n');

  const out = await ask(prompt, BOUNDARY_TOOL);
  const definition = stripExamples(String(out?.definition ?? ''));
  const includes = asList(out?.includes).map((x: any) => stripExamples(String(x ?? ''))).filter((x: string) => x.length >= 3).slice(0, 8);
  const subtypes = asList(out?.subtypes)
    .map((s: any) => ({ name: String(s?.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, ''), criteria: stripExamples(String(s?.criteria ?? '')) }))
    .filter((s: any) => s.name && s.criteria).slice(0, 6);
  const excludes = asList(out?.excludes)
    .map((e0: any) => {
      // a list item sent as text: "kind -> category" (or "kind: category")
      const e = typeof e0 === 'string'
        ? (() => { const m = e0.split(/\s*(?:→|->|=>|:)\s*/); return { type: m[0], goes_to: m.slice(1).join(' ') }; })()
        : e0;
      const type = stripExamples(String(e?.type ?? ''));
      const g = String(e?.goes_to ?? '').trim();
      const gl = g.toLowerCase().replace(/^gcid:/, '');
      let goes_to: string;
      if (!g || /^not a source/i.test(g)) goes_to = 'not a source';
      else if (byName.has(gl)) goes_to = byName.get(gl)!;
      else if (byName.has(gl.replace(/s$/, ''))) goes_to = byName.get(gl.replace(/s$/, ''))!;
      else if ((all ?? []).some((c: any) => c.gcid === `gcid:${gl.replace(/\s+/g, '_')}`)) goes_to = `gcid:${gl.replace(/\s+/g, '_')}`;
      else goes_to = `adjacent: ${g}`;
      return { type, goes_to };
    })
    .filter((e: any) => e.type.length >= 3).slice(0, 12);

  const problems: string[] = [];
  if (definition.length < 20) problems.push(`definition ${definition.length} characters (received ${kindOf(out?.definition)})`);
  if (definition.length > 800) problems.push(`definition too long (${definition.length} characters)`);
  if (includes.length === 0) problems.push(`includes empty (received ${kindOf(out?.includes)})`);
  if (excludes.length === 0) problems.push(`belongs-elsewhere empty (received ${kindOf(out?.excludes)})`);
  if (problems.length) throw new Error(`boundary answer refused: ${problems.join('; ')}`);
  const boundary: GeneratedBoundary = { definition, includes, excludes, subtypes };
  const row = { gcid, ...boundary, source: `generated:${model}`, updated_at: new Date().toISOString() };
  if (existing) {
    const { error } = await db.from('exp_category_boundary').update(row).eq('gcid', gcid).like('source', 'generated%');
    if (error) throw new Error(`boundary save failed: ${error.message}`);
  } else {
    const { error } = await db.from('exp_category_boundary').insert(row);
    if (error) throw new Error(`boundary save failed: ${error.message}`);
  }
  return { boundary, saved: true, reason: existing ? 'regenerated' : 'generated' };
}
