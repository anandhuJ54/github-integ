// ============================================================================
// Shared extra-key list (C14 / C14b / C14c), moved out of disco-ai-worker.ts for G2 (2026-10-13).
// After a site contract is saved - by the mapping worker's auto-save (save rule D1) or by Accept in the
// site contract panel - the category's extra_field rows in exp_field_discovery are refreshed: new extras
// are queued for review, seen_count = site contracts of the category that hold the key, rows no contract
// holds any more are removed. Same logic as before, one copy. Failures are logged, never thrown.
// The leading dash keeps this file out of the file router.
// ============================================================================
import {
  type ExtraFieldSpec,
  PERSON_IDENTITY_KEYS,
  LOCATION_KEYS,
  FIRM_KEYS,
  isStaticExtraKey,
  EXTRA_VALUE_TYPES,
  EXTRA_SUBJECTS,
} from './-disco-site-contract';

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function refreshExtraKeys(db: any, gcid: string, domain: string, extras: Record<string, ExtraFieldSpec>): Promise<void> {
  // C14: record kept extra keys (staging only). Failures are logged, never fail the map.
  try {
    for (const [key, f] of Object.entries(extras)) {
      // Step 2: an extra named like a static key (routed by name) is not a shared extra key.
      if (isStaticExtraKey(key, new Set([...PERSON_IDENTITY_KEYS, ...Object.keys(LOCATION_KEYS), ...Object.keys(FIRM_KEYS)]))) continue;
      // C14b: seen_count = site contracts in this category that hold the key (incl. this one).
      const { count: siteCount, error: cntErr } = await db
        .from('disco_site_contract')
        .select('domain', { count: 'exact', head: true })
        .eq('category_slug', gcid)
        .not(`extraction->site_contract->extra_fields->${key}`, 'is', null);
      if (cntErr) console.error('extra key count failed', key, cntErr.message);
      const seen = Math.max(1, Number(siteCount ?? 0));
      const { data: row, error: selErr } = await db
        .from('exp_field_discovery')
        .select('discovery_id, first_source, seen_count')
        .eq('gcid', gcid).eq('element_kind', 'extra_field').eq('normalized', key)
        .maybeSingle();
      if (selErr) { console.error('extra key lookup failed', key, selErr.message); continue; }
      if (row) {
        const { error: upErr } = await db.from('exp_field_discovery')
          .update({ seen_count: seen } as any)
          .eq('discovery_id', (row as any).discovery_id);
        if (upErr) console.error('extra key update failed', key, upErr.message);
      } else {
        const { error: insErr } = await db.from('exp_field_discovery').insert({
          gcid, element_kind: 'extra_field', raw_label: f.label, normalized: key,
          relevance_verdict: 'needs_review', status: 'queued_review',
          reason: 'extra field (C14): staging only, not promoted', first_source: domain,
          seen_count: seen,
        } as any);
        if (insErr) console.error('extra key insert failed', key, insErr.message);
      }
      await recordDictionaryKey(db, gcid, domain, key, f);
    }
  } catch (e) {
    console.error('extra key recording failed', e);
  }
  // C14c: shared list hygiene — recount every extra_field row of this category; delete rows no contract holds.
  try {

    const { data: listRows, error: listErr } = await db
      .from('exp_field_discovery')
      .select('discovery_id, normalized')
      .eq('gcid', gcid).eq('element_kind', 'extra_field');
    if (listErr) console.error('extra list load failed', listErr.message);
    for (const lr of (listRows ?? []) as Array<{ discovery_id: string; normalized: string }>) {
      if (!lr?.normalized) continue;
      const { count, error: cErr } = await db
        .from('disco_site_contract')
        .select('domain', { count: 'exact', head: true })
        .eq('category_slug', gcid)
        .not(`extraction->site_contract->extra_fields->${lr.normalized}`, 'is', null);
      if (cErr) { console.error('extra list recount failed', lr.normalized, cErr.message); continue; }
      const n = Number(count ?? 0);
      if (n === 0) {
        const { error: dErr } = await db.from('exp_field_discovery')
          .delete().eq('discovery_id', lr.discovery_id as any).eq('element_kind', 'extra_field');
        if (dErr) console.error('extra list delete failed', lr.normalized, dErr.message);
      } else {
        const { error: uErr } = await db.from('exp_field_discovery')
          .update({ seen_count: n } as any).eq('discovery_id', lr.discovery_id as any).eq('element_kind', 'extra_field');
        if (uErr) console.error('extra list update failed', lr.normalized, uErr.message);
      }
    }
  } catch (e) {
    console.error('extra list hygiene failed', e);
  }
}

// Fix (extra key dictionary, 2026-10-22): one row per extra key name across all categories (exp_field_discovery,
// element_kind 'extra_key'), with its meaning, format and subject. A key the mapper defined is saved once; an existing
// definition is never overwritten and dictionary rows are never deleted (the per-category hygiene above only touches
// 'extra_field' rows). seen_count = site contracts of any category that hold the key. Keys without a complete
// definition (older contracts) are not added here.
async function recordDictionaryKey(db: any, gcid: string, domain: string, key: string, f: ExtraFieldSpec): Promise<void> {
  try {
    const { count, error: cntErr } = await db
      .from('disco_site_contract')
      .select('domain', { count: 'exact', head: true })
      .not(`extraction->site_contract->extra_fields->${key}`, 'is', null);
    if (cntErr) console.error('dictionary count failed', key, cntErr.message);
    const seen = Math.max(1, Number(count ?? 0));
    const { data: row, error: selErr } = await db
      .from('exp_field_discovery')
      .select('discovery_id')
      .eq('element_kind', 'extra_key').eq('normalized', key)
      .maybeSingle();
    if (selErr) { console.error('dictionary lookup failed', key, selErr.message); return; }
    if (row) {
      const { error: upErr } = await db.from('exp_field_discovery').update({ seen_count: seen } as any)
        .eq('discovery_id', (row as any).discovery_id).eq('element_kind', 'extra_key');
      if (upErr) console.error('dictionary update failed', key, upErr.message);
      return;
    }
    const definition = typeof f.definition === 'string' ? f.definition.trim() : '';
    const valueType = (EXTRA_VALUE_TYPES as readonly string[]).includes(String(f.value_type)) ? f.value_type : null;
    const subject = (EXTRA_SUBJECTS as readonly string[]).includes(String(f.subject)) ? f.subject : null;
    if (!definition || !valueType || !subject) return;
    const { error: insErr } = await db.from('exp_field_discovery').insert({
      gcid, element_kind: 'extra_key', raw_label: f.label || key, normalized: key,
      definition, value_type: valueType, subject,
      examples: Array.isArray(f.examples) ? f.examples.slice(0, 3) : null,
      defined_at: new Date().toISOString(),
      relevance_verdict: 'needs_review', status: 'queued_review',
      reason: 'extra key dictionary: defined by the site mapper', first_source: domain, seen_count: seen,
    } as any);
    // 23505: another map defined the same name first; its definition stands.
    if (insErr && (insErr as any).code !== '23505') console.error('dictionary insert failed', key, insErr.message);
  } catch (e) {
    console.error('dictionary record failed', key, e);
  }
}
