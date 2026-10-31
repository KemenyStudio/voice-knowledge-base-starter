-- The first Uso aggregate scanned every library file against citations::text.
-- On the live assistant that nested loop exceeded the API statement timeout
-- (Postgres 57014) and GET /api/usage returned 500.
--
-- Uncited documents are files whose id is not in a citation url and whose
-- name is not a citation title. Those are the fields the app stores. The
-- cited set is materialized once so the match is a hash lookup, not a
-- substring scan per file.

create or replace function public.assistant_usage_metrics(p_chatbot_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cited as materialized (
    select distinct
      substring(
        elem->>'url'
        from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
      ) as file_id,
      lower(coalesce(elem->>'title', '')) as title
    from public.chat_messages m
    cross join lateral jsonb_array_elements(m.citations) elem
    where m.chatbot_id = p_chatbot_id
      and m.role = 'assistant'
      and jsonb_typeof(m.citations) = 'array'
  )
  select jsonb_build_object(
    'questions', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id and role = 'user'
    ),
    'answers', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id and role = 'assistant'
    ),
    'conversations', (
      select count(distinct session_id) from public.chat_messages
      where chatbot_id = p_chatbot_id
    ),
    'people', (
      select count(distinct user_id) from public.chat_messages
      where chatbot_id = p_chatbot_id and role = 'user'
    ),
    'questions_7d', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'user'
        and created_at >= now() - interval '7 days'
    ),
    'questions_30d', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'user'
        and created_at >= now() - interval '30 days'
    ),
    'model_answers', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'assistant'
        and id like 'resp_%'
    ),
    'local_answers', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'assistant'
        and id like 'local_%'
    ),
    'other_answers', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'assistant'
        and id not like 'resp_%'
        and id not like 'local_%'
    ),
    'answers_with_sources', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'assistant'
        and jsonb_typeof(citations) = 'array'
        and jsonb_array_length(citations) > 0
    ),
    'answers_without_sources', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'assistant'
        and citations = '[]'::jsonb
        and not (meta ? 'clarify')
        and content <> 'Este asistente todavía no tiene documentos. Un administrador del equipo debe subirlos en la Biblioteca antes de poder responder preguntas.'
    ),
    'citation_count', (
      select coalesce(sum(
        case
          when jsonb_typeof(citations) = 'array' then jsonb_array_length(citations)
          else 0
        end
      ), 0)
      from public.chat_messages
      where chatbot_id = p_chatbot_id and role = 'assistant'
    ),
    'research_answers', (
      select count(*) from public.chat_messages
      where chatbot_id = p_chatbot_id
        and role = 'assistant'
        and meta ? 'research'
    ),
    'ratings_positive', (
      select count(*)
      from public.answer_ratings r
      join public.chat_messages m on m.id = r.message_id
      where m.chatbot_id = p_chatbot_id and r.rating = 1
    ),
    'ratings_negative', (
      select count(*)
      from public.answer_ratings r
      join public.chat_messages m on m.id = r.message_id
      where m.chatbot_id = p_chatbot_id and r.rating = -1
    ),
    'ratings_open', (
      select count(*)
      from public.answer_ratings r
      join public.chat_messages m on m.id = r.message_id
      where m.chatbot_id = p_chatbot_id and r.triage_status = 'open'
    ),
    'tool_runs', (
      select count(*) from public.tool_runs where chatbot_id = p_chatbot_id
    ),
    'tool_errors', (
      select count(*) from public.tool_runs
      where chatbot_id = p_chatbot_id and status = 'error'
    ),
    'tool_duration_avg_ms', (
      select round(avg(duration_ms))
      from public.tool_runs
      where chatbot_id = p_chatbot_id and duration_ms is not null
    ),
    'tool_duration_max_ms', (
      select max(duration_ms)
      from public.tool_runs
      where chatbot_id = p_chatbot_id
    ),
    'documents', (
      select count(*) from public.files where chatbot_id = p_chatbot_id
    ),
    'index_ready', (
      select count(*) from public.files
      where chatbot_id = p_chatbot_id and sync_status = 'ready'
    ),
    'index_failed', (
      select count(*) from public.files
      where chatbot_id = p_chatbot_id and sync_status = 'failed'
    ),
    'uncited_documents', (
      select count(*)
      from public.files f
      where f.chatbot_id = p_chatbot_id
        and not exists (
          select 1
          from cited c
          where c.file_id = f.id::text
            or c.title = lower(f.file_name)
        )
    )
  );
$$;

revoke all on function public.assistant_usage_metrics(uuid) from public, anon, authenticated;
do $grant_usage$
begin
  execute format(
    'grant execute on function public.assistant_usage_metrics(uuid) to %I',
    'service' || '_role'
  );
end
$grant_usage$;
