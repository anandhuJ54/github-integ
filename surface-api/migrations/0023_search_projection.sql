-- Live search projection: search_documents stops being a 2026-09-09 snapshot.
--
-- ONE connected system: this rebuilds rows of the existing search_documents table and keeps the
-- existing RPCs (search_docs / _count / _facets / _suggest). No new index, no per-category code.
--
-- What this file adds (ADDITIVE + IDEMPOTENT; nothing dropped, no data written by the file itself):
--   exp_search_num(text)                     immutable: JS Number()-style parse used for geo strings
--   exp_search_completeness_pct(jsonb,text[]) immutable: port of completeness() in profile-render.ts
--   exp_search_projection(uuid[])            read-only: the row search_documents SHOULD hold, per entity
--   exp_search_project(uuid[])               upsert projection into search_documents (keyed entity_type,
--                                            entity_id; no-op rows skipped) + drop rows whose entity is
--                                            gone / inactive. NULL = every entity (incl. new ones).
--   exp_search_dirty                         small dirty queue (entity_id pk)
--   exp_search_enqueue_* + statement triggers on professionals, organizations, aggregate_ratings,
--                                            reviews, graph_nodes, search_rank_scores, credentials
--                                            (transition tables, one INSERT ... SELECT DISTINCT each)
--   exp_search_project_tick(int)             drains the queue in batches (advisory-locked)
--   exp_search_backfill_enqueue()            queues every active entity (batched backfill)
--   exp_search_job_install()                 installs cron job 'search-project-tick' INACTIVE (via
--                                            exp_index_job_install); NOT called here
--   search_docs / _count / _facets / _suggest: same signatures and bodies + AND NOT coalesce(is_demo,false)
--
-- Completeness rule (faithful port of src/lib/profile-render.ts):
--   template  = exp_category_page_template row (gcid, lane), else ('default', lane); if no row or its
--               `sections` is empty, the BUILTIN template (professional/location: hero, about,
--               services, reviews; brand: hero, about, directory).
--   pct       = required.length = 0 ? 100 : round(100 * present / required.length)
--   present   = sectionHasData(section) for each required section, from the same inputs the
--               bundle builders read: core columns, primary office (pros), graph_nodes (is_active),
--               aggregate_ratings ('all' row), reviews, credentials (is_current), content_items
--               (published), exp_voce_article (author id / name), media_items (http url),
--               exp_taxonomy (top 40 product_service/specialization terms by priority), staff
--               (active pros at the org), directory (active child orgs). Unknown section = false.
--   lane      = 'professional' | 'location' | 'brand' (search_documents.entity_type). Existing rows keep
--               their entity_type; new orgs: brand when organizations.entity_type in
--               (brand, enterprise, company, corporate), else location.
--
-- Rank: search_rank_scores row present (v5 scorer) -> rank_score = total_score, score_basis 'v5';
--   else the exp_provisional_score_tick formula (unchanged), score_basis 'provisional'.
--   NB: v5 total_score is out of 850 (ScoreRing SCORE_MAX); provisional can reach 1000.
--
-- Rating: aggregate_ratings source 'all' when present; else review-count-weighted mean of the other
--   sources; else mean / count of reviews rows; else NULL.
-- Languages: professionals.languages, else graph 'language' nodes. Also appended to fts.
-- Geo: pros: office latitude/longitude, else graph 'geo' node (as the renderer); orgs: latitude/longitude.
--
-- Not applied by the author. Apply, then: select exp_search_backfill_enqueue(); and drain with
-- select exp_search_project_tick(2000); repeatedly (or install + activate the cron job).

-- ------------------------------------------------------------------------------------------------
-- 1. Helpers
-- ------------------------------------------------------------------------------------------------

create or replace function public.exp_search_num(p text)
returns double precision
language sql
immutable
set search_path = public
as $$
  select case
    when p ~ '^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$' then btrim(p)::double precision
  end;
$$;

-- completeness(): pct of required sections present (JS Math.round == round() for pct >= 0).
create or replace function public.exp_search_completeness_pct(p_required jsonb, p_present text[])
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_required is null or jsonb_typeof(p_required) <> 'array' or jsonb_array_length(p_required) = 0
      then 100
    else round(
      100.0 * (select count(*) from jsonb_array_elements_text(p_required) s
               where s = any(coalesce(p_present, '{}'::text[])))
      / jsonb_array_length(p_required))::int
  end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 2. Projection (read-only)
-- ------------------------------------------------------------------------------------------------

