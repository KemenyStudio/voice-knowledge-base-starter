-- Chat history and document storage move from Azure (Cosmos DB, Blob Storage)
-- to Supabase.
--
-- Additive: creates a private storage bucket and two new tables. Safe to apply
-- before or after the other 20260929* migrations, and safe with the old app
-- (which does not know these objects).

-- ---------------------------------------------------------------------------
-- Helper functions (identical to 20260929120100_rls_hardening.sql so this file
-- does not depend on the order in which the migrations are applied).
-- ---------------------------------------------------------------------------
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = p_team_id
        and tm.user_id = (select auth.uid())
    );
$$;

create or replace function public.chatbot_team_id(p_chatbot_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.team_id from public.chatbots c where c.id = p_chatbot_id;
$$;

revoke all on function public.is_team_member(uuid) from public, anon;
revoke all on function public.chatbot_team_id(uuid) from public, anon;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.chatbot_team_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Private bucket for the original documents.
-- No policies are created on storage.objects on purpose: with RLS on and no
-- policy, the anon and authenticated roles can neither list nor read the
-- bucket. The app reads and writes with the service role after checking team
-- membership, and hands out short-lived signed URLs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('knowledge', 'knowledge', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- chat_messages (was the Cosmos container "aisearch")
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  -- OpenAI response id (resp_...) for model answers, local_<uuid> for answers
  -- generated without calling the model, a uuid for user messages.
  id          text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  chatbot_id  uuid not null references public.chatbots(id) on delete cascade,
  session_id  text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  title       text,
  citations   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_session_idx
  on public.chat_messages (user_id, chatbot_id, session_id, created_at);
create index if not exists chat_messages_chatbot_idx
  on public.chat_messages (chatbot_id, created_at desc);

alter table public.chat_messages enable row level security;

-- A user only ever sees and writes their own conversations, and only in
-- chatbots of teams they belong to.
drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own"
  on public.chat_messages for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "chat_messages_insert_own" on public.chat_messages;
create policy "chat_messages_insert_own"
  on public.chat_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_team_member(public.chatbot_team_id(chatbot_id))
  );

drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own"
  on public.chat_messages for delete to authenticated
  using (user_id = (select auth.uid()));

-- One row per conversation of the signed-in user in one chatbot, newest first.
-- SECURITY INVOKER: RLS above applies, the explicit filter is belt and braces.
create or replace function public.list_chat_sessions(p_chatbot_id uuid)
returns table (
  session_id    text,
  title         text,
  last_message  text,
  last_activity timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.session_id,
    (array_agg(m.title order by m.created_at) filter (where m.title is not null))[1],
    (array_agg(m.content order by m.created_at desc) filter (where m.role = 'user'))[1],
    max(m.created_at)
  from public.chat_messages m
  where m.user_id = (select auth.uid())
    and m.chatbot_id = p_chatbot_id
  group by m.session_id
  order by max(m.created_at) desc
  limit 200;
$$;

revoke all on function public.list_chat_sessions(uuid) from public, anon;
grant execute on function public.list_chat_sessions(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- answer_ratings (was the Cosmos container "interaction_logs")
-- ---------------------------------------------------------------------------
create table if not exists public.answer_ratings (
  message_id  text not null references public.chat_messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  rating      smallint not null check (rating in (-1, 1)),
  comment     text,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists answer_ratings_user_idx
  on public.answer_ratings (user_id, created_at desc);

alter table public.answer_ratings enable row level security;

-- Users rate only answers from their own conversations. Team admins read the
-- ratings of their team through the server (service role), not directly.
drop policy if exists "answer_ratings_select_own" on public.answer_ratings;
create policy "answer_ratings_select_own"
  on public.answer_ratings for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "answer_ratings_insert_own" on public.answer_ratings;
create policy "answer_ratings_insert_own"
  on public.answer_ratings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id and m.user_id = (select auth.uid())
    )
  );

drop policy if exists "answer_ratings_update_own" on public.answer_ratings;
create policy "answer_ratings_update_own"
  on public.answer_ratings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
