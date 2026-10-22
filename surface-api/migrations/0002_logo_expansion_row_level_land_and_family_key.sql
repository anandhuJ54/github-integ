-- Row-level revenue → logo, keyed by the territory family key that owns the logo
-- (so 'insurance' and 'insurance_agency' revenue both roll into the same State Farm logo).
create or replace view public.v_logo_revenue as
select
  t.group_key,
  tb.org_id,
  o.name as org_name,
  rc.id as revenue_id,
  rc.period_start,
  date_trunc('month', rc.period_start)::date as month_start,
  extract(year from rc.period_start)::int as year,
  rc.source,
  rc.amount::numeric as amount,
  rc.created_at
from public.exp_revenue_components rc
join public.exp_territories t
  on t.group_key = rc.group_key
  or t.group_key like rc.group_key || '\_%'
  or rc.group_key like t.group_key || '\_%'
join public.exp_territory_brand tb on tb.territory_id = t.id
join public.organizations o on o.id = tb.org_id;

grant select on public.v_logo_revenue to authenticated;
grant select on public.v_logo_revenue to service_role;

create or replace view public.v_logo_revenue_month as
select group_key, org_id, org_name, month_start, year, sum(amount)::numeric as amount
from public.v_logo_revenue
group by 1, 2, 3, 4, 5;

create or replace view public.v_logo_expansion as
with prior as (
  select group_key, org_id, year, sum(amount)::numeric as ytd_revenue
  from public.v_logo_revenue group by 1, 2, 3
),
firsts as (
  select group_key, org_id, min(year) as first_year, min(period_start) as first_booking_at
  from public.v_logo_revenue group by 1, 2
),
land as (
  select distinct on (group_key, org_id)
    group_key, org_id, amount as land_amount
  from public.v_logo_revenue
  order by group_key, org_id, period_start, created_at, revenue_id
),
calc as (
  select
    p.group_key,
    p.org_id,
    p.year,
    p.ytd_revenue,
    f.first_booking_at,
    coalesce((select sum(p2.ytd_revenue) from prior p2
      where p2.group_key = p.group_key and p2.org_id = p.org_id and p2.year < p.year), 0)::numeric as baseline,
    case when p.year = f.first_year then l.land_amount else 0 end::numeric as new_revenue
  from prior p
  join firsts f on f.group_key = p.group_key and f.org_id = p.org_id
  join land l on l.group_key = p.group_key and l.org_id = p.org_id
)
select
  c.group_key,
  c.org_id,
  o.name as org_name,
  c.year,
  c.first_booking_at,
  c.baseline,
  c.ytd_revenue,
  c.new_revenue,
  (c.ytd_revenue - c.baseline - c.new_revenue)::numeric as expansion_revenue,
  round(
    (c.ytd_revenue - c.baseline - c.new_revenue)
    / nullif(coalesce(nullif(c.baseline, 0), c.ytd_revenue), 0) * 100, 2
  )::numeric as expansion_pct
from calc c
join public.organizations o on o.id = c.org_id;

grant select on public.v_logo_expansion to authenticated;
grant select on public.v_logo_expansion to service_role;