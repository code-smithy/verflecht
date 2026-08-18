-- Phase 6 entity resolution persistence.
-- Resolution can propose candidates, but ambiguous or low-confidence people
-- must remain review tasks instead of becoming automatic identity merges.

create type public.entity_resolution_status as enum (
  'AUTO_RESOLVED',
  'MANUAL_REVIEW',
  'NO_MATCH'
);

create table public.entity_resolution_tasks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete set null,
  local_id text not null check (length(trim(local_id)) > 0),
  mention_text text not null check (length(trim(mention_text)) > 0),
  entity_type public.entity_type not null,
  status public.entity_resolution_status not null default 'MANUAL_REVIEW',
  selected_entity_id uuid references public.entities(id) on delete restrict,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'AUTO_RESOLVED' or selected_entity_id is not null)
);

create table public.entity_resolution_candidates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.entity_resolution_tasks(id) on delete cascade,
  candidate_entity_id uuid not null references public.entities(id) on delete restrict,
  score numeric(5, 4) not null check (score between 0 and 1),
  signals text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index entity_resolution_tasks_document_idx
  on public.entity_resolution_tasks (document_id, created_at desc)
  where document_id is not null;

create index entity_resolution_tasks_status_idx
  on public.entity_resolution_tasks (status, created_at);

create index entity_resolution_candidates_task_score_idx
  on public.entity_resolution_candidates (task_id, score desc);

create trigger entity_resolution_tasks_set_updated_at
before update on public.entity_resolution_tasks
for each row execute function public.set_updated_at();

alter table public.entity_resolution_tasks enable row level security;
alter table public.entity_resolution_candidates enable row level security;

create policy "Internal roles can read entity resolution tasks"
on public.entity_resolution_tasks for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read entity resolution candidates"
on public.entity_resolution_candidates for select to authenticated
using (public.can_access_internal_data());

create policy "Researchers can create entity resolution tasks"
on public.entity_resolution_tasks for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Researchers can create entity resolution candidates"
on public.entity_resolution_candidates for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Reviewers can update entity resolution tasks"
on public.entity_resolution_tasks for update to authenticated
using (public.can_review_claims())
with check (public.can_review_claims());

create policy "Admins can manage entity resolution tasks"
on public.entity_resolution_tasks for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage entity resolution candidates"
on public.entity_resolution_candidates for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');
