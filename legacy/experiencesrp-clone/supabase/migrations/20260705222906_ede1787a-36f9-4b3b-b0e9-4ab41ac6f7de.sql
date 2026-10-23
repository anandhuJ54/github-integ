CREATE TABLE IF NOT EXISTS public._stage_mortgage_proj (chunk_id int PRIMARY KEY, payload text NOT NULL);
GRANT ALL ON public._stage_mortgage_proj TO postgres, authenticated, service_role, anon;
TRUNCATE public._stage_mortgage_proj;