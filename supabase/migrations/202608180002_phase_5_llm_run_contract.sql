-- Phase 5 LLM run contract metadata.
-- The original foundation table captured model/prompt/schema metadata. This
-- migration adds the operation/provider/input/output fields required to audit
-- provider-neutral extraction without storing full source text.

alter table public.llm_runs
  add column operation text not null default 'unknown' check (length(trim(operation)) > 0),
  add column provider text not null default 'unknown' check (length(trim(provider)) > 0),
  add column input_hash text check (input_hash is null or input_hash ~ '^[a-f0-9]{64}$'),
  add column output jsonb;

create index llm_runs_operation_status_idx
  on public.llm_runs (operation, status, created_at desc);

create index llm_runs_document_operation_idx
  on public.llm_runs (document_id, operation, created_at desc)
  where document_id is not null;
