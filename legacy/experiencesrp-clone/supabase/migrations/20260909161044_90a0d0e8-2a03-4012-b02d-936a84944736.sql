create table if not exists public.exp_index_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.exp_index_config to authenticated;
grant all on public.exp_index_config to service_role;
alter table public.exp_index_config enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='exp_index_config' and policyname='index_config_admin') then
    create policy index_config_admin on public.exp_index_config
      for all to authenticated
      using (public.exp_ctrl_has_role(array['super_admin','architect']))
      with check (public.exp_ctrl_has_role(array['super_admin','architect']));
  end if;
end $$;

create or replace function public.exp_sitemap_rebuild()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_high int; v_mid int; v_low int; v_held int;
begin
  select
    count(*) filter (where not held and score >= 650),
    count(*) filter (where not held and score between 450 and 649),
    count(*) filter (where not held and score between 1 and 449),
    count(*) filter (where held)
  into v_high, v_mid, v_low, v_held
  from (
    select coalesce(q.score, 0) as score,
           (q.state = 'held' or q.score is null or q.score <= 0) as held
      from exp_index_queue q
  ) s;

  update exp_sitemap_partition set url_count = v_high, last_built_at = now() where partition_key = 'priority-high';
  update exp_sitemap_partition set url_count = v_mid,  last_built_at = now() where partition_key = 'priority-mid';
  update exp_sitemap_partition set url_count = v_low,  last_built_at = now() where partition_key = 'priority-low';
  update exp_sitemap_partition set url_count = v_held, last_built_at = now() where partition_key = 'held-below-floor';

  return jsonb_build_object(
    'priority-high', v_high,
    'priority-mid', v_mid,
    'priority-low', v_low,
    'held-below-floor', v_held,
    'built_at', now()
  );
end $$;

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
  v_req bigint;
  n_rows int := 0;
  n_sub int := 0;
  n_nocred int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('exp_index_submit_tick')) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  select value into v_key   from exp_index_config where key = 'indexnow_key';
  select value into v_host  from exp_index_config where key = 'indexnow_host';
  select value into v_token from exp_index_config where key = 'google_indexing_token';
  v_key := nullif(btrim(coalesce(v_key, '')), '');
  v_host := nullif(btrim(coalesce(v_host, '')), '');
  v_token := nullif(btrim(coalesce(v_token, '')), '');

  for r in
    select q.id, q.url, q.gcid
      from exp_index_queue q
     where q.state = 'pending'
       and q.url is not null
     order by q.thoroughness_pct desc nulls last, q.score desc nulls last
     limit greatest(1, least(coalesce(p_batch, 200), 1000))
     for update skip locked
  loop
    update exp_index_queue set state = 'submitting' where id = r.id;
    n_rows := n_rows + 1;

    if v_key is not null and v_host is not null then
      begin
        select net.http_post(
          url := 'https://api.indexnow.org/indexnow',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('host', v_host, 'key', v_key, 'urlList', jsonb_build_array(r.url)),
          timeout_milliseconds := 15000
        ) into v_req;
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'indexnow', 'submitted', null, now());
        n_sub := n_sub + 1;
      exception when others then
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'indexnow', 'error: ' || left(sqlerrm, 120), null, now());
      end;
    else
      insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
      values (r.url, r.gcid, 'indexnow', 'queued_no_credential', null, now());
      n_nocred := n_nocred + 1;
    end if;

    if v_token is not null then
      begin
        select net.http_post(
          url := 'https://indexing.googleapis.com/v3/urlNotifications:publish',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
          body := jsonb_build_object('url', r.url, 'type', 'URL_UPDATED'),
          timeout_milliseconds := 15000
        ) into v_req;
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'google_indexing', 'submitted', null, now());
        n_sub := n_sub + 1;
      exception when others then
        insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
        values (r.url, r.gcid, 'google_indexing', 'error: ' || left(sqlerrm, 120), null, now());
      end;
    else
      insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
      values (r.url, r.gcid, 'google_indexing', 'queued_no_credential', null, now());
      n_nocred := n_nocred + 1;
    end if;

    if v_token is not null or (v_key is not null and v_host is not null) then
      update exp_index_queue
         set state = 'indexed',
             submitted_at = now(),
             method = case when v_key is not null and v_host is not null then 'indexnow' else 'google_indexing' end
       where id = r.id;
    end if;
  end loop;

  return jsonb_build_object(
    'taken', n_rows,
    'submitted', n_sub,
    'queued_no_credential', n_nocred,
    'credentials', jsonb_build_object(
      'indexnow', (v_key is not null and v_host is not null),
      'google_indexing', v_token is not null
    )
  );
end $$;

create or replace function public.exp_index_recrawl(p_entity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0; r record;
begin
  for r in select id, url, gcid from exp_index_queue where entity_id = p_entity_id loop
    update exp_index_queue
       set state = 'pending', submitted_at = null
     where id = r.id;
    insert into exp_index_submission_log (url, gcid, method, event, http_status, submitted_at)
    values (r.url, r.gcid, 'queue', 'recrawl', null, now());
    n := n + 1;
  end loop;
  return jsonb_build_object('requeued', n);
end $$;

revoke all on function public.exp_sitemap_rebuild() from public;
revoke all on function public.exp_index_submit_tick(int) from public;
revoke all on function public.exp_index_recrawl(uuid) from public;
grant execute on function public.exp_sitemap_rebuild() to authenticated, service_role;
grant execute on function public.exp_index_submit_tick(int) to authenticated, service_role;
grant execute on function public.exp_index_recrawl(uuid) to authenticated, service_role;