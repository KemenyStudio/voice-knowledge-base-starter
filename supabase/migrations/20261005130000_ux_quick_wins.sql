-- UX quick wins: team-aware assistants, richer chat messages, shareable
-- conversations.
--
-- Additive and backwards compatible: safe to apply BEFORE deploying the new
-- app version.

-- ---------------------------------------------------------------------------
-- chatbots: texts shown in the chat of each assistant
-- ---------------------------------------------------------------------------
alter table public.chatbots
  add column if not exists welcome_message text,
  add column if not exists suggested_questions jsonb not null default '[]'::jsonb;

comment on column public.chatbots.welcome_message is
  'Shown in the empty chat. Null = generic welcome built from the assistant name.';
comment on column public.chatbots.suggested_questions is
  'Example questions for the empty chat: [{"category": text, "prompts": [text, ...]}].';

-- ---------------------------------------------------------------------------
-- chat_messages: free-form extras of one message (follow-up suggestions, ...)
-- ---------------------------------------------------------------------------
alter table public.chat_messages
  add column if not exists meta jsonb not null default '{}'::jsonb;

comment on column public.chat_messages.meta is
  'Extras of an assistant message, e.g. {"follow_ups": [text, ...]}.';

-- ---------------------------------------------------------------------------
-- conversation_shares: frozen copy of a conversation that other members of the
-- same team can open by link. Not public: reading needs a session AND
-- membership of the assistant's team.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_shares (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  chatbot_id  uuid not null references public.chatbots(id) on delete cascade,
  title       text,
  messages    jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists conversation_shares_user_idx
  on public.conversation_shares (user_id, created_at desc);

alter table public.conversation_shares enable row level security;

drop policy if exists "conversation_shares_select_team" on public.conversation_shares;
create policy "conversation_shares_select_team"
  on public.conversation_shares for select to authenticated
  using (public.is_team_member(public.chatbot_team_id(chatbot_id)));

drop policy if exists "conversation_shares_insert_own" on public.conversation_shares;
create policy "conversation_shares_insert_own"
  on public.conversation_shares for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_team_member(public.chatbot_team_id(chatbot_id))
  );

drop policy if exists "conversation_shares_delete_own" on public.conversation_shares;
create policy "conversation_shares_delete_own"
  on public.conversation_shares for delete to authenticated
  using (user_id = (select auth.uid()));
