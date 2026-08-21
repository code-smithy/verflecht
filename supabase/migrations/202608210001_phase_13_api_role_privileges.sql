-- Phase 13 API role privileges.
-- PostgREST checks table privileges before row-level security policies. These
-- grants expose the tables to Supabase API roles while RLS remains the access
-- boundary for which rows and operations are allowed.

grant usage on schema public to anon, authenticated;

grant execute on function public.current_app_role() to anon, authenticated;
grant execute on function public.can_access_internal_data() to anon, authenticated;
grant execute on function public.can_review_claims() to anon, authenticated;
grant execute on function public.claim_has_evidence(uuid) to anon, authenticated;
grant execute on function public.claim_is_public(uuid) to anon, authenticated;
grant execute on function public.entity_is_public(uuid) to anon, authenticated;

grant select
on public.entities,
   public.claims,
   public.claim_evidence
to anon;

grant select, insert, update, delete
on public.sources,
   public.entities,
   public.entity_aliases,
   public.documents,
   public.claims,
   public.claim_evidence,
   public.review_queue,
   public.audit_log,
   public.llm_runs,
   public.crawl_runs,
   public.entity_resolution_tasks,
   public.entity_resolution_candidates,
   public.url_candidates,
   public.crawl_schedules,
   public.ingestion_jobs
to authenticated;
