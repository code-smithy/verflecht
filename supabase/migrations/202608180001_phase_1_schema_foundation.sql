-- Phase 1 schema foundation for Verflecht.
-- Supabase/PostgreSQL is the source of truth; application services may only
-- publish verified claims that have concrete evidence.

create extension if not exists pgcrypto;

create type public.entity_type as enum (
  'PERSON',
  'ORGANISATION',
  'COMPANY',
  'POLITICAL_PARTY',
  'COMMITTEE',
  'PARLIAMENT',
  'GOVERNMENT_BODY',
  'EVENT',
  'INITIATIVE',
  'ASSOCIATION',
  'MEDIA_OUTLET',
  'LOCATION',
  'COUNTRY',
  'OTHER'
);

create type public.relation_predicate as enum (
  'MEMBER_OF',
  'PRESIDENT_OF',
  'VICE_PRESIDENT_OF',
  'BOARD_MEMBER_OF',
  'EMPLOYED_BY',
  'OWNS',
  'SHAREHOLDER_OF',
  'HAS_MANDATE_AT',
  'MEMBER_OF_COMMITTEE',
  'PARTICIPATED_IN',
  'ORGANISED_BY',
  'SPOKE_AT',
  'MET_WITH',
  'REPRESENTED',
  'FUNDED_BY',
  'SUPPORTED_INITIATIVE',
  'SIGNED_DECLARATION',
  'HAS_BUSINESS_ACTIVITY_IN',
  'ISSUED_ACCESS_BADGE_TO',
  'ADVISOR_TO',
  'FOUNDED',
  'PARTNER_OF'
);

create type public.connection_class as enum ('DIRECT', 'INDIRECT', 'OFFICIAL', 'HISTORICAL');
create type public.verification_status as enum (
  'DETECTED',
  'PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
  'DISPUTED',
  'OUTDATED'
);

create type public.source_type as enum (
  'OFFICIAL_REGISTER',
  'PARLIAMENT',
  'GOVERNMENT',
  'COMPANY_REGISTER',
  'COMPANY_WEBSITE',
  'ORGANISATION_WEBSITE',
  'NEWS_ARTICLE',
  'PRESS_RELEASE',
  'EVENT_PROGRAM',
  'PDF',
  'SOCIAL_MEDIA',
  'MANUAL_RESEARCH',
  'OTHER'
);

create type public.access_status as enum (
  'PUBLIC',
  'PAYWALLED',
  'BLOCKED',
  'LOGIN_REQUIRED',
  'REMOVED',
  'UNKNOWN'
);

create type public.extraction_status as enum (
  'PENDING',
  'SUCCESS',
  'PARTIAL',
  'METADATA_ONLY',
  'FAILED'
);

