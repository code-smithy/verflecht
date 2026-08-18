-- Phase 11 RSS, sitemap, and news sitemap URL discovery candidates.

create type public.url_candidate_status as enum ('PENDING', 'FETCHED', 'SKIPPED', 'FAILED');
create type public.url_discovery_type as enum ('RSS', 'SITEMAP', 'NEWS_SITEMAP', 'MANUAL');

create table public.url_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  crawl_run_id uuid references public.crawl_runs(id) on delete set null,
  discovery_type public.url_discovery_type not null,
  original_url text not null check (length(trim(original_url)) > 0),
  canonical_url text not null check (length(trim(canonical_url)) > 0),
  title text,
  published_at timestamptz,
  last_modified_at timestamptz,
  status public.url_candidate_status not null default 'PENDING',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index url_candidates_source_canonical_idx
  on public.url_candidates (source_id, canonical_url);

create index url_candidates_source_status_idx
  on public.url_candidates (source_id, status, created_at);

create trigger url_candidates_set_updated_at
before update on public.url_candidates
for each row execute function public.set_updated_at();

alter table public.url_candidates enable row level security;

create policy "Internal roles can read url candidates"
on public.url_candidates for select to authenticated
using (public.can_access_internal_data());

create policy "Admins can manage url candidates"
on public.url_candidates for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Researchers can create url candidates"
on public.url_candidates for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Researchers can update url candidates"
on public.url_candidates for update to authenticated
using (public.current_app_role() in ('ADMIN', 'RESEARCHER'))
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));
