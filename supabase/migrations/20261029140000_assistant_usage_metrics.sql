-- Counts for the Uso page. The route calls this with the service role
-- after it has checked that the caller is a team admin.
--
-- Nothing new is stored. Chat answer latency and model errors are not
-- columns, so this function does not return them.

create or replace function public.assistant_usage_metrics(p_chatbot_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
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
    -- Same exclusion the previous Uso list used: clarifying questions and the
    -- canned empty-library reply are not answers that failed to cite.
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
