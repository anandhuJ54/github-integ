drop function if exists public.search_docs(text,text,text,numeric,boolean,text,int,int);

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
  photo_url text
)
language sql
stable
set search_path = public
as $$
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
$$;

create or replace function public.search_docs_count(
  p_q text default null,
  p_gcid text default null,
  p_loc text default null,
  p_min_rating numeric default null,
  p_claimed boolean default null
)
returns bigint
language sql
stable
set search_path = public
as $$
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
    and (p_claimed is null or coalesce(d.claimed,false) = p_claimed);
$$;

grant execute on function public.search_docs(text,text,text,numeric,boolean,text,int,int) to anon, authenticated, service_role;
grant execute on function public.search_docs_count(text,text,text,numeric,boolean) to anon, authenticated, service_role;