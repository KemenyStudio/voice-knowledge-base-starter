-- Later review: pins and folders inside a conversation, rewind one question,
-- and proposals from public sources. Additive. Does not change documents,
-- vector stores, or answers that already exist.

alter table public.chat_messages
  add column if not exists pinned boolean not null default false,
  add column if not exists folder text;

comment on column public.chat_messages.pinned is
  'The owner pinned this message so a long thread has an outline.';
comment on column public.chat_messages.folder is
  'Optional folder name grouping this message inside one conversation.';

-- ---------------------------------------------------------------------------
-- set_message_place: pin and/or folder on one of the caller's messages.
-- p_pinned null leaves the pin unchanged. p_set_folder false leaves the folder.
-- ---------------------------------------------------------------------------
create or replace function public.set_message_place(
  p_chatbot_id uuid,
  p_message_id text,
  p_pinned boolean,
  p_set_folder boolean,
  p_folder text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  clean text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_message_id is null
    or char_length(p_message_id) < 1
    or char_length(p_message_id) > 200
  then
    return 0;
  end if;

  if p_set_folder then
    clean := btrim(regexp_replace(coalesce(p_folder, ''), '[[:cntrl:]]', ' ', 'g'));
    clean := regexp_replace(clean, '[[:space:]]+', ' ', 'g');
    if char_length(clean) = 0 then
      clean := null;
    elsif char_length(clean) > 40 then
      raise exception 'invalid folder' using errcode = '22023';
    end if;
  end if;

  update public.chat_messages
  set
    pinned = coalesce(p_pinned, pinned),
    folder = case when p_set_folder then clean else folder end
  where id = p_message_id
    and user_id = auth.uid()
    and chatbot_id = p_chatbot_id;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.set_message_place(uuid, text, boolean, boolean, text) from public, anon;
grant execute on function public.set_message_place(uuid, text, boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- truncate_chat_from: deletes the caller's question and everything after it
-- in that conversation. Shared links are copies and stay.
-- ---------------------------------------------------------------------------
create or replace function public.truncate_chat_from(
  p_chatbot_id uuid,
  p_session_id text,
  p_message_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  started timestamptz;
  owner uuid;
  mark tid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_session_id is null
    or char_length(p_session_id) < 1
    or char_length(p_session_id) > 100
  then
    return 0;
  end if;

  select m.created_at, m.user_id, m.ctid
    into started, owner, mark
  from public.chat_messages m
  where m.id = p_message_id
    and m.chatbot_id = p_chatbot_id
    and m.session_id = p_session_id
    and m.role = 'user';

  if owner is null or owner <> auth.uid() or started is null then
    return 0;
  end if;

  delete from public.chat_messages m
  where m.user_id = auth.uid()
    and m.chatbot_id = p_chatbot_id
    and m.session_id = p_session_id
    and (
      m.created_at > started
      or (m.created_at = started and m.ctid >= mark)
    );

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.truncate_chat_from(uuid, text, text) from public, anon;
grant execute on function public.truncate_chat_from(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- uncited_library_files: documents of this assistant that no stored answer
-- has cited. Team admins only. Matching uses the library id, the OpenAI file
-- id, or the file name inside the saved citations.
-- ---------------------------------------------------------------------------
create or replace function public.uncited_library_files(p_chatbot_id uuid)
returns table (
  id uuid,
  file_name text,
  uploaded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
    or not public.is_team_admin_self(public.chatbot_team_id(p_chatbot_id))
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select f.id, f.file_name, f.uploaded_at
  from public.files f
  where f.chatbot_id = p_chatbot_id
    and not exists (
      select 1
      from public.chat_messages m
      where m.chatbot_id = p_chatbot_id
        and m.role = 'assistant'
        and (
          strpos(m.citations::text, f.id::text) > 0
          or (
            f.openai_file_id is not null
            and strpos(m.citations::text, f.openai_file_id) > 0
          )
          or (
            char_length(f.file_name) >= 8
            and strpos(lower(m.citations::text), lower(f.file_name)) > 0
          )
        )
    )
  order by f.uploaded_at desc
  limit 100;
end;
$$;

revoke all on function public.uncited_library_files(uuid) from public, anon;
grant execute on function public.uncited_library_files(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- source_proposals: a public document an admin might add later.
-- Nothing here is uploaded or indexed.
-- ---------------------------------------------------------------------------
create table if not exists public.source_proposals (
  id           uuid primary key default gen_random_uuid(),
  chatbot_id   uuid not null references public.chatbots(id) on delete cascade,
  source       text not null check (source in ('dof', 'cnbv', 'banxico')),
  external_id  text not null,
  title        text not null,
  url          text not null,
  published_on date,
  organ        text,
  status       text not null default 'proposed' check (status in ('proposed', 'dismissed')),
  created_at   timestamptz not null default now(),
  dismissed_by uuid references public.profiles(id) on delete set null,
  unique (chatbot_id, source, external_id)
);

create index if not exists source_proposals_chatbot_idx
  on public.source_proposals (chatbot_id, status, created_at desc);

alter table public.source_proposals enable row level security;
-- No policies: the server reads and writes with the service role after it
-- checks that the caller is a team admin. Members cannot list proposals.

create table if not exists public.source_watch_runs (
  chatbot_id uuid primary key references public.chatbots(id) on delete cascade,
  ran_at     timestamptz not null default now(),
  summary    jsonb not null default '{}'::jsonb
);

alter table public.source_watch_runs enable row level security;
