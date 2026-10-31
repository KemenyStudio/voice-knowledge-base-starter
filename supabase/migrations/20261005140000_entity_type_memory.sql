-- Entity-type memory, audience tagging and clarifying questions.
--
-- Additive and backwards compatible: safe to apply BEFORE deploying the new
-- app version. Nothing changes for an assistant until an admin configures
-- audience_options and turns audience_filter on.

-- ---------------------------------------------------------------------------
-- chatbots: who the assistant's documents are written for
-- ---------------------------------------------------------------------------
alter table public.chatbots
  add column if not exists audience_options jsonb not null default '[]'::jsonb,
  add column if not exists audience_filter boolean not null default false;

comment on column public.chatbots.audience_options is
  'Entity types users can pick (e.g. ["Bancos","Sofipos"]), max 8. Empty = feature off.';
comment on column public.chatbots.audience_filter is
  'When true, search skips documents explicitly marked as not applying to the user''s entity type.';

-- ---------------------------------------------------------------------------
-- files: which audiences a document applies to
--   audience           confirmed by an admin; empty = applies to everyone
--   audience_suggested proposed by the AI classifier, not used until accepted
--   audience_status    unclassified | suggested | confirmed
-- Unclassified documents are never hidden from anyone.
-- ---------------------------------------------------------------------------
alter table public.files
  add column if not exists audience text[] not null default '{}',
  add column if not exists audience_suggested text[] not null default '{}',
  add column if not exists audience_status text not null default 'unclassified';

alter table public.files
  drop constraint if exists files_audience_status_check;
alter table public.files
  add constraint files_audience_status_check
  check (audience_status in ('unclassified', 'suggested', 'confirmed'));

-- ---------------------------------------------------------------------------
-- assistant_user_prefs: what the assistant remembers about each user
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_user_prefs (
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  chatbot_id               uuid not null references public.chatbots(id) on delete cascade,
  entity_type              text,
  entity_prompt_dismissed  boolean not null default false,
  updated_at               timestamptz not null default now(),
  primary key (user_id, chatbot_id)
);

alter table public.assistant_user_prefs enable row level security;

drop policy if exists "assistant_user_prefs_select_own" on public.assistant_user_prefs;
create policy "assistant_user_prefs_select_own"
  on public.assistant_user_prefs for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "assistant_user_prefs_insert_own" on public.assistant_user_prefs;
create policy "assistant_user_prefs_insert_own"
  on public.assistant_user_prefs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_team_member(public.chatbot_team_id(chatbot_id))
  );

drop policy if exists "assistant_user_prefs_update_own" on public.assistant_user_prefs;
create policy "assistant_user_prefs_update_own"
  on public.assistant_user_prefs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_team_member(public.chatbot_team_id(chatbot_id))
  );

drop policy if exists "assistant_user_prefs_delete_own" on public.assistant_user_prefs;
create policy "assistant_user_prefs_delete_own"
  on public.assistant_user_prefs for delete to authenticated
  using (user_id = (select auth.uid()));
