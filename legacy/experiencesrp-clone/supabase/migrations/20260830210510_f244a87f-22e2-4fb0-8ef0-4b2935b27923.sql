do $$
declare t text;
begin
  foreach t in array array['exp_dev_launch','exp_dev_teams','exp_dev_members','exp_dev_projects','exp_dev_sprints','exp_dev_sprint_items','exp_dev_demo_days','exp_dev_docs','exp_dev_ideas','exp_dev_idea_votes']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_auth_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t||'_auth_all', t);
  end loop;
end $$;

drop policy if exists "dev docs read" on storage.objects;
create policy "dev docs read" on storage.objects for select to authenticated using (bucket_id = 'dev-docs');
drop policy if exists "dev docs write" on storage.objects;
create policy "dev docs write" on storage.objects for insert to authenticated with check (bucket_id = 'dev-docs');
drop policy if exists "dev docs delete" on storage.objects;
create policy "dev docs delete" on storage.objects for delete to authenticated using (bucket_id = 'dev-docs');