
create or replace function public.exp_xmp_top_pros_score(p_brand uuid, p_limit int default 20)
returns table(id uuid, display_name text, slug text, address_city text, address_state text, search_rank_score smallint, claimed boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, coalesce(p.display_name, concat_ws(' ', p.first_name, p.last_name)), p.slug,
         p.address_city, p.address_state, p.search_rank_score, p.claimed
  from professionals p
  join organizations o on o.id = p.primary_org_id and o.parent_org_id = p_brand
  where coalesce(p.search_rank_score, 0) > 0
  order by p.search_rank_score desc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.exp_xmp_top_pros_score(uuid,int) from public;
grant execute on function public.exp_xmp_top_pros_score(uuid,int) to authenticated, service_role;
