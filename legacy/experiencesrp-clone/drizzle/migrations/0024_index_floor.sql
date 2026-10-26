-- 0024_index_floor: one floor for indexing.
--
-- Extends the existing index system from supabase/migrations/20260909161044_*.sql
-- and 20260909161214_*.sql (exp_index_queue, exp_sitemap_partition,
-- exp_sitemap_rebuild, exp_index_submit_tick, exp_index_guard). No parallel indexer.
--
-- 1. The floor is the category page template's completeness_floor: the same value
--    the profile page compares against when it emits robots noindex
--    (src/lib/profile-render.ts completeness(); category-profile.tsx head()).
--    Score only orders and bands pages; score <= 0 is no longer a second floor.
-- 2. exp_index_sync() fills exp_index_queue from search_documents (+ the v5
--    search_rank_scores when present) and sets state from that one floor.
-- 3. exp_index_submit_tick() records 'submitted' (not 'indexed'); a submission is
--    not a crawl confirmation. Google Indexing API is off unless explicitly enabled.
-- 4. exp_sitemap_rebuild() reads band thresholds from exp_sitemap_partition.
--
-- Additive and idempotent (add column if not exists / create or replace).
--
-- 5. Site-wide switch (Scott, 2026-10-11: "Do everything except index"):
--    exp_index_config.site_indexing_enabled, seeded 'false'. exp_index_enabled()
--    reads it (missing / anything but 'true' = OFF). While OFF:
--    exp_index_submit_tick returns before touching the queue, the log or the
--    network; exp_index_sync / exp_sitemap_rebuild still run so the console shows
--    what WOULD be indexed; the app serves an empty sitemap, robots Disallow: /,
--    a site-wide robots noindex meta and X-Robots-Tag (src/lib/index-floor.ts).
-- Crons are not touched: index-sitemap-rebuild / index-submit-tick stay inactive.

-- ---------------------------------------------------------------------------
-- Queue columns
-- ---------------------------------------------------------------------------
alter table public.exp_index_queue add column if not exists lastmod timestamptz;
alter table public.exp_index_queue add column if not exists is_demo boolean not null default false;
alter table public.exp_index_queue add column if not exists completeness_floor integer;
alter table public.exp_index_queue add column if not exists synced_at timestamptz;

create index if not exists exp_index_queue_entity_idx on public.exp_index_queue (entity_type, entity_id);
create index if not exists exp_index_queue_state_idx on public.exp_index_queue (state);

-- ---------------------------------------------------------------------------
-- Site-wide indexing switch. Defaults OFF. Flipped only by a super admin from
-- the Indexing console (src/lib/site-indexing.functions.ts setSiteIndexing).
-- ---------------------------------------------------------------------------
insert into public.exp_index_config (key, value, updated_at)
values ('site_indexing_enabled', 'false', now())
on conflict (key) do nothing;

-- SECURITY DEFINER so the public sitemap / robots / page head (anon key) can read
-- the one boolean; exp_index_config itself stays admin-only under RLS.
create or replace function public.exp_index_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select lower(btrim(coalesce(c.value, ''))) = 'true'
       from exp_index_config c where c.key = 'site_indexing_enabled'),
    false
  )
$$;

revoke all on function public.exp_index_enabled() from public;
grant execute on function public.exp_index_enabled() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guard: exp_index_guard() was SECURITY DEFINER and checked current_user, which
-- inside a definer function is always the owner, so it always returned true.
-- Check the session / JWT role instead.
-- ---------------------------------------------------------------------------
create or replace function public.exp_index_guard()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if session_user in ('postgres', 'supabase_admin') then
    return true;
  end if;
  if coalesce(auth.role(), '') = 'service_role' then
    return true;
  end if;
  return public.exp_ctrl_has_role(array['super_admin','architect']);
end $$;

