// ============================================================================
// disco-staging-backfill — staging schema step 5 (docs/ETL-Staging-Data-Schema.md).
//
// Rebuilds identity_candidates.universal of existing exp_etl_staging rows of ONE
// source from what each row already holds (its universal values, its payload
// taxonomy keys and its _extra), with the same code the harvest uses
// (buildStagingStatic): section-5 fill order, section-4 formats, quality rules.
// No page fetch, no AI. Top-level identity_candidates fields are not changed.
//
// dry_run (default true) writes NOTHING and returns before / after counts per
// static key. dry_run:false writes one batch (upsert by stage_id) — only after
// the owner approved the dry-run numbers.
//
// Trigger: POST /api/public/disco-staging-backfill with header x-disco-worker-key,
// body { domain, gcid, after_stage_id?, limit? (<= 500), dry_run?, routes?, boilerplate_texts? }
//   routes: extra static routes { "<static id>": StaticRoute[] } (e.g. the agreed section-8 mapping)
//   boilerplate_texts: { "<static id>": ["<text shared by many rows>", …] }
// ============================================================================
import { createFileRoute } from '@tanstack/react-router';
import {
  buildStagingStatic,
  buildStaticRoutes,
  boilerplateKey,
  filterTaxonomyRows,
  resolveTaxonomyKeys,
  isIdentityId,
  HELPER_IDS,
  TAX_PREFIX,
  ACTION_SEP,
  type SiteContract,
  type StaticRoute,
  type TaxonomyFieldSpec,
  type TaxonomyRow,
  type Subject,
} from './-disco-site-contract';

type Body = {
  domain?: string; gcid?: string; after_stage_id?: string | null; limit?: number; dry_run?: boolean;
  routes?: Record<string, StaticRoute[]>; boilerplate_texts?: Record<string, string[]>;
};
type StageRow = {
  stage_id: string; source_id: string; gcid: string; entity_type: string; detail_url: string | null;
  resolution_status: string; payload: Record<string, any> | null; identity_candidates: Record<string, any> | null;
};

const SUBJECT_BY_LABEL: Record<string, Subject> = { person: 'person', branch: 'location', firm: 'firm' };
const nonEmpty = (v: unknown) => v != null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0);

