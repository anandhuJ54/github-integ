ALTER VIEW v_launched_categories SET (security_invoker = true);
ALTER VIEW v_categories_pending_knowledge SET (security_invoker = true);
ALTER VIEW v_categories_unmapped SET (security_invoker = true);
ALTER VIEW v_category_node_registry SET (security_invoker = true);
ALTER VIEW v_category_score_potential SET (security_invoker = true);