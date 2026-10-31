-- Find and rename the signed-in user's own conversations.
--
-- Additive. The previous app never calls these functions. Search runs as the
-- caller (RLS still applies). Rename is security definer so it can set the
-- title without opening a general UPDATE policy on chat_messages.

-- ---------------------------------------------------------------------------
-- search_chat_sessions: conversations whose question, answer or title
-- contains the query. The match is literal (not LIKE), so "%" and "_" are
-- ordinary characters. At least 2 characters, at most 50 conversations.
-- ---------------------------------------------------------------------------
create or replace function public.search_chat_sessions(
  p_chatbot_id uuid,
  p_query text
)
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
  with matched as (
    select m.session_id
    from public.chat_messages m
    where m.user_id = (select auth.uid())
      and m.chatbot_id = p_chatbot_id
      and char_length(btrim(coalesce(p_query, ''))) >= 2
      and (
        strpos(lower(m.content), lower(btrim(p_query))) > 0
        or strpos(lower(coalesce(m.title, '')), lower(btrim(p_query))) > 0
      )
  )
  select
    m.session_id,
    (array_agg(m.title order by m.created_at) filter (where m.title is not null))[1],
    (array_agg(m.content order by m.created_at desc) filter (where m.role = 'user'))[1],
    max(m.created_at)
  from public.chat_messages m
  where m.user_id = (select auth.uid())
    and m.chatbot_id = p_chatbot_id
    and m.session_id in (select matched.session_id from matched)
  group by m.session_id
  order by max(m.created_at) desc
  limit 50;
$$;

revoke all on function public.search_chat_sessions(uuid, text) from public, anon;
grant execute on function public.search_chat_sessions(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- rename_chat_session: sets the title on every message of one conversation
-- owned by the caller. Returns how many rows changed (0 when it is not theirs).
-- ---------------------------------------------------------------------------
create or replace function public.rename_chat_session(
  p_chatbot_id uuid,
  p_session_id text,
  p_title text
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
  if p_session_id is null
    or char_length(p_session_id) < 1
    or char_length(p_session_id) > 100
  then
    return 0;
  end if;

  clean := btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', ' ', 'g'));
  clean := regexp_replace(clean, '[[:space:]]+', ' ', 'g');
  if char_length(clean) < 1 or char_length(clean) > 120 then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  update public.chat_messages
  set title = clean
  where user_id = auth.uid()
    and chatbot_id = p_chatbot_id
    and session_id = p_session_id;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.rename_chat_session(uuid, text, text) from public, anon;
grant execute on function public.rename_chat_session(uuid, text, text) to authenticated;
