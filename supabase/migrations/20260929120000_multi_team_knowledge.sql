-- Multi-team knowledge bases
--
-- Additive and backwards compatible: safe to apply BEFORE deploying the new app
-- version (the old code ignores the new columns).
--
-- Each chatbot owns one OpenAI vector store (chatbots.vector_store_id).
-- Each file records where it lives (files.vector_store_id / files.openai_file_id),
-- which blob holds the original (files.blob_name) and its indexing state.

-- ---------------------------------------------------------------------------
-- chatbots
-- ---------------------------------------------------------------------------
alter table public.chatbots
  add column if not exists vector_store_id text,
  add column if not exists system_prompt text;

comment on column public.chatbots.vector_store_id is
  'OpenAI vector store that holds this chatbot''s documents. Created lazily on first upload.';
comment on column public.chatbots.system_prompt is
  'Optional per-chatbot instructions. When null the app uses a generic default prompt.';

-- A vector store must never be shared by two chatbots (hard tenant isolation).
create unique index if not exists chatbots_vector_store_id_key
  on public.chatbots (vector_store_id)
  where vector_store_id is not null;

-- ---------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------
alter table public.files
  add column if not exists blob_name text,
  add column if not exists openai_file_id text,
  add column if not exists vector_store_id text,
  add column if not exists sync_status text not null default 'external',
  add column if not exists sync_error text,
  add column if not exists size_bytes bigint,
  add column if not exists uploaded_by uuid references auth.users (id) on delete set null;

alter table public.files
  drop constraint if exists files_sync_status_check;
alter table public.files
  add constraint files_sync_status_check
  check (sync_status in ('pending', 'processing', 'ready', 'failed', 'external'));

comment on column public.files.blob_name is
  'Object name inside the storage container. Null for legacy rows (derive from file_url).';
comment on column public.files.sync_status is
  'pending|processing|ready|failed = managed by the app; external = indexed outside the app (legacy).';

create index if not exists idx_files_chatbot_uploaded
  on public.files (chatbot_id, uploaded_at desc);

create index if not exists idx_files_openai_file_id
  on public.files (openai_file_id)
  where openai_file_id is not null;
