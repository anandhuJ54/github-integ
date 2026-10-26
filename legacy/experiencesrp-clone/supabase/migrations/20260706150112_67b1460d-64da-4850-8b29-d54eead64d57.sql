GRANT UPDATE ON TABLE public.exp_category_compliance TO sandbox_exec;
SELECT has_table_privilege('sandbox_exec', 'public.exp_category_compliance', 'UPDATE') AS can_update;