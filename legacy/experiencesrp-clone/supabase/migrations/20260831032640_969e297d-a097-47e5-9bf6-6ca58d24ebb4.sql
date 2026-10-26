
create or replace function public.exp_xmp_brand_overview(p_brand uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with off as (
    select id, search_rank_score, claimed, address_state
    from organizations where parent_org_id = p_brand
  ),
  pro as (
    select p.id, p.search_rank_score, p.claimed, p.bio, p.photo_url, p.gbp_place_id
    from professionals p where p.primary_org_id in (select id from off)
  ),
  prod as (
    select count(distinct g.entity_id) c
    from graph_nodes g
    where g.source = 'etl' and g.node_type = 'product_service'
      and g.entity_id in (select id from pro)
  )
  select jsonb_build_object(
    'offices', (select count(*) from off),
    'offices_claimed', (select count(*) from off where claimed),
    'offices_scored', (select count(*) from off where coalesce(search_rank_score,0) > 0),
    'avg_office_score', (select round(avg(search_rank_score)::numeric,1) from off where coalesce(search_rank_score,0) > 0),
    'pros', (select count(*) from pro),
    'pros_claimed', (select count(*) from pro where claimed),
    'pros_scored', (select count(*) from pro where coalesce(search_rank_score,0) > 0),
    'avg_pro_score', (select round(avg(search_rank_score)::numeric,1) from pro where coalesce(search_rank_score,0) > 0),
    'pros_bio', (select count(*) from pro where coalesce(bio,'') <> ''),
    'pros_photo', (select count(*) from pro where coalesce(photo_url,'') <> ''),
    'pros_place_id', (select count(*) from pro where coalesce(gbp_place_id,'') <> ''),
    'pros_products', (select c from prod),
    'reviews_pro', (select count(*) from reviews r where r.entity_type = 'professional' and r.entity_id in (select id from pro)),
    'states', (select count(distinct address_state) from off where coalesce(address_state,'') <> '')
  );
$$;

create or replace function public.exp_xmp_state_rollup(p_brand uuid, p_limit int default 60)
returns table(state text, offices bigint, pros bigint, claimed bigint, with_bio bigint, with_photo bigint, reviews bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with off as (
    select id, coalesce(nullif(address_state,''),'—') st
    from organizations where parent_org_id = p_brand
  ),
  pro as (
    select p.id, o.st, p.claimed, p.bio, p.photo_url
    from professionals p join off o on o.id = p.primary_org_id
  )
  select o.st,
    count(distinct o.id),
    (select count(*) from pro where pro.st = o.st),
    (select count(*) from pro where pro.st = o.st and pro.claimed),
    (select count(*) from pro where pro.st = o.st and coalesce(pro.bio,'') <> ''),
    (select count(*) from pro where pro.st = o.st and coalesce(pro.photo_url,'') <> ''),
    (select count(*) from reviews r where r.entity_type = 'professional' and r.entity_id in (select id from pro where pro.st = o.st))
  from off o
  group by o.st
  order by count(distinct o.id) desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.exp_xmp_offices_page(
  p_brand uuid,
  p_q text default null,
  p_state text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table(
  id uuid, name text, slug text, address_city text, address_state text,
  search_rank_score smallint, claimed boolean, pro_count bigint, total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with off as (
    select o.id, o.name, o.slug, o.address_city, o.address_state, o.search_rank_score, o.claimed
    from organizations o
    where o.parent_org_id = p_brand
      and (p_state is null or p_state = '' or o.address_state = p_state)
      and (
        p_q is null or p_q = ''
        or o.name ilike '%' || p_q || '%'
        or o.address_city ilike '%' || p_q || '%'
        or o.address_state ilike '%' || p_q || '%'
      )
  ),
  page as (
    select * from off order by name limit greatest(p_limit,1) offset greatest(p_offset,0)
  )
  select p.id, p.name, p.slug, p.address_city, p.address_state, p.search_rank_score, p.claimed,
    (select count(*) from professionals pr where pr.primary_org_id = p.id) as pro_count,
    (select count(*) from off) as total_count
  from page p
  order by p.name;
$$;

create or replace function public.exp_xmp_top_depth(p_brand uuid, p_limit int default 20)
returns table(id uuid, display_name text, slug text, address_city text, address_state text, node_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, coalesce(p.display_name, concat_ws(' ', p.first_name, p.last_name)), p.slug,
         p.address_city, p.address_state, count(g.id)
  from professionals p
  join organizations o on o.id = p.primary_org_id and o.parent_org_id = p_brand
  join graph_nodes g on g.entity_id = p.id and g.is_active
  group by p.id, p.display_name, p.first_name, p.last_name, p.slug, p.address_city, p.address_state
  order by count(g.id) desc
  limit greatest(p_limit,1);
$$;

create or replace function public.exp_xmp_top_reviews(p_brand uuid, p_limit int default 20)
returns table(id uuid, display_name text, slug text, review_count bigint, avg_rating numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, coalesce(p.display_name, concat_ws(' ', p.first_name, p.last_name)), p.slug,
         count(r.id), round(avg(r.rating)::numeric, 2)
  from professionals p
  join organizations o on o.id = p.primary_org_id and o.parent_org_id = p_brand
  join reviews r on r.entity_type = 'professional' and r.entity_id = p.id
  group by p.id, p.display_name, p.first_name, p.last_name, p.slug
  order by count(r.id) desc
  limit greatest(p_limit,1);
$$;

revoke all on function public.exp_xmp_brand_overview(uuid) from public;
revoke all on function public.exp_xmp_state_rollup(uuid,int) from public;
revoke all on function public.exp_xmp_offices_page(uuid,text,text,int,int) from public;
revoke all on function public.exp_xmp_top_depth(uuid,int) from public;
revoke all on function public.exp_xmp_top_reviews(uuid,int) from public;

grant execute on function public.exp_xmp_brand_overview(uuid) to authenticated, service_role;
grant execute on function public.exp_xmp_state_rollup(uuid,int) to authenticated, service_role;
grant execute on function public.exp_xmp_offices_page(uuid,text,text,int,int) to authenticated, service_role;
grant execute on function public.exp_xmp_top_depth(uuid,int) to authenticated, service_role;
grant execute on function public.exp_xmp_top_reviews(uuid,int) to authenticated, service_role;
