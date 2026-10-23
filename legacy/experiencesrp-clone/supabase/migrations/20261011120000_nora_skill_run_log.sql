-- NORA OS — skill run log (increment 1 of the executor)
-- Turns the dry-run sandbox trace into a durable record of real + simulated skill runs.
-- Feeds the Nora OS "Runs" tab and the OBSERVE→…→VERIFY→LEARN loop (actual_srs_delta is
-- filled by a later verification pass). Additive. RLS matches exp_nora_state /
-- exp_skill_registry: RLS on, single FOR ALL policy to authenticated; server writes use the
-- service role. See docs/ETL-Enhancements.md (2026-10-11 entry).

create table if not exists public.exp_skill_run (
  id                uuid primary key default gen_random_uuid(),
  skill_key         text not null,
  skill_version     text,
  capability_keys   text[] not null default '{}',
  entity_ref        text,
  entity_type       text,
  mode              text not null default 'dry_run' check (mode in ('dry_run','live')),
  status            text not null default 'planned'
                      check (status in ('planned','running','blocked','succeeded','failed','cancelled')),
  trigger           text,
  verdict           text,
  trace             jsonb not null default '[]'::jsonb,
  inputs            jsonb not null default '{}'::jsonb,
  outputs           jsonb not null default '{}'::jsonb,
  telemetry         jsonb not null default '{}'::jsonb,
  graph_writes      jsonb not null default '[]'::jsonb,
  expected_srs_lift integer,
  actual_srs_delta  numeric,
  error             text,
  actor             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists exp_skill_run_skill_idx  on public.exp_skill_run (skill_key);
create index if not exists exp_skill_run_entity_idx  on public.exp_skill_run (entity_ref);
create index if not exists exp_skill_run_status_idx  on public.exp_skill_run (status);
create index if not exists exp_skill_run_created_idx on public.exp_skill_run (created_at desc);

alter table public.exp_skill_run enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy where polname = 'Staff all skillrun'
      and polrelid = 'public.exp_skill_run'::regclass
  ) then
    create policy "Staff all skillrun" on public.exp_skill_run
      for all to authenticated using (true) with check (true);
  end if;
end $$;
