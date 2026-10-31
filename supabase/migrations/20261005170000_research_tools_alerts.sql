-- Research mode, assistant tools and regulatory change alerts.
--
-- Additive and backwards compatible: safe to apply BEFORE deploying the new
-- app version. Defaults are conservative: alerts are drafts until an admin
-- publishes them, emails need both an admin decision and the user's opt-in.

-- ---------------------------------------------------------------------------
-- chatbots: per-assistant switches
--   research_enabled  users may ask for "Investigar a fondo" (always opt-in per question)
--   enabled_tools     text-only helpers offered under answers (no side effects)
-- ---------------------------------------------------------------------------
alter table public.chatbots
  add column if not exists research_enabled boolean not null default true,
  add column if not exists enabled_tools text[] not null default array['draft_email', 'memo', 'check_validity']::text[];

-- ---------------------------------------------------------------------------
-- files: version link. superseded_by points to the document that replaces
-- this one (set only when an admin confirms a change alert).
-- ---------------------------------------------------------------------------
alter table public.files
  add column if not exists superseded_by uuid references public.files(id) on delete set null;

-- ---------------------------------------------------------------------------
-- assistant_user_prefs: opt-in for e-mail notices. Off by default.
-- ---------------------------------------------------------------------------
alter table public.assistant_user_prefs
  add column if not exists email_alerts boolean not null default false;

-- ---------------------------------------------------------------------------
-- tool_runs: audit log of the assistant tools
-- ---------------------------------------------------------------------------
create table if not exists public.tool_runs (
  id           uuid primary key default gen_random_uuid(),
  chatbot_id   uuid not null references public.chatbots(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  tool         text not null,
  status       text not null check (status in ('ok', 'error')),
  input        jsonb not null default '{}'::jsonb,
  output_chars integer,
  duration_ms  integer,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists tool_runs_chatbot_idx
  on public.tool_runs (chatbot_id, created_at desc);

alter table public.tool_runs enable row level security;

drop policy if exists "tool_runs_select_admin" on public.tool_runs;
create policy "tool_runs_select_admin"
  on public.tool_runs for select to authenticated
  using (public.is_team_admin_self(public.chatbot_team_id(chatbot_id)));
-- Writes happen only from the server with the service role.

-- ---------------------------------------------------------------------------
-- change_alerts: "this document replaces that one"
--   status  pending (suggested, needs an admin) | published | dismissed
-- ---------------------------------------------------------------------------
create table if not exists public.change_alerts (
  id           uuid primary key default gen_random_uuid(),
  chatbot_id   uuid not null references public.chatbots(id) on delete cascade,
  new_file_id  uuid not null references public.files(id) on delete cascade,
  old_file_id  uuid not null references public.files(id) on delete cascade,
  source       text not null default 'detected' check (source in ('detected', 'manual')),
  status       text not null default 'pending' check (status in ('pending', 'published', 'dismissed')),
  score        numeric,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  decided_by   uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (new_file_id, old_file_id),
  check (new_file_id <> old_file_id)
);

create index if not exists change_alerts_chatbot_idx
  on public.change_alerts (chatbot_id, status, created_at desc);

create table if not exists public.change_alert_recipients (
  alert_id   uuid not null references public.change_alerts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  seen_at    timestamptz,
  emailed_at timestamptz,
  primary key (alert_id, user_id)
);

create index if not exists change_alert_recipients_user_idx
  on public.change_alert_recipients (user_id, seen_at);

alter table public.change_alerts enable row level security;
alter table public.change_alert_recipients enable row level security;

drop policy if exists "change_alerts_select" on public.change_alerts;
create policy "change_alerts_select"
  on public.change_alerts for select to authenticated
  using (
    public.is_team_admin_self(public.chatbot_team_id(chatbot_id))
    or (
      status = 'published'
      and exists (
        select 1 from public.change_alert_recipients r
        where r.alert_id = change_alerts.id
          and r.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "change_alert_recipients_select" on public.change_alert_recipients;
create policy "change_alert_recipients_select"
  on public.change_alert_recipients for select to authenticated
  using (user_id = (select auth.uid()));
-- Writes happen only from the server with the service role.