create type public.source_quality_class as enum ('A', 'B', 'C', 'D', 'E', 'X');
create type public.user_role as enum ('ADMIN', 'RESEARCHER', 'REVIEWER', 'PUBLIC');
create type public.review_queue_status as enum ('OPEN', 'ASSIGNED', 'RESOLVED', 'CANCELLED');
create type public.crawl_run_status as enum ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');
create type public.llm_run_status as enum ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  domain text unique,
  source_type public.source_type not null,
  source_quality public.source_quality_class not null default 'E',
  enabled boolean not null default true,
  respect_robots boolean not null default true,
  requests_per_minute integer not null default 10 check (requests_per_minute >= 0),
  concurrency integer not null default 1 check (concurrency between 1 and 10),
  javascript_required boolean not null default false,
  store_raw_html boolean not null default true,
  allow_llm_processing boolean not null default true,
  publish_full_text boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_type public.entity_type not null,
  canonical_name text not null check (length(trim(canonical_name)) > 0),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  alias text not null check (length(trim(alias)) > 0),
  language text check (language is null or language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  valid_from date,
  valid_to date,
  source_id uuid references public.sources(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_from is null or valid_to is null or valid_from <= valid_to)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  original_url text not null check (length(trim(original_url)) > 0),
  canonical_url text check (canonical_url is null or length(trim(canonical_url)) > 0),
  title text,
  author text,
  publisher text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  content_type text,
  language text check (language is null or language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  raw_storage_path text,
  extracted_text text,
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  http_status integer check (http_status is null or http_status between 100 and 599),
  access_status public.access_status not null default 'UNKNOWN',
  extraction_status public.extraction_status not null default 'PENDING',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  subject_entity_id uuid not null references public.entities(id) on delete restrict,
  predicate public.relation_predicate not null,
  object_entity_id uuid references public.entities(id) on delete restrict,
  literal_value jsonb,
  connection_class public.connection_class not null,
  valid_from date,
  valid_to date,
  confidence_score numeric(5, 4) check (confidence_score is null or confidence_score between 0 and 1),
  verification_status public.verification_status not null default 'DETECTED',
  created_by text not null default 'system',
  reviewed_by uuid,
  reviewed_at timestamptz,
  supersedes_claim_id uuid references public.claims(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (object_entity_id is not null or literal_value is not null),
  check (object_entity_id is null or object_entity_id <> subject_entity_id),
  check (valid_from is null or valid_to is null or valid_from <= valid_to),
  check ((reviewed_at is null and reviewed_by is null) or reviewed_at is not null)
);

create table public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  evidence_text text not null check (length(trim(evidence_text)) > 0),
  context_before text,
  context_after text,
  start_char integer check (start_char is null or start_char >= 0),
  end_char integer check (end_char is null or end_char >= 0),
  page_number integer check (page_number is null or page_number > 0),
  section text,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check (start_char is null or end_char is null or start_char <= end_char)
);

create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  status public.review_queue_status not null default 'OPEN',
  assigned_to uuid,
  reason text,
  reviewer_notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid not null,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table public.llm_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete set null,
  claim_id uuid references public.claims(id) on delete set null,
  model text not null check (length(trim(model)) > 0),
  prompt_version text not null check (length(trim(prompt_version)) > 0),
  schema_version text not null check (length(trim(schema_version)) > 0),
  temperature numeric(3, 2) not null check (temperature between 0 and 2),
  status public.llm_run_status not null default 'PENDING',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.crawl_run_status not null default 'PENDING',
  urls_discovered integer not null default 0 check (urls_discovered >= 0),
  documents_fetched integer not null default 0 check (documents_fetched >= 0),
  documents_changed integer not null default 0 check (documents_changed >= 0),
  documents_failed integer not null default 0 check (documents_failed >= 0),
  error_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (finished_at is null or finished_at >= started_at)
);

create unique index entity_aliases_entity_alias_language_idx
  on public.entity_aliases (entity_id, lower(alias), coalesce(language, ''));

create unique index documents_canonical_hash_idx
  on public.documents (canonical_url, content_hash)
  where canonical_url is not null and content_hash is not null;

create unique index claim_evidence_claim_document_hash_idx
  on public.claim_evidence (claim_id, document_id, evidence_hash);

create index entities_entity_type_idx on public.entities (entity_type);
create index documents_source_retrieved_idx on public.documents (source_id, retrieved_at desc);
create index claims_subject_idx on public.claims (subject_entity_id);
create index claims_object_idx on public.claims (object_entity_id);
create index claims_predicate_status_idx on public.claims (predicate, verification_status);
create index review_queue_status_idx on public.review_queue (status, created_at);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

create trigger sources_set_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

create trigger entities_set_updated_at
before update on public.entities
for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

create trigger claims_set_updated_at
before update on public.claims
for each row execute function public.set_updated_at();

create trigger review_queue_set_updated_at
before update on public.review_queue
for each row execute function public.set_updated_at();

create trigger crawl_runs_set_updated_at
before update on public.crawl_runs
for each row execute function public.set_updated_at();

create or replace function public.ensure_verified_claim_has_evidence()
returns trigger
language plpgsql
as $$
begin
  if new.verification_status = 'VERIFIED'
    and not exists (
      select 1
      from public.claim_evidence evidence
      where evidence.claim_id = new.id
    )
  then
    raise exception 'A verified claim must have at least one evidence record.';
  end if;

  return new;
end;
$$;

create constraint trigger claims_verified_requires_evidence
after insert or update of verification_status on public.claims
deferrable initially deferred
for each row execute function public.ensure_verified_claim_has_evidence();