revoke all on function public.exp_index_guard() from public;
grant execute on function public.exp_index_guard() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The one floor: template row for (gcid, lane), else ('default', lane), else the
-- built-in floor (BUILTIN_TEMPLATE in profile-render.ts / BUILTIN_FLOOR in
-- src/lib/index-floor.ts).
-- ---------------------------------------------------------------------------
create or replace function public.exp_index_completeness_floor(p_gcid text, p_lane text)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select t.completeness_floor from exp_category_page_template t
      where t.gcid = p_gcid and t.entity_type = p_lane limit 1),
    (select t.completeness_floor from exp_category_page_template t
      where t.gcid = 'default' and t.entity_type = p_lane limit 1),
    case p_lane when 'brand' then 55 else 60 end
  )::integer
$$;

-- Canonical public path per lane (src/lib/index-floor.ts canonicalProfilePath):
-- /p professional, /c brand, /o location.
create or replace function public.exp_index_canonical_path(p_lane text, p_slug text)
returns text
language sql
immutable
as $$
  select case
    when p_slug is null or btrim(p_slug) = '' then null
    when p_lane = 'professional' then '/p/' || p_slug
    when p_lane = 'brand' then '/c/' || p_slug
    else '/o/' || p_slug
  end
$$;

grant execute on function public.exp_index_completeness_floor(text, text) to anon, authenticated, service_role;
grant execute on function public.exp_index_canonical_path(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- exp_index_sync: queue <- search_documents (+ v5 search_rank_scores)
--   score            = v5 total_score when present, else search_documents.rank_score
--   thoroughness_pct = search_documents.completeness_pct
--   state            = 'held' when completeness is unknown or below the floor, or demo;
--                      submitted / indexed stay unless the URL changed;
--                      everything else -> 'pending'
--   lastmod          = source row updated_at (professionals / organizations)
-- p_limit limits how many search_documents rows are processed (newest first);
-- null processes all of them.
-- ---------------------------------------------------------------------------
create or replace function public.exp_index_sync(p_limit int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_ins int := 0;
  n_upd int := 0;
  v_counts jsonb;
begin
  if not public.exp_index_guard() then
    raise exception 'exp_index_sync: not authorized' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('exp_index_sync')) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  create temporary table if not exists _exp_index_sync_src (
    entity_type text,
    entity_id uuid,
    gcid text,
    url text,
    score integer,
    completeness_pct integer,
    floor_pct integer,
    is_demo boolean,
    lastmod timestamptz
  ) on commit drop;
  truncate _exp_index_sync_src;

  insert into _exp_index_sync_src
  with docs as (
    select d.*
      from search_documents d
     where d.entity_id is not null
     order by d.updated_at desc nulls last
     limit p_limit
  ),
  v5 as (
    select distinct on (s.entity_id) s.entity_id, s.total_score
      from search_rank_scores s
      join docs on docs.entity_id = s.entity_id
     order by s.entity_id, s.calculated_at desc nulls last
  )
  select d.entity_type,
         d.entity_id,
         d.gcid,
         exp_index_canonical_path(d.entity_type, d.slug),
         coalesce(v5.total_score::integer, d.rank_score, 0),
         d.completeness_pct,
         exp_index_completeness_floor(d.gcid, d.entity_type),
         coalesce(d.is_demo, false),
         coalesce(p.updated_at, o.updated_at, d.updated_at)
    from docs d
    left join v5 on v5.entity_id = d.entity_id
    left join professionals p on d.entity_type = 'professional' and p.id = d.entity_id
    left join organizations o on d.entity_type <> 'professional' and o.id = d.entity_id;

  -- Missing entities enter the queue (held until they pass the floor).
  insert into exp_index_queue
    (entity_type, entity_id, url, gcid, score, thoroughness_pct, state,
     lastmod, is_demo, completeness_floor, synced_at, created_at)
  select s.entity_type, s.entity_id, s.url, s.gcid, s.score, s.completeness_pct,
         case when s.is_demo or s.completeness_pct is null or s.completeness_pct < s.floor_pct
              then 'held' else 'pending' end,
         s.lastmod, s.is_demo, s.floor_pct, now(), now()
    from _exp_index_sync_src s
   where s.url is not null
     and not exists (
       select 1 from exp_index_queue q
        where q.entity_id = s.entity_id and q.entity_type = s.entity_type
     );
  get diagnostics n_ins = row_count;

  update exp_index_queue q
     set score = s.score,
         thoroughness_pct = s.completeness_pct,
         gcid = s.gcid,
         url = coalesce(s.url, q.url),
         lastmod = s.lastmod,
         is_demo = s.is_demo,
         completeness_floor = s.floor_pct,
         synced_at = now(),
         state = case
           when s.is_demo or s.completeness_pct is null or s.completeness_pct < s.floor_pct
             then 'held'                                   -- the page is noindex: never submit it
           when q.state in ('submitted', 'indexed') and q.url is not distinct from coalesce(s.url, q.url)
             then q.state                                  -- keep; nothing changed that needs resubmission
           else 'pending'                                  -- held / pending / stuck submitting / moved URL
         end,
         submitted_at = case
           when q.state in ('submitted', 'indexed') and q.url is distinct from coalesce(s.url, q.url)
             then null else q.submitted_at end
    from _exp_index_sync_src s
   where q.entity_id = s.entity_id
     and q.entity_type = s.entity_type;
  get diagnostics n_upd = row_count;

  perform public.exp_sitemap_rebuild();

  select jsonb_object_agg(coalesce(state, 'null'), n) into v_counts
    from (select state, count(*) n from exp_index_queue group by state) x;

  insert into exp_index_config (key, value, updated_at)
  values ('last_index_sync', now()::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object(
    'inserted', n_ins,
    'updated', n_upd,
    'states', coalesce(v_counts, '{}'::jsonb),
    'synced_at', now()
  );
end $$;

revoke all on function public.exp_index_sync(int) from public;
grant execute on function public.exp_index_sync(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- exp_sitemap_rebuild: band thresholds from exp_sitemap_partition.
-- Held = state 'held' or demo (the one floor). Bands ordered by min_score; the
-- top band is open above, the lowest indexable band open below
-- (src/lib/index-floor.ts bandForScore uses the same rule).
-- ---------------------------------------------------------------------------
create or replace function public.exp_sitemap_rebuild()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.exp_index_guard() then
    raise exception 'exp_sitemap_rebuild: not authorized' using errcode = '42501';
  end if;

  with bands as (
    select partition_key, coalesce(min_score, 0) as min_score,
           row_number() over (order by coalesce(min_score, 0) asc) = 1 as is_lowest
      from exp_sitemap_partition
     where partition_key in ('priority-high', 'priority-mid', 'priority-low')
  ),
  q as (
    select coalesce(q.score, 0) as score,
           (q.state = 'held' or coalesce(q.is_demo, false)) as held
      from exp_index_queue q
  ),
  keyed as (
    select case
             when q.held then 'held-below-floor'
             else coalesce(
               (select b.partition_key from bands b where q.score >= b.min_score
                 order by b.min_score desc limit 1),
               (select b.partition_key from bands b where b.is_lowest)
             )
           end as k
      from q
  ),
  counts as (
    select k, count(*)::int as n from keyed where k is not null group by k
  ),
  upd as (
    update exp_sitemap_partition p
       set url_count = coalesce((select c.n from counts c where c.k = p.partition_key), 0),
           last_built_at = now()
     where p.partition_key in ('priority-high', 'priority-mid', 'priority-low', 'held-below-floor')
    returning p.partition_key, p.url_count
  )
  select jsonb_object_agg(partition_key, url_count) into v_result from upd;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('built_at', now());
end $$;

revoke all on function public.exp_sitemap_rebuild() from public;
grant execute on function public.exp_sitemap_rebuild() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- exp_index_submit_tick
--   * success state is 'submitted' (a ping is not a crawl confirmation)
--   * no enabled channel -> rows are not touched (they used to stay 'submitting')
--   * IndexNow gets absolute URLs (queue holds paths)
--   * held / demo rows are never taken
--   * Google Indexing API: Google documents it only for JobPosting and
--     BroadcastEvent (livestream) pages. Profile pages are neither, so the call
--     stays OFF unless exp_index_config.google_indexing_enabled = 'true' is set
--     deliberately. The access token still sits in exp_index_config as plaintext;
--     moving it to Vault / a secret is a follow-up (not done here).
-- ---------------------------------------------------------------------------
create or replace function public.exp_index_submit_tick(p_batch int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_key text;
  v_host text;
  v_token text;
  v_google_on boolean;
  v_indexnow_on boolean;
  v_abs text;
  v_req bigint;
  v_ok boolean;
  n_rows int := 0;
  n_sub int := 0;
begin
  if not public.exp_index_guard() then
    raise exception 'exp_index_submit_tick: not authorized' using errcode = '42501';
  end if;
  -- Site-wide switch OFF: no IndexNow, no Google, no log rows, no queue changes.
  if not public.exp_index_enabled() then
    return jsonb_build_object('taken', 0, 'submitted', 0, 'skipped', 'site_indexing_disabled');
  end if;
  if not pg_try_advisory_xact_lock(hashtext('exp_index_submit_tick')) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  select value into v_key   from exp_index_config where key = 'indexnow_key';
  select value into v_host  from exp_index_config where key = 'indexnow_host';
  select value into v_token from exp_index_config where key = 'google_indexing_token';
  select lower(btrim(coalesce(value, ''))) = 'true' into v_google_on
    from exp_index_config where key = 'google_indexing_enabled';
  v_key := nullif(btrim(coalesce(v_key, '')), '');
  v_host := nullif(btrim(coalesce(v_host, '')), '');
  v_token := nullif(btrim(coalesce(v_token, '')), '');
  v_host := regexp_replace(coalesce(v_host, ''), '^https?://', '');
  v_host := nullif(regexp_replace(v_host, '/+$', ''), '');
  v_indexnow_on := v_key is not null and v_host is not null;
  v_google_on := coalesce(v_google_on, false) and v_token is not null;

  if not v_indexnow_on and not v_google_on then
    return jsonb_build_object(
      'taken', 0,
      'submitted', 0,
      'skipped', 'no_enabled_channel',
      'credentials', jsonb_build_object('indexnow', v_indexnow_on, 'google_indexing', v_google_on)
    );
  end if;

  for r in
    select q.id, q.url, q.gcid
      from exp_index_queue q
     where q.state = 'pending'
       and q.url is not null
       and not coalesce(q.is_demo, false)
     order by q.thoroughness_pct desc nulls last, q.score desc nulls last
     limit greatest(1, least(coalesce(p_batch, 200), 1000))
     for update skip locked
  loop
    update exp_index_queue set state = 'submitting' where id = r.id;
    n_rows := n_rows + 1;
    v_ok := false;
    v_abs := case when r.url ~* '^https?://' then r.url else 'https://' || v_host || r.url end;

    if v_indexnow_on then
      begin
        select net.http_post(
          url := 'https://api.indexnow.org/indexnow',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('host', v_host, 'key', v_key, 'urlList', jsonb_build_array(v_abs)),
          timeout_milliseconds := 15000
        ) into v_req;
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'indexnow', 'submitted', null, now());
        n_sub := n_sub + 1;
        v_ok := true;
      exception when others then
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'indexnow', 'error: ' || left(sqlerrm, 120), null, now());
      end;
    end if;

    if v_google_on then
      begin
        select net.http_post(
          url := 'https://indexing.googleapis.com/v3/urlNotifications:publish',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
          body := jsonb_build_object('url', v_abs, 'type', 'URL_UPDATED'),
          timeout_milliseconds := 15000
        ) into v_req;
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'google_indexing', 'submitted', null, now());
        n_sub := n_sub + 1;
        v_ok := true;
      exception when others then
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'google_indexing', 'error: ' || left(sqlerrm, 120), null, now());
      end;
    end if;

    update exp_index_queue
       set state = case when v_ok then 'submitted' else 'pending' end,
           submitted_at = case when v_ok then now() else submitted_at end,
           method = case when not v_ok then method
                         when v_indexnow_on then 'indexnow'
                         else 'google_indexing' end
     where id = r.id;
  end loop;

  return jsonb_build_object(
    'taken', n_rows,
    'submitted', n_sub,
    'credentials', jsonb_build_object('indexnow', v_indexnow_on, 'google_indexing', v_google_on)
  );
end $$;

revoke all on function public.exp_index_submit_tick(int) from public;
grant execute on function public.exp_index_submit_tick(int) to authenticated, service_role;
