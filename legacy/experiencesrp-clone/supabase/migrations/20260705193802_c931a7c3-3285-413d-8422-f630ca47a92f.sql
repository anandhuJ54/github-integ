CREATE OR REPLACE VIEW public.exp_category_intelligence AS
SELECT g.gcid, g.display_name,
  k.entity_type, k.pricing_tier, k.status, k.knowledge_pct, k.is_launched,
  k.value_props, k.search_intents, k.conversion_actions,
  k.terminology, k.services, k.compliance_rules, k.customer_journey,
  k.ranking_factors, k.review_vocabulary, k.content_topics, k.expertise_signals,
  k.scoring_weights, k.ai_agents,
  cst.schema_type, cst.confidence AS schema_type_confidence,
  (SELECT count(*) FROM public.exp_schema_type_ring_map m WHERE m.schema_type=cst.schema_type) AS mapped_properties,
  (SELECT count(DISTINCT m.ring_key) FROM public.exp_schema_type_ring_map m WHERE m.schema_type=cst.schema_type) AS rings_with_properties,
  (SELECT count(*) FROM public.exp_vertical_node_registry n WHERE n.gcid=g.gcid) AS registry_nodes,
  (SELECT count(*) FROM public.exp_taxonomy t WHERE t.gcid=g.gcid) AS taxonomy_terms,
  (SELECT count(DISTINCT t.level) FROM public.exp_taxonomy t WHERE t.gcid=g.gcid) AS taxonomy_levels_covered,
  (c.gcid IS NOT NULL) AS has_compliance,
  c.display_license_on_profile, c.regulated_by,
  (s.gcid IS NOT NULL) AS has_schema_projection
FROM public.gbp_categories g
LEFT JOIN public.exp_category_knowledge k ON k.gcid=g.gcid
LEFT JOIN public.exp_category_schema_type cst ON cst.gcid=g.gcid
LEFT JOIN public.exp_category_compliance c ON c.gcid=g.gcid
LEFT JOIN public.exp_category_schema s ON s.gcid=g.gcid;

GRANT SELECT ON public.exp_category_intelligence TO anon, authenticated;
GRANT ALL ON public.exp_category_intelligence TO service_role;