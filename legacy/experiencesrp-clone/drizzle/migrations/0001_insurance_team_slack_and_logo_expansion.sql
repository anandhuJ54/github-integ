-- Additive: Slack channel handle on sales reps
alter table public.exp_sales_reps add column if not exists slack_channel text;

update public.exp_sales_reps set slack_channel = v.ch
from (values
  ('c1000000-0000-4000-8000-000000000001'::uuid, '#ins-sre-renee'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, '#ins-sre-marcus'),
  ('c1000000-0000-4000-8000-000000000003'::uuid, '#ins-smb-dana'),
  ('c1000000-0000-4000-8000-000000000004'::uuid, '#ins-smb-luis'),
  ('c1000000-0000-4000-8000-000000000005'::uuid, '#ins-mm-priya'),
  ('c1000000-0000-4000-8000-000000000006'::uuid, '#ins-ent-tom')
) as v(id, ch)
where exp_sales_reps.id = v.id and exp_sales_reps.slack_channel is distinct from v.ch;

-- Revenue → logo attribution. Revenue rows carry no territory_id today, so a revenue
-- group_key is matched to the territory family that owns the logos (exact match, or
-- either key being a prefix of the other: 'insurance' ↔ 'insurance_agency').
create or replace view public.v_logo_revenue_month as
select
  rc.group_key,
  tb.org_id,
  o.name as org_name,
  date_trunc('month', rc.period_start)::date as month_start,
  extract(year from rc.period_start)::int as year,
  sum(rc.amount)::numeric as amount
from public.exp_revenue_components rc
join public.exp_territories t
  on t.group_key = rc.group_key
  or t.group_key like rc.group_key || '\_%'
  or rc.group_key like t.group_key || '\_%'
join public.exp_territory_brand tb on tb.territory_id = t.id
join public.organizations o on o.id = tb.org_id
group by 1, 2, 3, 4, 5;

grant select on public.v_logo_revenue_month to authenticated;
grant select on public.v_logo_revenue_month to service_role;

-- Land vs expand, per logo per calendar year.
create or replace view public.v_logo_expansion as
with m as (
  select * from public.v_logo_revenue_month
),
firsts as (
  select group_key, org_id, min(month_start) as first_booking_at, min(year) as first_year
  from m group by 1, 2
),
land as (
  -- the logo's very first booking amount (one row) = "new / land"
  select distinct on (group_key, org_id)
    group_key, org_id, amount as land_amount
  from m
  order by group_key, org_id, month_start
),
yearly as (
  select group_key, org_id, org_name, year, sum(amount)::numeric as ytd_revenue
  from m group by 1, 2, 3, 4
)
select
  y.group_key,
  y.org_id,
  y.org_name,
  y.year,
  f.first_booking_at,
  coalesce((
    select sum(m2.amount) from m m2
    where m2.group_key = y.group_key and m2.org_id = y.org_id and m2.year < y.year
  ), 0)::numeric as baseline,
  y.ytd_revenue,
  case when y.year = f.first_year then l.land_amount else 0 end::numeric as new_revenue,
  (
    y.ytd_revenue
    - coalesce((
        select sum(m2.amount) from m m2
        where m2.group_key = y.group_key and m2.org_id = y.org_id and m2.year < y.year
      ), 0)
    - case when y.year = f.first_year then l.land_amount else 0 end
  )::numeric as expansion_revenue,
  round(
    (
      y.ytd_revenue
      - coalesce((
          select sum(m2.amount) from m m2
          where m2.group_key = y.group_key and m2.org_id = y.org_id and m2.year < y.year
        ), 0)
      - case when y.year = f.first_year then l.land_amount else 0 end
    )
    / nullif(
        coalesce(
          nullif((
            select sum(m2.amount) from m m2
            where m2.group_key = y.group_key and m2.org_id = y.org_id and m2.year < y.year
          ), 0),
          y.ytd_revenue
        ), 0) * 100, 2)::numeric as expansion_pct
from yearly y
join firsts f on f.group_key = y.group_key and f.org_id = y.org_id
join land l on l.group_key = y.group_key and l.org_id = y.org_id;

grant select on public.v_logo_expansion to authenticated;
grant select on public.v_logo_expansion to service_role;

-- Monthly cumulative per logo/year for MoM / QoQ trend.
create or replace view public.v_logo_expansion_month as
select
  m.group_key,
  m.org_id,
  m.org_name,
  m.year,
  m.month_start,
  m.amount as month_revenue,
  sum(m.amount) over (
    partition by m.group_key, m.org_id, m.year
    order by m.month_start
    rows between unbounded preceding and current row
  )::numeric as cumulative_revenue
from public.v_logo_revenue_month m;

grant select on public.v_logo_expansion_month to authenticated;
grant select on public.v_logo_expansion_month to service_role;