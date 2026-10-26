create or replace function public.exp_index_guard()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return true;
  end if;
  return public.exp_ctrl_has_role(array['super_admin','architect']);
end $$;

revoke all on function public.exp_index_guard() from public;
grant execute on function public.exp_index_guard() to authenticated, service_role;

create or replace function public.exp_index_job_install(p_jobname text, p_schedule text, p_command text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare j bigint;
begin
  if exists (select 1 from cron.job where jobname = p_jobname) then
    select jobid into j from cron.job where jobname = p_jobname;
    perform cron.alter_job(j, schedule := p_schedule, command := p_command, active := false);
    return jsonb_build_object('jobname', p_jobname, 'jobid', j, 'action', 'updated', 'active', false);
  end if;
  select cron.schedule(p_jobname, p_schedule, p_command) into j;
  perform cron.alter_job(j, active := false);
  return jsonb_build_object('jobname', p_jobname, 'jobid', j, 'action', 'created', 'active', false);
end $$;

revoke all on function public.exp_index_job_install(text, text, text) from public;
grant execute on function public.exp_index_job_install(text, text, text) to service_role;