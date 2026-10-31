-- Admin tools: feedback triage, outdated documents and prompt notes.
--
-- Additive and backwards compatible: safe to apply BEFORE deploying the new
-- app version. Nothing changes in answers until an admin acts on something.

-- ---------------------------------------------------------------------------
-- answer_ratings: what an admin did about a rating
--   triage_status  open | resolved
--   triage_action  outdated_document | prompt_note | request_document | dismissed
-- ---------------------------------------------------------------------------
alter table public.answer_ratings
  add column if not exists triage_status text not null default 'open',
  add column if not exists triage_action text,
  add column if not exists triage_note text,
  add column if not exists triage_file_id uuid references public.files(id) on delete set null,
  add column if not exists triaged_by uuid references public.profiles(id) on delete set null,
  add column if not exists triaged_at timestamptz;

alter table public.answer_ratings
  drop constraint if exists answer_ratings_triage_status_check;
alter table public.answer_ratings
  add constraint answer_ratings_triage_status_check
  check (triage_status in ('open', 'resolved'));

alter table public.answer_ratings
  drop constraint if exists answer_ratings_triage_action_check;
alter table public.answer_ratings
  add constraint answer_ratings_triage_action_check
  check (
    triage_action is null
    or triage_action in ('outdated_document', 'prompt_note', 'request_document', 'dismissed')
  );

create index if not exists answer_ratings_open_idx
  on public.answer_ratings (triage_status, created_at desc);

-- ---------------------------------------------------------------------------
-- files: documents an admin flagged as outdated. Only a flag: the document is
-- still searched, answers that cite it carry a warning.
-- ---------------------------------------------------------------------------
alter table public.files
  add column if not exists outdated boolean not null default false,
  add column if not exists outdated_note text;

-- ---------------------------------------------------------------------------
-- chatbots: short guidance notes written by admins (for example from a bad
-- rating). They are appended to the instructions; max 10 notes of 300 chars,
-- enforced by the API.
-- ---------------------------------------------------------------------------
alter table public.chatbots
  add column if not exists prompt_notes jsonb not null default '[]'::jsonb;

comment on column public.chatbots.prompt_notes is
  'Admin-written guidance notes (array of strings) appended to the assistant instructions.';
