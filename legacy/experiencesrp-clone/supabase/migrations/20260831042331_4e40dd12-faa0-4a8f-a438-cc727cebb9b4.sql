SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('sf-hydrate-fetch','sf-hydrate-parse');
SELECT cron.schedule('sf-hydrate-fetch', '* * * * *', $$SELECT public.exp_sf_fetch_tick(20)$$);
SELECT cron.schedule('sf-hydrate-parse', '* * * * *', $$SELECT public.exp_sf_parse_tick(300)$$);
