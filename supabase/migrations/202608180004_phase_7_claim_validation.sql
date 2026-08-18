-- Phase 7 claim extraction and evidence validation metadata.
-- LLM confidence remains separate from deterministic evidence scoring.

alter table public.claims
  add column evidence_score integer not null default 0,
  add column validation_notes jsonb not null default '{}'::jsonb;

create index claims_evidence_score_idx
  on public.claims (evidence_score desc, created_at desc);