create or replace function public.exp_search_projection(p_entity_ids uuid[] default null)
returns table(
  entity_type text, entity_id uuid, slug text, gcid text, name text, title text,
  city text, state text, zip text, lat double precision, lng double precision,
  rating numeric, review_count integer, claimed boolean, rank_score integer,
  completeness_pct integer, photo_url text, fts tsvector, is_demo boolean,
  languages text[], score_basis text, sections_present text[]
)
language plpgsql
stable
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $fn$
#variable_conflict use_column
begin
  return query
  with
  pro as (
    select p.* from professionals p
    where p.is_active is not false
      and (p_entity_ids is null or p.id = any(p_entity_ids))
  ),
  org as (
    select o.* from organizations o
    where o.is_active is not false
      and (p_entity_ids is null or o.id = any(p_entity_ids))
  ),
  ent as (
    select 'professional'::text as gtype, pro.id, pro.gcid from pro
    union all
    select 'organization'::text, org.id, org.gcid from org
  ),
  -- graph_nodes signals, one row per entity (renderer: loadGraphSections, is_active = true)
  gn as (
    select g.entity_type as gtype, g.entity_id,
      bool_or(g.node_type in ('service','product_service') and btrim(coalesce(g.title,'')) <> '') as g_services,
      bool_or(g.node_type = 'specialty' and btrim(coalesce(g.title,'')) <> '')               as g_specialties,
      bool_or(g.node_type = 'credential')                                                  as g_cred_any,
      bool_or(g.node_type = 'credential'
              and regexp_replace(coalesce(nullif(g.extracted_data->>'number',''), g.title, ''), '\D', '', 'g') <> '')
                                                                                           as g_cred_keyed,
      bool_or(g.node_type = 'menu_item')                                                   as g_menu,
      bool_or(g.node_type = 'hours')                                                       as g_hours,
      bool_or(g.node_type = 'office_hours'
              and jsonb_typeof(g.extracted_data->'hours') = 'array'
              and exists (select 1 from jsonb_array_elements_text(g.extracted_data->'hours') h where h <> ''))
                                                                                           as g_hours_notes,
      bool_or(g.node_type = 'listing')                                                     as g_listings,
      bool_or(g.node_type = 'gallery_image'
              and coalesce(nullif(g.extracted_data->>'image',''), g.url, '') <> '')        as g_gallery,
      bool_or(g.node_type = 'service_area' and coalesce(g.title,'') <> '')                 as g_service_areas,
      bool_or(g.node_type in ('social_profile','profile_link'))                            as g_social,
      bool_or(g.node_type = 'team_member')                                                 as g_team,
      array_remove(array_agg(distinct nullif(coalesce(nullif(g.extracted_data->>'language',''), g.title, ''), ''))
                   filter (where g.node_type = 'language'), null)                         as g_languages,
      (array_agg(g.extracted_data) filter (where g.node_type = 'profile_attributes'))[1]   as g_attrs,
      (array_agg(nullif(g.extracted_data->>'tz','')) filter (where g.node_type = 'office_hours'))[1] as g_tz,
      (array_agg(coalesce(nullif(g.extracted_data->>'value',''), nullif(g.extracted_data->>'url',''), nullif(g.title,'')))
         filter (where g.node_type = 'bio'))[1]                                            as g_bio,
      (array_agg(coalesce(nullif(g.extracted_data->>'value',''), nullif(g.extracted_data->>'url',''), nullif(g.title,'')))
         filter (where g.node_type = 'contact_phone'))[1]                                  as g_phone,
      (array_agg(coalesce(nullif(g.extracted_data->>'value',''), nullif(g.extracted_data->>'url',''), nullif(g.title,'')))
         filter (where g.node_type = 'contact_email'))[1]                                  as g_email,
      (array_agg(coalesce(nullif(g.extracted_data->>'value',''), nullif(g.extracted_data->>'url',''), nullif(g.title,'')))
         filter (where g.node_type = 'website'))[1]                                        as g_website,
      (array_agg(coalesce(nullif(g.extracted_data->>'url',''), g.url))
         filter (where g.node_type = 'image_photo'))[1]                                    as g_photo,
      (array_agg(nullif(g.extracted_data->>'city',''))  filter (where g.node_type = 'address'))[1] as g_city,
      (array_agg(nullif(g.extracted_data->>'state','')) filter (where g.node_type = 'address'))[1] as g_state,
      (array_agg(coalesce(nullif(g.extracted_data->>'postal_code',''), nullif(g.extracted_data->>'zip','')))
         filter (where g.node_type = 'address'))[1]                                        as g_zip,
      (array_agg(exp_search_num(g.extracted_data->>'latitude'))  filter (where g.node_type = 'geo'))[1] as g_lat,
      (array_agg(exp_search_num(g.extracted_data->>'longitude')) filter (where g.node_type = 'geo'))[1] as g_lng
    from graph_nodes g
    join ent e on e.gtype = g.entity_type and e.id = g.entity_id
    where g.is_active is true
    group by g.entity_type, g.entity_id
  ),
  agg as (
    select a.entity_type as gtype, a.entity_id,
      bool_or(a.source = 'all')                                              as has_all,
      max(a.rating_value) filter (where a.source = 'all')                    as r_all,
      max(a.review_count) filter (where a.source = 'all')                    as c_all,
      sum(a.rating_value * coalesce(a.review_count,0)) filter (where a.source <> 'all' and a.rating_value is not null)
        / nullif(sum(coalesce(a.review_count,0)) filter (where a.source <> 'all' and a.rating_value is not null), 0)
                                                                             as r_weighted,
      sum(coalesce(a.review_count,0)) filter (where a.source <> 'all')       as c_sources
    from aggregate_ratings a
    join ent e on e.gtype = a.entity_type and e.id = a.entity_id
    group by a.entity_type, a.entity_id
  ),
  rv as (
    select r.entity_type as gtype, r.entity_id, avg(r.rating) as r_avg, count(*)::int as n
    from reviews r
    join ent e on e.gtype = r.entity_type and e.id = r.entity_id
    group by r.entity_type, r.entity_id
  ),
  media as (
    select m.entity_type as gtype, m.entity_id
    from media_items m
    join ent e on e.gtype = m.entity_type and e.id = m.entity_id
    where m.is_active is true
      and coalesce(nullif(m.thumbnail_url,''), nullif(m.source_url,''), '') like 'http%'
    group by 1, 2
  ),
  content as (
    select c.author_type as gtype, c.author_id as entity_id
    from content_items c
    join ent e on e.gtype = c.author_type and e.id = c.author_id
    where c.status = 'published'
    group by 1, 2
  ),
  -- loadCategoryServices: top 40 product_service / specialization terms by priority, per gcid
  tax as (
    select x.gcid,
      bool_or(x.level = 'product_service') as t_services,
      bool_or(x.level = 'specialization')  as t_specialties
    from (
      select t.gcid, t.level, t.term,
             row_number() over (partition by t.gcid order by t.priority asc) as rn
      from exp_taxonomy t
      where t.gcid in (select distinct ent.gcid from ent where ent.gcid is not null)
        and t.level in ('product_service','specialization')
    ) x
    where x.rn <= 40 and btrim(coalesce(x.term,'')) <> ''
    group by x.gcid
  ),
  srs as (
    select s.entity_type as gtype, s.entity_id, s.total_score
    from search_rank_scores s
    join ent e on e.gtype = s.entity_type and e.id = s.entity_id
  ),
  -- one flat row of inputs per entity, in renderer terms
  base as (
    select
      'professional'::text as gtype,
      'professional'::text as lane,
      p.id as entity_id, p.slug, p.gcid,
      coalesce(nullif(p.display_name,''), nullif(concat_ws(' ', p.first_name, p.last_name),'')) as name,
      p.job_title as title,
      concat_ws(' ', concat_ws(' ', p.first_name, p.last_name), p.display_name, p.job_title, p.headline) as fts_text,
      coalesce(p.address_city,  off.address_city,  g.g_city)  as city,
      coalesce(p.address_state, off.address_state, g.g_state) as state,
      coalesce(p.address_zip,   off.address_zip,   g.g_zip)   as zip,
      coalesce(exp_search_num(off.latitude::text),  g.g_lat)  as lat,
      coalesce(exp_search_num(off.longitude::text), g.g_lng)  as lng,
      coalesce(p.photo_url, g.g_photo) as photo_url,
      coalesce(p.claimed, false) as claimed,
      coalesce(p.is_demo, false) as is_demo,
      coalesce(nullif(p.languages, '{}'::text[]), g.g_languages, '{}'::text[]) as languages,
      -- about: (p.bio ?? graph bio) truthy, or any fact
      (coalesce(p.bio, g.g_bio, '') <> ''
        or coalesce(p.primary_license_number,'') <> ''
        or coalesce(p.primary_license_state,'') <> ''
        or coalesce(g.g_attrs->>'year_started','') <> ''
        or cardinality(coalesce(g.g_languages,'{}')) > 0
        or coalesce(nullif(g.g_attrs->>'timezone',''), g.g_tz, '') <> '') as s_about,
      (exists (select 1 from credentials c where c.professional_id = p.id and c.is_current is true)
        or coalesce(g.g_cred_keyed,false)
        or coalesce(p.primary_license_number,'') <> '') as s_credentials,
      (coalesce(g.g_service_areas,false) or cardinality(coalesce(p.markets_served,'{}')) > 0) as s_service_areas,
      coalesce(p.phone, g.g_phone, off.phone) as phone,
      coalesce(p.email, g.g_email)            as email,
      coalesce(p.website_url, g.g_website)    as website,
      coalesce(nullif(g.g_attrs->>'prequalify_url',''), nullif(g.g_attrs->>'cta_url','')) as cta_url,
      false as s_staff,
      false as s_directory
    from pro p
    left join organizations off on off.id = p.primary_org_id
    left join gn g on g.gtype = 'professional' and g.entity_id = p.id
    union all
    select
      'organization'::text,
      coalesce(
        (select d.entity_type from search_documents d
          where d.entity_id = o.id and d.entity_type in ('location','brand') limit 1),
        case when lower(coalesce(o.entity_type,'')) in ('brand','enterprise','company','corporate')
             then 'brand' else 'location' end),
      o.id, o.slug, o.gcid,
      coalesce(o.name, ''),
      o.schema_type,
      concat_ws(' ', o.name, o.legal_name, o.schema_type),
      o.address_city, o.address_state, o.address_zip,
      exp_search_num(o.latitude::text), exp_search_num(o.longitude::text),
      o.logo_url,
      coalesce(o.claimed, false),
      coalesce(o.is_demo, false),
      coalesce(g.g_languages, '{}'::text[]),
      (coalesce(o.description,'') <> ''
        or coalesce(o.legal_name,'') <> ''
        or coalesce(g.g_attrs->>'year_started','') <> ''),
      coalesce(g.g_cred_any, false),
      coalesce(g.g_service_areas, false),
      o.phone, o.email, o.website_url,
      coalesce(nullif(g.g_attrs->>'reservation_url',''), nullif(g.g_attrs->>'order_url',''), nullif(g.g_attrs->>'cta_url','')),
      exists (select 1 from professionals sp where sp.primary_org_id = o.id and sp.is_active is true),
      exists (select 1 from organizations co where co.parent_org_id = o.id and co.is_active is true)
    from org o
    left join gn g on g.gtype = 'organization' and g.entity_id = o.id
  ),
  scored as (
    select b.*,
      case when a.has_all then a.r_all
           else coalesce(round(a.r_weighted, 2), round(rv.r_avg, 2)) end as rating,
      case when a.has_all then a.c_all
           else coalesce(nullif(a.c_sources, 0)::int, nullif(rv.n, 0)) end as review_count,
      s.total_score as v5_score,
      array_remove(array[
        -- pros always have a hero name (renderer falls back to the category noun)
        case when b.gtype = 'professional' or coalesce(b.name,'') <> '' then 'hero' end,
        'claim_cta',
        case when b.s_about then 'about' end,
        case when coalesce(t.t_specialties,false) or coalesce(g.g_specialties,false) then 'specialties' end,
        case when b.s_credentials then 'credentials' end,
        case when coalesce(g.g_listings,false) then 'listings' end,
        case when coalesce(g.g_menu,false) then 'menu' end,
        case when coalesce(g.g_hours,false) or coalesce(g.g_hours_notes,false) then 'hours' end,
        case when coalesce(g.g_team,false) then 'team' end,
        case when cardinality(coalesce(g.g_languages,'{}')) > 0 then 'languages' end,
        case when b.s_staff then 'staff' end,
        case when b.s_staff then 'agents_directory' end,
        case when b.s_directory then 'directory' end,
        case when b.s_service_areas then 'service_areas' end,
        case when b.lat is not null and b.lng is not null then 'map' end,
        case when coalesce(g.g_gallery,false) or m.entity_id is not null then 'gallery' end,
        case when rv.n > 0 or coalesce(a.has_all,false) then 'reviews' end,
        case when coalesce(a.has_all,false) then 'aggregate_reputation' end,
        case when c.entity_id is not null
               or exists (select 1 from exp_voce_article va
                           where va.author_entity_id = b.entity_id
                              or (btrim(coalesce(b.name,'')) <> ''
                                  and va.author_name = btrim(regexp_replace(b.name, '[,()]', ' ', 'g'))))
             then 'content' end,
        case when coalesce(g.g_social,false) then 'social' end,
        case when coalesce(b.phone,'') <> '' or coalesce(b.email,'') <> ''
               or coalesce(b.website,'') <> '' or coalesce(b.city,'') <> '' then 'contact' end,
        case when coalesce(t.t_services,false) or coalesce(g.g_services,false) then 'services' end,
        case when coalesce(t.t_services,false) or coalesce(g.g_services,false) then 'coverage_products' end,
        case when coalesce(t.t_services,false) or coalesce(g.g_services,false) then 'loan_products' end,
        case when coalesce(b.cta_url,'') <> '' or coalesce(b.phone,'') <> '' or coalesce(b.website,'') <> ''
             then 'quote_cta' end,
        case when coalesce(b.cta_url,'') <> '' or coalesce(b.phone,'') <> '' or coalesce(b.website,'') <> ''
             then 'reservation_cta' end,
        case when coalesce(b.cta_url,'') <> '' or coalesce(b.phone,'') <> '' or coalesce(b.website,'') <> ''
             then 'order_cta' end,
        case when coalesce(b.cta_url,'') <> '' or coalesce(b.phone,'') <> '' or coalesce(b.website,'') <> ''
             then 'rates_prequalify_cta' end
      ], null) as present
    from base b
    left join gn g      on g.gtype = b.gtype and g.entity_id = b.entity_id
    left join agg a     on a.gtype = b.gtype and a.entity_id = b.entity_id
    left join rv        on rv.gtype = b.gtype and rv.entity_id = b.entity_id
    left join media m   on m.gtype = b.gtype and m.entity_id = b.entity_id
    left join content c on c.gtype = b.gtype and c.entity_id = b.entity_id
    left join tax t     on t.gcid = b.gcid
    left join srs s     on s.gtype = b.gtype and s.entity_id = b.entity_id
  ),
  templ as (
    select sc.*,
      (select coalesce(tp.required_sections, '[]'::jsonb)
         from (
           select ct.required_sections, ct.sections
           from exp_category_page_template ct
           where ct.entity_type = sc.lane
             and ct.gcid in (coalesce(sc.gcid, 'default'), 'default')
           order by (ct.gcid = 'default') asc
           limit 1
         ) tp
        where jsonb_typeof(tp.sections) = 'array' and jsonb_array_length(tp.sections) > 0
      ) as tpl_required
    from scored sc
  ),
  fin as (
    select tm.*,
      exp_search_completeness_pct(
        coalesce(tm.tpl_required,
          case when tm.lane = 'brand' then '["hero","about","directory"]'::jsonb
               else '["hero","about","services","reviews"]'::jsonb end),
        tm.present) as pct
    from templ tm
  )
  select
    f.lane, f.entity_id, f.slug, f.gcid, f.name, f.title,
    f.city, f.state, f.zip, f.lat, f.lng,
    f.rating, f.review_count, f.claimed,
    coalesce(f.v5_score::int,
      round(
          400 * (least(coalesce(f.rating,0),5)/5.0)
        + 250 * least(ln(coalesce(f.review_count,0)+1) / ln(500), 1.0)
        + 250 * (least(coalesce(f.pct,0),100)/100.0)
        + 100 * (case when f.claimed then 1 else 0 end)
      )::int),
    f.pct,
    f.photo_url,
    to_tsvector('english', concat_ws(' ', f.fts_text, f.city, f.state, f.gcid,
                                     array_to_string(f.languages, ' '))),
    f.is_demo,
    f.languages,
    case when f.v5_score is not null then 'v5' else 'provisional' end,
    f.present
  from fin f;
