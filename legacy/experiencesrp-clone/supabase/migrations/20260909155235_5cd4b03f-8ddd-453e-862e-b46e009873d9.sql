create extension if not exists pg_trgm;

create or replace function public.search_docs(
  p_q text default null,
  p_gcid text default null,
  p_loc text default null,
  p_min_rating numeric default null,
  p_claimed boolean default null,
  p_sort text default 'relevance',
  p_limit int default 20,
  p_offset int default 0
)
returns table(
  id uuid, entity_type text, entity_id uuid, slug text, gcid text, name text, title text,
  city text, state text, zip text, lat double precision, lng double precision,
  rating numeric, review_count int, claimed boolean, rank_score int, completeness_pct int,
  photo_url text, total_count bigint
)
language sql
stable
set search_path = public
as $$
  with p as (
    select nullif(btrim(coalesce(p_q,'')),'') as q,
           nullif(btrim(coalesce(p_loc,'')),'') as loc
  ),
  base as (
    select d.*,
      case when p.q is null then 0::real
           else ts_rank(d.fts, websearch_to_tsquery('english', p.q)) end as rel
    from search_documents d cross join p
    where (p.q is null
           or d.fts @@ websearch_to_tsquery('english', p.q)
           or d.name ilike '%' || p.q || '%')
      and (p_gcid is null or d.gcid = p_gcid)
      and (p.loc is null
           or d.city ilike p.loc || '%'
           or d.zip = p.loc
           or d.state ilike p.loc)
      and (p_min_rating is null or d.rating >= p_min_rating)
      and (p_claimed is null or coalesce(d.claimed,false) = p_claimed)
  ),
  c as (select count(*) as n from base)
  select b.id, b.entity_type, b.entity_id, b.slug, b.gcid, b.name, b.title,
         b.city, b.state, b.zip, b.lat, b.lng,
         b.rating, b.review_count, b.claimed, b.rank_score, b.completeness_pct,
         b.photo_url, c.n
  from base b cross join c
  order by
    (case when p_sort = 'rating' then b.rating end) desc nulls last,
    (case when p_sort = 'reviews' then b.review_count end) desc nulls last,
    (case when p_sort = 'complete' then b.completeness_pct end) desc nulls last,
    (case when p_sort = 'relevance' then b.rel end) desc nulls last,
    b.rank_score desc nulls last,
    b.name asc
  limit greatest(1, least(coalesce(p_limit,20), 50))
  offset greatest(0, coalesce(p_offset,0));
$$;

create or replace function public.search_docs_facets(
  p_q text default null,
  p_gcid text default null,
  p_loc text default null,
  p_min_rating numeric default null,
  p_claimed boolean default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
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
$$;

create or replace function public.search_docs_suggest(
  p_q text,
  p_limit int default 8
)
returns table(
  id uuid, entity_type text, slug text, gcid text, name text, title text,
  city text, state text, photo_url text, rank_score int
)
language sql
stable
set search_path = public
as $$
  select d.id, d.entity_type, d.slug, d.gcid, d.name, d.title, d.city, d.state,
         d.photo_url, d.rank_score
  from search_documents d
  where nullif(btrim(coalesce(p_q,'')),'') is not null
    and (d.name ilike '%' || btrim(p_q) || '%'
         or d.fts @@ websearch_to_tsquery('english', btrim(p_q)))
  order by similarity(d.name, btrim(p_q)) desc, d.rank_score desc nulls last
  limit greatest(1, least(coalesce(p_limit,8), 20));
$$;

grant execute on function public.search_docs(text,text,text,numeric,boolean,text,int,int) to anon, authenticated, service_role;
grant execute on function public.search_docs_facets(text,text,text,numeric,boolean) to anon, authenticated, service_role;
grant execute on function public.search_docs_suggest(text,int) to anon, authenticated, service_role;