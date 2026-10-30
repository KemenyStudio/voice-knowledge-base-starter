-- Lets Vigilancia de fuentes record that an official file was added to the
-- library. Additive. Does not update or delete any document in `files`.

alter table public.source_proposals
  drop constraint if exists source_proposals_status_check;

alter table public.source_proposals
  add constraint source_proposals_status_check
  check (status in ('proposed', 'dismissed', 'ingested', 'ingesting'));

alter table public.source_proposals
  add column if not exists file_id uuid references public.files(id) on delete set null;

alter table public.source_proposals
  add column if not exists ingested_at timestamptz;

alter table public.source_proposals
  add column if not exists claimed_at timestamptz;
