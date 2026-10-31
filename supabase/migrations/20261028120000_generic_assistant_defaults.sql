-- Generic assistant defaults for a new deployment.
--
-- Additive. Fills only empty fields. Does not change system_prompt,
-- audience_options, a welcome that is already set, or a question list that
-- is already set.

-- ---------------------------------------------------------------------------
-- Example questions: new rows get a generic set. Existing empty lists are
-- filled.
-- Keep the JSON in sync with DEFAULT_SUGGESTED_QUESTIONS.
-- ---------------------------------------------------------------------------
alter table public.chatbots
  alter column suggested_questions set default '[
    {"category":"Start","prompts":[
      "What do the documents in this library cover?",
      "Summarize the main points in these documents.",
      "Which topics are in the library, and which are not?"
    ]}
  ]'::jsonb;

update public.chatbots
set suggested_questions = '[
    {"category":"Start","prompts":[
      "What do the documents in this library cover?",
      "Summarize the main points in these documents.",
      "Which topics are in the library, and which are not?"
    ]}
  ]'::jsonb
where suggested_questions = '[]'::jsonb;

-- Welcome text only where nobody has written one. Uses the assistant's name.
update public.chatbots
set welcome_message =
  'Hello, I''m ' || coalesce(nullif(btrim(name), ''), 'Document Search')
  || '. Ask about this private document library and I will answer with cited passages.'
where welcome_message is null;

-- ---------------------------------------------------------------------------
-- audience_aliases: a document tag that stands for several profiles.
-- Empty until an admin sets aliases for that assistant.
-- ---------------------------------------------------------------------------
alter table public.chatbots
  add column if not exists audience_aliases jsonb not null default '{}'::jsonb;

comment on column public.chatbots.audience_aliases is
  'Tag to audience-profile labels, for example {"socios":["Socio oro","Socio plata"]}. Empty means a tag maps only when it equals a profile or is the start of one.';

comment on column public.chatbots.audience_options is
  'Audience profiles a user can pick, at most 8. Empty turns the feature off. Labels are chosen per assistant.';

comment on column public.chatbots.suggested_questions is
  'Example questions for the empty chat: [{"category": text, "prompts": [text, ...]}]. New assistants start with a generic set.';