// Fix (backfill keeps stored actions and credentials, 2026-10-13): stored values are already formatted, but
// buildStagingStatic reads page form. Stored actions ({label, url, type}) go back in as page form (label + url), so the
// label and link survive and the current action rules still apply. Stored credentials keep every entry as stored
// (licence / registration number, state, issuer); the rebuild only adds entries whose name is not stored yet.
const ACTION_IDS = new Set(['person.actions', 'location.actions']);
function toPageValue(id: string, v: unknown): unknown {
  if (!ACTION_IDS.has(id) || !Array.isArray(v)) return v;
  return v.map((a: any) => (a && typeof a === 'object' && typeof a.url === 'string'
    ? `${String(a.label ?? a.url)}${ACTION_SEP}${a.url}` : a));
}
function keepStoredCredentials(stored: unknown, rebuilt: unknown): unknown {
  const old = Array.isArray(stored) ? stored.filter((c) => c && typeof c === 'object') : [];
  if (!old.length) return rebuilt;
  const names = new Set(old.map((c: any) => String(c.name ?? '').toLowerCase()));
  const added = (Array.isArray(rebuilt) ? rebuilt : []).filter((c: any) => !names.has(String(c?.name ?? '').toLowerCase()));
  return [...old, ...added];
}
/** JSON with sorted object keys, to compare stored and rebuilt values by content. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export async function handleBackfill(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405 });
  const workerKey = process.env['DISCO_WORKER_KEY'];
  if (!workerKey || request.headers.get('x-disco-worker-key') !== workerKey) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: Body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { domain, gcid } = body ?? {};
  if (!domain || !gcid) return Response.json({ error: 'domain and gcid are required' }, { status: 400 });
  const dryRun = body.dry_run !== false;
  const limit = Math.max(1, Math.min(500, Number(body.limit ?? 500)));

  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db = supabaseAdmin as any;
    const { data: cRow, error: cErr } = await db.from('disco_site_contract')
      .select('extraction').eq('domain', domain).eq('category_slug', gcid)
      .order('learned_at', { ascending: false }).limit(1).maybeSingle();
    if (cErr) throw new Error(`contract lookup failed: ${cErr.message}`);
    const contract = (cRow?.extraction?.site_contract ?? null) as SiteContract | null;
    if (!contract) return Response.json({ ok: false, reason: 'no_contract' });
    const { data: src, error: sErr } = await db.from('exp_etl_sources')
      .select('source_id').eq('source_domain', domain).eq('gcid', gcid).limit(1).maybeSingle();
    if (sErr || !src) return Response.json({ ok: false, reason: 'no_source', error: sErr?.message ?? null });

    let q = db.from('exp_etl_staging')
      .select('stage_id, source_id, gcid, entity_type, detail_url, resolution_status, payload, identity_candidates')
      .eq('source_id', src.source_id).eq('gcid', gcid).order('stage_id', { ascending: true }).limit(limit);
    if (body.after_stage_id) q = q.gt('stage_id', body.after_stage_id);
    const { data: rows, error: rErr } = await q;
    if (rErr) throw new Error(`staging read failed: ${rErr.message}`);
    const list = (rows ?? []) as StageRow[];
    if (!list.length) return Response.json({ ok: true, done: true, rows: 0 });

    // Taxonomy routes by schema.org meaning (same rule as mapping), from the registry and the rows' subjects.
    const { data: reg } = await db.from('exp_vertical_node_registry')
      .select('node_slug, node_name, node_description, schema_type, schema_property, entity_scope, owns_lane')
      .eq('gcid', gcid).eq('is_active', true);
    const taxKeys = resolveTaxonomyKeys(filterTaxonomyRows((reg ?? []) as TaxonomyRow[]), contract.primary_subject);
    const subjectVotes = new Map<string, Map<Subject, number>>();
    for (const r of list) {
      for (const [slug, label] of Object.entries((r.payload?._subjects ?? {}) as Record<string, string>)) {
        const s = SUBJECT_BY_LABEL[label];
        if (!s) continue;
        const m = subjectVotes.get(slug) ?? new Map<Subject, number>();
        m.set(s, (m.get(s) ?? 0) + 1);
        subjectVotes.set(slug, m);
      }
    }
    const taxonomyFields: Record<string, TaxonomyFieldSpec> = {};
    for (const [slug, m] of subjectVotes) {
      const subject = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
      taxonomyFields[slug] = {
        tier: 'css', locator: { tier: 'css', strategy: 'css', css: 'backfill' }, type: 'text', hits: 1, samples: 1, subject, scope: null,
      } as TaxonomyFieldSpec;
    }
    const generic = buildStaticRoutes({
      fields: {}, taxonomyFields, taxKeys, primary: contract.primary_subject,
      extraFields: {}, extraCandidates: {}, extraValues: [], sampleUrls: [],
    }).routes;
    const routes: Record<string, StaticRoute[]> = {};
    for (const src0 of [generic, contract.static_routes ?? {}, body.routes ?? {}]) {
      for (const [sid, rs] of Object.entries(src0)) {
        if (!Array.isArray(rs)) continue;
        routes[sid] = [...(routes[sid] ?? []), ...rs];
      }
    }
    const boilerplate: Record<string, string[]> = { ...(contract.boilerplate_values ?? {}) };
    for (const [sid, texts] of Object.entries(body.boilerplate_texts ?? {})) {
      boilerplate[sid] = [...(boilerplate[sid] ?? []), ...(texts ?? []).map((t) => boilerplateKey(t))];
    }
    const workContract = { ...contract, static_routes: routes, boilerplate_values: boilerplate };

    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    const changed: Record<string, number> = {}; // rows whose value differs by content (not only present / absent)
    let extrasRemoved = 0;
    const examples: Array<{ stage_id: string; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
    const updates: Array<Record<string, unknown>> = [];
    for (const r of list) {
      const ic = r.identity_candidates ?? {};
      const payload = r.payload ?? {};
      const oldU = (ic.universal ?? {}) as Record<string, unknown>;
      const values: Record<string, unknown> = {};
      for (const [id, v] of Object.entries(oldU)) if (nonEmpty(v) && (isIdentityId(id) || HELPER_IDS.has(id))) values[id] = toPageValue(id, v);
      for (const [slug, v] of Object.entries(payload)) if (!slug.startsWith('_') && nonEmpty(v)) values[TAX_PREFIX + slug] = v;
      const oldExtras = (payload._extra ?? {}) as Record<string, unknown>;
      const pageUrl = r.detail_url ?? String(ic.url ?? '');
      const st = buildStagingStatic({ contract: workContract, values, extras: oldExtras, pageUrl });
      if (nonEmpty(oldU['person.credentials'])) {
        const kept = keepStoredCredentials(oldU['person.credentials'], st.universal['person.credentials']);
        if (nonEmpty(kept)) st.universal['person.credentials'] = kept;
      }
      for (const id of new Set([...Object.keys(oldU), ...Object.keys(st.universal)])) {
        if (!isIdentityId(id)) continue;
        if (stable(oldU[id]) !== stable(st.universal[id])) changed[id] = (changed[id] ?? 0) + 1;
      }
      for (const id of Object.keys(oldU)) if (nonEmpty(oldU[id])) before[id] = (before[id] ?? 0) + 1;
      for (const id of Object.keys(st.universal)) after[id] = (after[id] ?? 0) + 1;
      extrasRemoved += Object.keys(oldExtras).length - Object.keys(st.extras).length;
      if (examples.length < 2) examples.push({ stage_id: r.stage_id, before: oldU, after: st.universal });
      const newPayload: Record<string, unknown> = { ...payload };
      delete newPayload._extra;
      if (Object.keys(st.extras).length) newPayload._extra = st.extras;
      if (Object.keys(st.sources).length) newPayload._static_sources = st.sources; else delete newPayload._static_sources;
      updates.push({
        stage_id: r.stage_id, source_id: r.source_id, gcid: r.gcid, entity_type: r.entity_type,
        payload: newPayload, identity_candidates: { ...ic, universal: st.universal },
      });
    }

    let written = 0;
    if (!dryRun) {
      const { error: uErr } = await db.from('exp_etl_staging').upsert(updates, { onConflict: 'stage_id' });
      if (uErr) throw new Error(`staging write failed: ${uErr.message}`);
      written = updates.length;
    }
    const statuses: Record<string, number> = {};
    for (const r of list) statuses[r.resolution_status] = (statuses[r.resolution_status] ?? 0) + 1;
    return Response.json({
      ok: true, dry_run: dryRun, rows: list.length, written, statuses,
      last_stage_id: list[list.length - 1].stage_id, done: list.length < limit,
      before, after, changed, extras_removed: extrasRemoved, routes_used: Object.keys(routes).sort(), examples,
    });
  } catch (error) {
    return Response.json({ ok: false, reason: 'error', error: String(error) }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/public/disco-staging-backfill')({
  server: { handlers: { POST: ({ request }) => handleBackfill(request) } },
});
