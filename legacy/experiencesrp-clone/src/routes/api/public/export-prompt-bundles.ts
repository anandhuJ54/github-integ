import { createFileRoute } from '@tanstack/react-router';

const EXPECTED_COUNT = 4041;
const CHUNK_SIZE = 200;
const BUCKET = 'exports';
const OBJECT_PATH = 'category_prompt_bundles.json';

async function runExport(): Promise<Response> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

  const { count, error: countError } = await supabaseAdmin
    .from('exp_prompt_bundle')
    .select('gcid', { count: 'exact', head: true });

  if (countError) {
    return Response.json({ status: 'error', message: countError.message }, { status: 500 });
  }

  const built = count ?? 0;
  if (built < EXPECTED_COUNT) {
    return Response.json({ status: 'not_ready', built });
  }

  // Build the file as an array of string parts so the whole document is only
  // materialized once, inside the Blob, instead of via repeated concatenation.
  const parts: string[] = [
    `{"format":"exp_category_bundle_universe","format_version":"1.0","generated_at":${JSON.stringify(
      new Date().toISOString(),
    )},"count":${EXPECTED_COUNT},"categories":[`,
  ];

  let emitted = 0;
  for (let offset = 0; ; offset += CHUNK_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('exp_prompt_bundle')
      .select('gcid, bundle')
      .order('gcid', { ascending: true })
      .range(offset, offset + CHUNK_SIZE - 1);

    if (error) {
      return Response.json({ status: 'error', message: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      parts.push(emitted === 0 ? '' : ',');
      parts.push(JSON.stringify(row.bundle));
      emitted += 1;
    }

    if (data.length < CHUNK_SIZE) break;
  }

  parts.push(']}');

  const blob = new Blob(parts, { type: 'application/json' });
  const bytes = blob.size;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(OBJECT_PATH, blob, { contentType: 'application/json', upsert: true });

  if (uploadError) {
    return Response.json({ status: 'error', message: uploadError.message }, { status: 500 });
  }

  const { data: publicUrl } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(OBJECT_PATH);

  // The workspace blocks public buckets, so `exports` is private: also mint a
  // long-lived signed URL that actually resolves today.
  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(OBJECT_PATH, 60 * 60 * 24 * 7);

  return Response.json({
    status: 'done',
    url: signed?.signedUrl ?? publicUrl.publicUrl,
    public_url: publicUrl.publicUrl,
    bytes,
    rows: emitted,
  });
}

export const Route = createFileRoute('/api/public/export-prompt-bundles')({
  server: {
    handlers: {
      GET: () => runExport(),
      POST: () => runExport(),
    },
  },
});
