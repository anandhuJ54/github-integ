UPDATE public.professionals p
SET search_rank_score = s.total_score, local_rank = s.local_rank, local_rank_of = s.local_rank_of,
    score_updated_at = s.calculated_at
FROM public.search_rank_scores s
WHERE s.entity_type = 'professional' AND s.entity_id = p.id;

UPDATE public.professionals p
SET search_rank_score = NULL, local_rank = NULL, local_rank_of = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.search_rank_scores s
  WHERE s.entity_type = 'professional' AND s.entity_id = p.id);

UPDATE public.organizations o
SET search_rank_score = s.total_score, score_updated_at = s.calculated_at
FROM public.search_rank_scores s
WHERE s.entity_type = 'organization' AND s.entity_id = o.id;

UPDATE public.organizations o
SET search_rank_score = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.search_rank_scores s
  WHERE s.entity_type = 'organization' AND s.entity_id = o.id);