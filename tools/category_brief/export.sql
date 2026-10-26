-- Read-only exports consumed by derive.ts. Run each SELECT through
-- query_database and save the JSON result ({rows:[...]}) to the path shown.
-- tools/category_brief/in/ is git-ignored (~215 MB).

-- in/categories.json
select g.gcid, g.display_name, s.shape, s.required_entity_types req, s.allowed_entity_types allowed,
       s.identity_keys, p.credential_id_label cid, p.credential_label cl, c.regulated_by,
       c.hipaa_applies, c.glba_applies, c.license_label
from gbp_categories g
left join exp_category_shape s using (gcid)
left join exp_category_profile_config p using (gcid)
left join exp_category_compliance c using (gcid)
order by g.gcid;

-- in/volumes.json
select json_agg(json_build_array(r.gcid, r.annual_transactions, r.ear, r.band, a.eaa, p.eap, q.eaq, v.eav,
       c.expected_m, c.total_node_types, g.estimated_locations, g.estimated_profiles)) j
from exp_category_ear r
full join exp_category_eaa a using (gcid) full join exp_category_eap p using (gcid)
full join exp_category_eaq q using (gcid) full join exp_category_eav v using (gcid)
full join exp_category_completeness c using (gcid)
right join gbp_categories g using (gcid);

-- in/category_schema_type.json
select json_agg(json_build_array(g.gcid, t.schema_type, t.confidence)) j
from gbp_categories g left join exp_category_schema_type t using (gcid);

-- in/registry/chunk_NN.json — one per gcid range (~75k rows each; ranges from
-- cumulative row counts ordered by gcid). Every chunk must satisfy n = array length.
select json_agg(json_build_array(id, gcid, node_slug, node_name, schema_property, schema_type, ring,
       node_class, connection_method, entity_scope, requires_verification) order by gcid, id)::text j,
       count(*) n
from exp_vertical_node_registry
where gcid between :lo and :hi;

-- in/license_format.json — professional licence display format, for categories that
-- allow a professional entity (the only scope a professional licence key can take).
-- Saved as {"rows":[{"n":N,"j":[[gcid_without_prefix, format], ...]}]}.
select json_agg(json_build_array(substr(c.gcid,6), c.license_display_format) order by c.gcid)::text j, count(*) n
from exp_category_compliance c join exp_category_shape s using (gcid)
where c.license_display_format is not null and c.display_license_on_profile
  and 'professional' = any(s.allowed_entity_types);

-- in/no_tx_actions.json — categories with NO transactional conversion action.
-- Transactional = schema.org TradeAction/PlanAction subtypes except CancelAction
-- (derive.ts recomputes this list from the vocabulary and gate G4 requires it to
-- equal "tx_action_types" saved alongside); schema_action names are normalised
-- (leading capital, "Request" prefix dropped, "Action" suffix added) and actions
-- whose key starts with a viewing verb ("view_service_schedule") do not count.
-- Saved as {"tx_action_types":[...],"rows":[{"n":N,"j":[[gcid_without_prefix, actions], ...]}]}.
with a as (select i.gcid, regexp_replace(upper(left(x->>'schema_action',1))||substr(x->>'schema_action',2),'^Request','') sa0,
                  coalesce(x->>'key','') k
           from exp_category_intelligence i, jsonb_array_elements(i.conversion_actions) x),
b as (select gcid, case when sa0 like '%Action' then sa0 else sa0||'Action' end sa, k from a)
select json_agg(json_build_array(substr(g.gcid,6), (select string_agg(distinct sa,',') from b where b.gcid=g.gcid)) order by g.gcid)::text j, count(*) n
from gbp_categories g
where not exists (select 1 from b where b.gcid=g.gcid
  and sa = any(array['BuyAction','OrderAction','PayAction','PlanAction','PreOrderAction','QuoteAction','RentAction',
                     'ReserveAction','ScheduleAction','SellAction','TipAction','TradeAction'])
  and k !~* '^(view|see|find|explore|browse|read|learn|watch|plan_a)');
