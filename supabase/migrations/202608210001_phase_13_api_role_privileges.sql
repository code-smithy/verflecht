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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sources',
    'entities',
    'entity_aliases',
    'documents',
    'claims',
    'claim_evidence',
    'review_queue',
    'audit_log',
    'llm_runs',
    'crawl_runs',
    'entity_resolution_tasks',
    'entity_resolution_candidates',
    'url_candidates',
    'crawl_schedules',
    'ingestion_jobs'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format(
        'grant select, insert, update, delete on table public.%I to authenticated',
        table_name
      );
    end if;
  end loop;
end $$;
