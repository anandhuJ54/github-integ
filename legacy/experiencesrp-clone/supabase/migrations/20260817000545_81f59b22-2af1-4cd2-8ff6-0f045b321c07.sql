create or replace function public.exp_set_expected_volume(
  p_gcid text,
  p_lane text,
  p_scope text,
  p_value numeric,
  p_rationale text default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text;
  v_tbl text;
  v_new numeric;
begin
  if not public.exp_ctrl_has_role(array['super_admin','architect']) then
    raise exception 'not authorized';
  end if;
  if p_scope not in ('professional','location') then
    raise exception 'invalid scope %', p_scope;
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'invalid value';
  end if;

  case p_lane
    when 'reviews'  then v_tbl := 'exp_category_ear'; v_col := 'ear';
    when 'articles' then v_tbl := 'exp_category_eaa'; v_col := 'eaa';
    when 'posts'    then v_tbl := 'exp_category_eap'; v_col := 'eap';
    when 'qa'       then v_tbl := 'exp_category_eaq'; v_col := 'eaq';
    when 'videos'   then v_tbl := 'exp_category_eav'; v_col := 'eav';
    else raise exception 'invalid lane %', p_lane;
  end case;

  if p_scope = 'professional' then
    v_col := v_col || '_professional';
  end if;

  v_new := round(p_value);

  execute format('update public.%I set %I = $1 where gcid = $2', v_tbl, v_col)
    using v_new, p_gcid;

  if not found then
    raise exception 'no % row for %', v_tbl, p_gcid;
  end if;

  insert into public.exp_curation_ledger (gcid, layer, action, target, rationale, ruled_by)
  values (p_gcid, v_tbl, 'set_expected_volume', v_col, coalesce(p_rationale, 'admin edit of expected volume via math view'), coalesce(auth.uid()::text, 'unknown'));

  return v_new;
end;
$$;

revoke all on function public.exp_set_expected_volume(text,text,text,numeric,text) from public;
grant execute on function public.exp_set_expected_volume(text,text,text,numeric,text) to authenticated;