create or replace function public.prevent_last_evidence_removal_from_verified_claim()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.claims claim
    where claim.id = old.claim_id
      and claim.verification_status = 'VERIFIED'
  )
    and not exists (
      select 1
      from public.claim_evidence evidence
      where evidence.claim_id = old.claim_id
        and evidence.id <> old.id
    )
  then
    raise exception 'Cannot remove the last evidence record from a verified claim.';
  end if;

  return old;
end;
$$;

create trigger claim_evidence_keep_verified_claim_supported
after delete or update of claim_id on public.claim_evidence
for each row execute function public.prevent_last_evidence_removal_from_verified_claim();

create or replace function public.claim_has_evidence(target_claim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.claim_evidence evidence
    where evidence.claim_id = target_claim_id
  );
$$;

create or replace function public.claim_is_public(target_claim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.claims claim
    where claim.id = target_claim_id
      and claim.verification_status = 'VERIFIED'
      and public.claim_has_evidence(claim.id)
  );
$$;

create or replace function public.entity_is_public(target_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.claims claim
    where claim.verification_status = 'VERIFIED'
      and (claim.subject_entity_id = target_entity_id or claim.object_entity_id = target_entity_id)
      and public.claim_has_evidence(claim.id)
  );
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'app_role', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'app_role', ''),
    'PUBLIC'
  );
$$;

create or replace function public.can_access_internal_data()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('ADMIN', 'RESEARCHER', 'REVIEWER');
$$;

create or replace function public.can_review_claims()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('ADMIN', 'REVIEWER');
$$;

alter table public.sources enable row level security;
alter table public.entities enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.documents enable row level security;
alter table public.claims enable row level security;
alter table public.claim_evidence enable row level security;
alter table public.review_queue enable row level security;
alter table public.audit_log enable row level security;
alter table public.llm_runs enable row level security;
alter table public.crawl_runs enable row level security;

create policy "Internal roles can read sources"
on public.sources for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read entities"
on public.entities for select to authenticated
using (public.can_access_internal_data());

create policy "Public can read entities with published claims"
on public.entities for select to anon, authenticated
using (public.entity_is_public(id));

create policy "Internal roles can read entity aliases"
on public.entity_aliases for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read documents"
on public.documents for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read claims"
on public.claims for select to authenticated
using (public.can_access_internal_data());

create policy "Public can read verified source backed claims"
on public.claims for select to anon, authenticated
using (public.claim_is_public(id));

create policy "Internal roles can read claim evidence"
on public.claim_evidence for select to authenticated
using (public.can_access_internal_data());

create policy "Public can read evidence for verified claims"
on public.claim_evidence for select to anon, authenticated
using (public.claim_is_public(claim_id));

create policy "Internal roles can read review queue"
on public.review_queue for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read audit log"
on public.audit_log for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read llm runs"
on public.llm_runs for select to authenticated
using (public.can_access_internal_data());

create policy "Internal roles can read crawl runs"
on public.crawl_runs for select to authenticated
using (public.can_access_internal_data());

create policy "Admins can manage sources"
on public.sources for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage entities"
on public.entities for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage entity aliases"
on public.entity_aliases for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage documents"
on public.documents for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage claims"
on public.claims for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage claim evidence"
on public.claim_evidence for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage review queue"
on public.review_queue for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage audit log"
on public.audit_log for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage llm runs"
on public.llm_runs for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Admins can manage crawl runs"
on public.crawl_runs for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy "Researchers can create research records"
on public.entities for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Researchers can create aliases"
on public.entity_aliases for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Researchers can create sources"
on public.sources for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Researchers can create documents"
on public.documents for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER'));

create policy "Researchers can propose claims"
on public.claims for insert to authenticated
with check (
  public.current_app_role() in ('ADMIN', 'RESEARCHER')
  and verification_status in ('DETECTED', 'PENDING_REVIEW')
);

create policy "Researchers can add evidence"
on public.claim_evidence for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'RESEARCHER', 'REVIEWER'));

create policy "Reviewers can update claims"
on public.claims for update to authenticated
using (public.can_review_claims())
with check (public.can_review_claims());

create policy "Reviewers can manage review queue"
on public.review_queue for all to authenticated
using (public.can_review_claims())
with check (public.can_review_claims());

create policy "Internal roles can append audit log"
on public.audit_log for insert to authenticated
with check (public.can_access_internal_data());