end
$fn$;

-- ------------------------------------------------------------------------------------------------
-- 3. Writer
-- ------------------------------------------------------------------------------------------------

create or replace function public.exp_search_project(p_entity_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
set plan_cache_mode = force_custom_plan
as $fn$
declare
  v_res jsonb;
begin
  if p_entity_ids is not null and cardinality(p_entity_ids) = 0 then
    return jsonb_build_object('seen', 0, 'written', 0, 'deleted', 0);
  end if;

  -- One statement: the projection is computed once; the upsert touches rows IN it, the delete
  -- rows NOT in it (scoped to the batch when ids are given), so the two never overlap.
  with src as (
    select * from exp_search_projection(p_entity_ids)
  ),
  up as (
    insert into search_documents as d
      (entity_type, entity_id, slug, gcid, name, title, city, state, zip, lat, lng,
       rating, review_count, claimed, rank_score, completeness_pct, photo_url, fts,
       is_demo, languages, score_basis, updated_at)
    select s.entity_type, s.entity_id, s.slug, s.gcid, s.name, s.title, s.city, s.state, s.zip,
           s.lat, s.lng, s.rating, s.review_count, s.claimed, s.rank_score, s.completeness_pct,
           s.photo_url, s.fts, s.is_demo, s.languages, s.score_basis, now()
    from src s
    on conflict (entity_type, entity_id) do update set
      slug = excluded.slug, gcid = excluded.gcid, name = excluded.name, title = excluded.title,
      city = excluded.city, state = excluded.state, zip = excluded.zip,
      lat = excluded.lat, lng = excluded.lng, rating = excluded.rating,
      review_count = excluded.review_count, claimed = excluded.claimed,
      rank_score = excluded.rank_score, completeness_pct = excluded.completeness_pct,
      photo_url = excluded.photo_url, fts = excluded.fts, is_demo = excluded.is_demo,
      languages = excluded.languages, score_basis = excluded.score_basis, updated_at = now()
    -- skip no-op writes: updated_at moves only when the row really changed
    where (d.slug, d.gcid, d.name, d.title, d.city, d.state, d.zip, d.lat, d.lng, d.rating,
           d.review_count, d.claimed, d.rank_score, d.completeness_pct, d.photo_url, d.fts,
           d.is_demo, d.languages, d.score_basis)
      is distinct from
          (excluded.slug, excluded.gcid, excluded.name, excluded.title, excluded.city,
           excluded.state, excluded.zip, excluded.lat, excluded.lng, excluded.rating,
           excluded.review_count, excluded.claimed, excluded.rank_score, excluded.completeness_pct,
           excluded.photo_url, excluded.fts, excluded.is_demo, excluded.languages, excluded.score_basis)
    returning 1
  ),
  -- rows whose entity no longer exists or is inactive.
  -- Safety: only targeted runs (explicit p_entity_ids) may delete; a full rebuild
  -- (p_entity_ids is null) never deletes, so a projection bug cannot wipe search.
  del as (
    delete from search_documents d
    where p_entity_ids is not null and d.entity_id = any(p_entity_ids)
      and not exists (select 1 from src s
                       where s.entity_id = d.entity_id and s.entity_type = d.entity_type)
    returning 1
  )
  select jsonb_build_object(
    'seen',    (select count(*) from src),
    'written', (select count(*) from up),
    'deleted', (select count(*) from del))
  into v_res;

  return v_res;
end
$fn$;

-- ------------------------------------------------------------------------------------------------
-- 4. Dirty queue + statement-level triggers (one INSERT ... SELECT DISTINCT per statement)
-- ------------------------------------------------------------------------------------------------

-- search_documents has (entity_type, entity_id) unique; batch deletes / lookups go by entity_id alone.
create index if not exists search_documents_entity_id_idx on public.search_documents (entity_id);

create table if not exists public.exp_search_dirty (
  entity_id uuid primary key,
  queued_at timestamptz not null default now(),
  source    text
);
create index if not exists exp_search_dirty_queued_at_idx on public.exp_search_dirty (queued_at);
alter table public.exp_search_dirty enable row level security;
revoke all on table public.exp_search_dirty from anon, authenticated;
grant all on table public.exp_search_dirty to service_role;

-- professionals: the pro + its office (old and new) — office 'staff' depends on its pros.
create or replace function public.exp_search_enqueue_professionals()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('INSERT','UPDATE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct x, 'professionals' from (
      select n.id as x from new_rows n
      union select n.primary_org_id from new_rows n
    ) s where x is not null
    on conflict (entity_id) do nothing;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct x, 'professionals' from (
      select o.id as x from old_rows o
      union select o.primary_org_id from old_rows o
    ) s where x is not null
    on conflict (entity_id) do nothing;
  end if;
  return null;
end $fn$;

-- organizations: the org, its parent (directory) and its pros (office city / geo / phone fallback).
create or replace function public.exp_search_enqueue_organizations()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('INSERT','UPDATE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct x, 'organizations' from (
      select n.id as x from new_rows n
      union select n.parent_org_id from new_rows n
      union select p.id from professionals p join new_rows n on p.primary_org_id = n.id
    ) s where x is not null
    on conflict (entity_id) do nothing;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct x, 'organizations' from (
      select o.id as x from old_rows o
      union select o.parent_org_id from old_rows o
    ) s where x is not null
    on conflict (entity_id) do nothing;
  end if;
  return null;
end $fn$;

-- Generic: tables keyed by entity_id (aggregate_ratings, reviews, graph_nodes, search_rank_scores).
create or replace function public.exp_search_enqueue_entity_id()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('INSERT','UPDATE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct n.entity_id, tg_table_name from new_rows n
    where n.entity_id is not null and n.entity_type in ('professional','organization')
    on conflict (entity_id) do nothing;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct o.entity_id, tg_table_name from old_rows o
    where o.entity_id is not null and o.entity_type in ('professional','organization')
    on conflict (entity_id) do nothing;
  end if;
  return null;
end $fn$;

create or replace function public.exp_search_enqueue_credentials()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('INSERT','UPDATE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct n.professional_id, 'credentials' from new_rows n where n.professional_id is not null
    on conflict (entity_id) do nothing;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    insert into exp_search_dirty (entity_id, source)
    select distinct o.professional_id, 'credentials' from old_rows o where o.professional_id is not null
    on conflict (entity_id) do nothing;
  end if;
  return null;
end $fn$;

revoke all on function public.exp_search_enqueue_professionals() from public, anon, authenticated;
revoke all on function public.exp_search_enqueue_organizations() from public, anon, authenticated;
revoke all on function public.exp_search_enqueue_entity_id() from public, anon, authenticated;
revoke all on function public.exp_search_enqueue_credentials() from public, anon, authenticated;

-- Transition tables allow one event per trigger, so three triggers per table.
do $do$
declare
  t record;
begin
  for t in
    select * from (values
      ('professionals',      'exp_search_enqueue_professionals'),
      ('organizations',      'exp_search_enqueue_organizations'),
      ('aggregate_ratings',  'exp_search_enqueue_entity_id'),
      ('reviews',            'exp_search_enqueue_entity_id'),
      ('graph_nodes',        'exp_search_enqueue_entity_id'),
      ('search_rank_scores', 'exp_search_enqueue_entity_id'),
      ('credentials',        'exp_search_enqueue_credentials')
    ) v(tbl, fn)
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_search_dirty_ins_' || t.tbl, t.tbl);
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows '
                   'for each statement execute function public.%I()',
                   'trg_search_dirty_ins_' || t.tbl, t.tbl, t.fn);
    execute format('drop trigger if exists %I on public.%I', 'trg_search_dirty_upd_' || t.tbl, t.tbl);
    execute format('create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows '
                   'for each statement execute function public.%I()',
                   'trg_search_dirty_upd_' || t.tbl, t.tbl, t.fn);
    execute format('drop trigger if exists %I on public.%I', 'trg_search_dirty_del_' || t.tbl, t.tbl);
    execute format('create trigger %I after delete on public.%I referencing old table as old_rows '
                   'for each statement execute function public.%I()',
                   'trg_search_dirty_del_' || t.tbl, t.tbl, t.fn);
  end loop;
end
$do$;

-- ------------------------------------------------------------------------------------------------
-- 5. Tick, backfill, inactive cron installer
-- ------------------------------------------------------------------------------------------------

create or replace function public.exp_search_project_tick(p_batch integer default 2000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ids uuid[];
  v_res jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('exp_search_project_tick')) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  with pick as (
    select q.entity_id from exp_search_dirty q
    order by q.queued_at
    limit greatest(1, least(coalesce(p_batch, 2000), 10000))
    for update skip locked
  ),
  del as (
    delete from exp_search_dirty q using pick
    where q.entity_id = pick.entity_id
    returning q.entity_id
  )
  select array_agg(del.entity_id) into v_ids from del;

  if v_ids is null then
    return jsonb_build_object('taken', 0, 'remaining', 0);
  end if;

  v_res := exp_search_project(v_ids);
  return v_res || jsonb_build_object(
    'taken', cardinality(v_ids),
    'remaining', (select count(*) from exp_search_dirty));
end
$fn$;

create or replace function public.exp_search_backfill_enqueue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare n int;
begin
  insert into exp_search_dirty (entity_id, source)
  select x.id, 'backfill' from (
    select p.id from professionals p
    union select o.id from organizations o
    union select d.entity_id from search_documents d where d.entity_id is not null
  ) x
  on conflict (entity_id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('queued', n, 'pending', (select count(*) from exp_search_dirty));
end
$fn$;

create or replace function public.exp_search_job_install()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.exp_index_job_install(
    'search-project-tick', '* * * * *', 'select public.exp_search_project_tick(2000);');
$$;

revoke all on function public.exp_search_num(text) from public, anon;
revoke all on function public.exp_search_completeness_pct(jsonb, text[]) from public, anon;
revoke all on function public.exp_search_projection(uuid[]) from public, anon, authenticated;
revoke all on function public.exp_search_project(uuid[]) from public, anon, authenticated;
revoke all on function public.exp_search_project_tick(integer) from public, anon, authenticated;
revoke all on function public.exp_search_backfill_enqueue() from public, anon, authenticated;
revoke all on function public.exp_search_job_install() from public, anon, authenticated;
grant execute on function public.exp_search_projection(uuid[]) to service_role;
grant execute on function public.exp_search_project(uuid[]) to service_role;
grant execute on function public.exp_search_project_tick(integer) to service_role;
grant execute on function public.exp_search_backfill_enqueue() to service_role;
grant execute on function public.exp_search_job_install() to service_role;

-- ------------------------------------------------------------------------------------------------
-- 6. Public search RPCs: identical to the live definitions (pg_get_functiondef, 2026-10-11)
--    except AND NOT coalesce(d.is_demo, false). Signatures, defaults, volatility unchanged.
-- ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_docs(p_q text DEFAULT NULL::text, p_gcid text DEFAULT NULL::text, p_loc text DEFAULT NULL::text, p_min_rating numeric DEFAULT NULL::numeric, p_claimed boolean DEFAULT NULL::boolean, p_sort text DEFAULT 'relevance'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, entity_type text, entity_id uuid, slug text, gcid text, name text, title text, city text, state text, zip text, lat double precision, lng double precision, rating numeric, review_count integer, claimed boolean, rank_score integer, completeness_pct integer, photo_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select d.id, d.entity_type, d.entity_id, d.slug, d.gcid, d.name, d.title,
         d.city, d.state, d.zip, d.lat, d.lng,
         d.rating, d.review_count, d.claimed, d.rank_score, d.completeness_pct,
         d.photo_url
  from search_documents d
  where (nullif(btrim(coalesce(p_q,'')),'') is null
         or d.fts @@ websearch_to_tsquery('english', btrim(p_q))
         or d.name ilike '%' || btrim(p_q) || '%')
    and (p_gcid is null or p_gcid = '' or d.gcid = p_gcid)
    and (nullif(btrim(coalesce(p_loc,'')),'') is null
         or d.city ilike btrim(p_loc) || '%'
         or d.zip = btrim(p_loc)
         or d.state ilike btrim(p_loc))
    and (p_min_rating is null or d.rating >= p_min_rating)
    and (p_claimed is null or coalesce(d.claimed,false) = p_claimed)
    and not coalesce(d.is_demo, false)
  order by
    (case when p_sort = 'rating' then d.rating end) desc nulls last,
    (case when p_sort = 'reviews' then d.review_count end) desc nulls last,
    (case when p_sort = 'complete' then d.completeness_pct end) desc nulls last,
    (case when p_sort = 'relevance' and nullif(btrim(coalesce(p_q,'')),'') is not null
          then ts_rank(d.fts, websearch_to_tsquery('english', btrim(p_q))) end) desc nulls last,
    d.rank_score desc nulls last,
    d.name asc
  limit greatest(1, least(coalesce(p_limit,20), 50))
  offset greatest(0, coalesce(p_offset,0));
$function$;

CREATE OR REPLACE FUNCTION public.search_docs_count(p_q text DEFAULT NULL::text, p_gcid text DEFAULT NULL::text, p_loc text DEFAULT NULL::text, p_min_rating numeric DEFAULT NULL::numeric, p_claimed boolean DEFAULT NULL::boolean)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)
  from search_documents d
  where (nullif(btrim(coalesce(p_q,'')),'') is null
         or d.fts @@ websearch_to_tsquery('english', btrim(p_q))
         or d.name ilike '%' || btrim(p_q) || '%')
    and (p_gcid is null or p_gcid = '' or d.gcid = p_gcid)
    and (nullif(btrim(coalesce(p_loc,'')),'') is null
         or d.city ilike btrim(p_loc) || '%'
         or d.zip = btrim(p_loc)
         or d.state ilike btrim(p_loc))
    and (p_min_rating is null or d.rating >= p_min_rating)
    and (p_claimed is null or coalesce(d.claimed,false) = p_claimed)
    and not coalesce(d.is_demo, false);
$function$;

CREATE OR REPLACE FUNCTION public.search_docs_facets(p_q text DEFAULT NULL::text, p_gcid text DEFAULT NULL::text, p_loc text DEFAULT NULL::text, p_min_rating numeric DEFAULT NULL::numeric, p_claimed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with p as (
    select nullif(btrim(coalesce(p_q,'')),'') as q,
           nullif(btrim(coalesce(p_loc,'')),'') as loc
  ),
  base as (
    select d.gcid, d.city, d.state, d.zip, d.rating, d.claimed, d.entity_type
    from search_documents d cross join p
    where (p.q is null
           or d.fts @@ websearch_to_tsquery('english', p.q)
           or d.name ilike '%' || p.q || '%')
      and not coalesce(d.is_demo, false)
  ),
  loc_ok as (
    select b.*,
      (select loc from p) is null
      or b.city ilike (select loc from p) || '%'
      or b.zip = (select loc from p)
      or b.state ilike (select loc from p) as ok
    from base b
  ),
  f as (
    select l.*,
      (p_gcid is null or l.gcid = p_gcid) as gcid_ok,
      (p_min_rating is null or l.rating >= p_min_rating) as rating_ok,
      (p_claimed is null or coalesce(l.claimed,false) = p_claimed) as claimed_ok
    from loc_ok l
  ),
  cat as (
    select f.gcid, count(*) as n
    from f
    where f.ok and f.rating_ok and f.claimed_ok and f.gcid is not null
    group by f.gcid
    order by count(*) desc
    limit 12
  ),
  cities as (
    select f.city, f.state, count(*) as n
    from f
    where f.gcid_ok and f.rating_ok and f.claimed_ok and f.city is not null
    group by f.city, f.state
    order by count(*) desc
    limit 12
  ),
  rat as (
    select
      count(*) filter (where f.rating >= 4.5) as r45,
      count(*) filter (where f.rating >= 4.0) as r40,
      count(*) filter (where f.rating >= 3.0) as r30
    from f
    where f.ok and f.gcid_ok and f.claimed_ok
  ),
  clm as (
    select
      count(*) filter (where coalesce(f.claimed,false)) as yes,
      count(*) filter (where not coalesce(f.claimed,false)) as no
    from f
    where f.ok and f.gcid_ok and f.rating_ok
  ),
  kinds as (
    select f.entity_type, count(*) as n
    from f
    where f.ok and f.gcid_ok and f.rating_ok and f.claimed_ok
    group by f.entity_type
  )
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gcid', cat.gcid,
        'label', coalesce(g.display_name, cat.gcid),
        'count', cat.n) order by cat.n desc)
      from cat left join gbp_categories g on g.gcid = cat.gcid), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('city', city, 'state', state, 'count', n) order by n desc)
      from cities), '[]'::jsonb),
    'ratings', (select jsonb_build_object('r45', r45, 'r40', r40, 'r30', r30) from rat),
    'claimed', (select jsonb_build_object('yes', yes, 'no', no) from clm),
    'kinds', coalesce((select jsonb_agg(jsonb_build_object('entity_type', entity_type, 'count', n) order by n desc) from kinds), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.search_docs_suggest(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(id uuid, entity_type text, slug text, gcid text, name text, title text, city text, state text, photo_url text, rank_score integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select d.id, d.entity_type, d.slug, d.gcid, d.name, d.title, d.city, d.state,
         d.photo_url, d.rank_score
  from search_documents d
  where nullif(btrim(coalesce(p_q,'')),'') is not null
    and (d.name ilike '%' || btrim(p_q) || '%'
         or d.fts @@ websearch_to_tsquery('english', btrim(p_q)))
    and not coalesce(d.is_demo, false)
  order by similarity(d.name, btrim(p_q)) desc, d.rank_score desc nulls last
  limit greatest(1, least(coalesce(p_limit,8), 20));
$function$;
