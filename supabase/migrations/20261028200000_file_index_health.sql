-- How useful each library file is for the vector index.
-- Null score means it has not been inspected. The jsonb keeps the Spanish
-- reasons shown in the Biblioteca (good, review or unknown).

alter table public.files
  add column if not exists index_health_score smallint,
  add column if not exists index_health jsonb;

alter table public.files
  drop constraint if exists files_index_health_score_check;

alter table public.files
  add constraint files_index_health_score_check
  check (
    index_health_score is null
    or (index_health_score >= 0 and index_health_score <= 100)
  );

comment on column public.files.index_health_score is
  '0-100 estimate of how searchable the file is in the vector index. Null means not inspected.';

comment on column public.files.index_health is
  'Inspection result: score, verdict (good | review | unknown), Spanish reasons, and canUpload.';
