-- Row Level Security hardening
--
-- Live state this migration was written to fix:
--   * RLS DISABLED on: team_members, files, feedback, feedback_summary, invitations
--     -> anyone holding the public anon key can read and modify every row.
--   * teams: SELECT policy "using (true)"         -> every team is world readable.
--   * chatbots: SELECT policy only checks that the team exists (no membership check).
--
-- !! APPLY ONLY AFTER the new app version is deployed. !!
-- The previous app version talks to these tables with the anon key and no user
-- session, so it stops working the moment RLS is enabled. The new version uses
-- the signed-in user's session (and the service role key for a few server-only
-- operations, see SUPABASE_SERVICE_ROLE_KEY in .env.example).
--
-- Roles: 'admin' can manage the team, chatbots, files and members; 'member' can
-- read and use everything in the team.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER avoids recursive policy evaluation)
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

create or replace function public.is_team_admin_self(p_team_id uuid)
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
        and tm.role = 'admin'
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
revoke all on function public.is_team_admin_self(uuid) from public, anon;
revoke all on function public.chatbot_team_id(uuid) from public, anon;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_admin_self(uuid) to authenticated;
grant execute on function public.chatbot_team_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;

drop policy if exists "Enable read access for all users" on public.teams;
drop policy if exists "Users can view their own teams" on public.teams;
drop policy if exists "Users can insert their own teams" on public.teams;

create policy "teams_select_member"
  on public.teams for select to authenticated
  using (created_by = (select auth.uid()) or public.is_team_member(id));

create policy "teams_insert_self"
  on public.teams for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "teams_update_admin"
  on public.teams for update to authenticated
  using (public.is_team_admin_self(id))
  with check (public.is_team_admin_self(id));

create policy "teams_delete_admin"
  on public.teams for delete to authenticated
  using (public.is_team_admin_self(id));

-- ---------------------------------------------------------------------------
-- team_members
-- (the add_team_creator_as_admin trigger is SECURITY DEFINER and bypasses RLS)
-- ---------------------------------------------------------------------------
alter table public.team_members enable row level security;

drop policy if exists "Allow insert on team_members" on public.team_members;
drop policy if exists "Allow team admins to insert members" on public.team_members;
drop policy if exists "Allow team members to view team members" on public.team_members;

create policy "team_members_select_same_team"
  on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_team_member(team_id));

create policy "team_members_insert_admin"
  on public.team_members for insert to authenticated
  with check (public.is_team_admin_self(team_id));

create policy "team_members_update_admin"
  on public.team_members for update to authenticated
  using (public.is_team_admin_self(team_id))
  with check (public.is_team_admin_self(team_id));

create policy "team_members_delete_admin_or_self"
  on public.team_members for delete to authenticated
  using (public.is_team_admin_self(team_id) or user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- invitations
-- Only team admins touch this table directly. Accepting an invitation happens
-- server-side with the service role (see app/actions/team.ts).
-- ---------------------------------------------------------------------------
alter table public.invitations enable row level security;

create policy "invitations_select_admin"
  on public.invitations for select to authenticated
  using (public.is_team_admin_self(team_id));

create policy "invitations_insert_admin"
  on public.invitations for insert to authenticated
  with check (public.is_team_admin_self(team_id));

create policy "invitations_delete_admin"
  on public.invitations for delete to authenticated
  using (public.is_team_admin_self(team_id));

-- ---------------------------------------------------------------------------
-- chatbots
-- ---------------------------------------------------------------------------
alter table public.chatbots enable row level security;

drop policy if exists "Users can view chatbots in their teams" on public.chatbots;
drop policy if exists "Users can insert chatbots in their teams" on public.chatbots;

create policy "chatbots_select_member"
  on public.chatbots for select to authenticated
  using (public.is_team_member(team_id));

create policy "chatbots_insert_admin"
  on public.chatbots for insert to authenticated
  with check (public.is_team_admin_self(team_id));

create policy "chatbots_update_admin"
  on public.chatbots for update to authenticated
  using (public.is_team_admin_self(team_id))
  with check (public.is_team_admin_self(team_id));

create policy "chatbots_delete_admin"
  on public.chatbots for delete to authenticated
  using (public.is_team_admin_self(team_id));

-- ---------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------
alter table public.files enable row level security;

drop policy if exists "Users can view files of their chatbots" on public.files;
drop policy if exists "Users can insert files into their chatbots" on public.files;

create policy "files_select_member"
  on public.files for select to authenticated
  using (public.is_team_member(public.chatbot_team_id(chatbot_id)));

create policy "files_insert_admin"
  on public.files for insert to authenticated
  with check (public.is_team_admin_self(public.chatbot_team_id(chatbot_id)));

create policy "files_update_admin"
  on public.files for update to authenticated
  using (public.is_team_admin_self(public.chatbot_team_id(chatbot_id)))
  with check (public.is_team_admin_self(public.chatbot_team_id(chatbot_id)));

create policy "files_delete_admin"
  on public.files for delete to authenticated
  using (public.is_team_admin_self(public.chatbot_team_id(chatbot_id)));

-- ---------------------------------------------------------------------------
-- feedback / feedback_summary
-- Users only see and write their own feedback rows. The aggregate table is
-- readable by any signed-in user and written only by the service role.
-- ---------------------------------------------------------------------------
alter table public.feedback enable row level security;
alter table public.feedback_summary enable row level security;

drop policy if exists "Authenticated users can insert feedback if they belong to the chatbot team" on public.feedback;

create policy "feedback_select_own"
  on public.feedback for select to authenticated
  using (created_by = (select auth.uid()));

create policy "feedback_insert_own"
  on public.feedback for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (chatbot_id is null or public.is_team_member(public.chatbot_team_id(chatbot_id)))
  );

create policy "feedback_update_own"
  on public.feedback for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy "feedback_summary_select_authenticated"
  on public.feedback_summary for select to authenticated
  using (true);
