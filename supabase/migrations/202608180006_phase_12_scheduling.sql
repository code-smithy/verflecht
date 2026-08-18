-- Phase 12 scheduled crawling and retryable ingestion jobs.

create type public.crawl_schedule_frequency as enum ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');
create type public.crawl_schedule_status as enum ('ACTIVE', 'PAUSED');
create type public.ingestion_job_kind as enum (
  'DISCOVER_URLS',
  'FETCH_URL',
  'EXTRACT_DOCUMENT',
  'ANALYZE_DOCUMENT'
);
create type public.ingestion_job_status as enum (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED'
);

create table public.crawl_schedules (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  frequency public.crawl_schedule_frequency not null,
  discovery_urls text[] not null check (cardinality(discovery_urls) > 0),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  status public.crawl_schedule_status not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  crawl_run_id uuid references public.crawl_runs(id) on delete set null,
  url_candidate_id uuid references public.url_candidates(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  job_kind public.ingestion_job_kind not null,
  status public.ingestion_job_status not null default 'PENDING',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  finished_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempts <= max_attempts),
  check (
    status not in ('SUCCEEDED', 'FAILED', 'SKIPPED')
    or finished_at is not null
  ),
  check (
    (job_kind = 'FETCH_URL' and url_candidate_id is not null)
    or (job_kind in ('EXTRACT_DOCUMENT', 'ANALYZE_DOCUMENT') and document_id is not null)
    or job_kind = 'DISCOVER_URLS'
  )
);

create index crawl_schedules_due_idx
  on public.crawl_schedules (status, next_run_at);

create index ingestion_jobs_due_idx
  on public.ingestion_jobs (job_kind, status, scheduled_at);

create index ingestion_jobs_crawl_run_idx
  on public.ingestion_jobs (crawl_run_id, created_at);

create unique index ingestion_jobs_active_candidate_kind_idx
  on public.ingestion_jobs (url_candidate_id, job_kind)
  where url_candidate_id is not null and status in ('PENDING', 'RUNNING');

create unique index ingestion_jobs_document_kind_idx
  on public.ingestion_jobs (document_id, job_kind)
  where document_id is not null and job_kind in ('EXTRACT_DOCUMENT', 'ANALYZE_DOCUMENT');

create trigger crawl_schedules_set_updated_at
before update on public.crawl_schedules
for each row execute function public.set_updated_at();

create trigger ingestion_jobs_set_updated_at
before update on public.ingestion_jobs
for each row execute function public.set_updated_at();

alter table public.crawl_schedules enable row level security;
alter table public.ingestion_jobs enable row level security;

create policy "Internal roles can read crawl schedules"
on public.crawl_schedules for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read ingestion jobs"
on public.ingestion_jobs for select to authenticated
using (public.can_access_internal_data());

create policy "Researchers can manage crawl schedules"
on public.crawl_schedules for all to authenticated
using (public.current_app_role() in ('ADMIN', 'RESEARCHER'))
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Researchers can manage ingestion jobs"
on public.ingestion_jobs for all to authenticated
using (public.current_app_role() in ('ADMIN', 'RESEARCHER'))
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));
