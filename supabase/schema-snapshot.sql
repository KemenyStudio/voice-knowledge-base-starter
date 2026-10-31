-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NULL,
  full_name text NULL,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

alter table public.profiles enable row level security;


create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- Create Teams table with ON DELETE CASCADE for created_by reference
CREATE TABLE public.teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Chatbots table with ON DELETE CASCADE for team_id reference
CREATE TABLE public.chatbots (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Team Members table with ON DELETE CASCADE for team_id and user_id references
CREATE TABLE public.team_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, user_id)
);

-- Create indexes for better query performance
CREATE INDEX idx_teams_created_by ON public.teams(created_by);
CREATE INDEX idx_chatbots_team_id ON public.chatbots(team_id);
CREATE INDEX idx_team_members_team_id ON public.team_members(team_id);
CREATE INDEX idx_team_members_user_id ON public.team_members(user_id);

-- Set up Row Level Security (RLS) policies
-- Teams RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own teams" ON public.teams
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Users can insert their own teams" ON public.teams
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Chatbots RLS
ALTER TABLE public.chatbots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view chatbots in their teams" ON public.chatbots
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.teams
      WHERE id = public.chatbots.team_id AND created_by = auth.uid()
    )
  );

CREATE POLICY "Users can insert chatbots in their teams" ON public.chatbots
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.teams
      WHERE id = public.chatbots.team_id AND created_by = auth.uid()
    )
  );

-- Team Members RLS
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;


-- Function to check if a user is a team admin
CREATE OR REPLACE FUNCTION is_team_admin(team_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.team_members
    WHERE team_id = team_uuid AND user_id = user_uuid AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically add the team creator as an admin
CREATE OR REPLACE FUNCTION add_team_creator_as_admin()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'admin');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER add_team_creator_as_admin_trigger
AFTER INSERT ON public.teams
FOR EACH ROW
EXECUTE FUNCTION add_team_creator_as_admin();

CREATE POLICY "Can find id of user by email" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Allow insert on team_members"
ON public.team_members
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);


CREATE POLICY "Allow team admins to insert members" ON public.team_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.teams
      WHERE public.teams.id = team_members.team_id
      AND public.teams.created_by = auth.uid()
    )
  );

  CREATE POLICY "Allow team members to view team members" ON public.team_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.teams
      WHERE public.teams.id = team_members.team_id
      AND (
        public.teams.created_by = auth.uid() OR 
        EXISTS (
          SELECT 1
          FROM public.team_members AS tm
          WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid()
        )
      )
    )
  );

  ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_user_id_fkey;

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;



  -- Tabla de archivos asociados a chatbots
CREATE TABLE public.files (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  chatbot_id UUID REFERENCES public.chatbots(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_url TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

CREATE INDEX idx_files_chatbot_id ON public.files(chatbot_id);


ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Users can view files of their chatbots" ON public.files
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.chatbots
      WHERE public.chatbots.id = files.chatbot_id
      AND EXISTS (
        SELECT 1
        FROM public.teams
        WHERE public.teams.id = public.chatbots.team_id
        AND (
          public.teams.created_by = auth.uid() OR
          EXISTS (
            SELECT 1
            FROM public.team_members
            WHERE public.team_members.team_id = public.teams.id
            AND public.team_members.user_id = auth.uid()
          )
        )
      )
    )
  );


CREATE POLICY "Users can insert files into their chatbots" ON public.files
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chatbots
      WHERE public.chatbots.id = files.chatbot_id
      AND EXISTS (
        SELECT 1
        FROM public.teams
        WHERE public.teams.id = public.chatbots.team_id
        AND public.teams.created_by = auth.uid()
      )
    )
  );


CREATE TABLE public.feedback (
  question_id text NOT NULL,
  evaluation_set text NOT NULL,
  is_positive boolean NULL,
  timestamp timestamp with time zone NULL,
  created_by uuid NULL,
  chatbot_id uuid NULL,
  CONSTRAINT feedback_pkey PRIMARY KEY (question_id, evaluation_set),
  CONSTRAINT feedback_chatbot_id_fkey FOREIGN KEY (chatbot_id) REFERENCES chatbots(id),
  CONSTRAINT feedback_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id)
) TABLESPACE pg_default;

CREATE POLICY "Authenticated users can insert feedback if they belong to the chatbot team" 
ON public.feedback 
FOR INSERT 
TO authenticated 
WITH CHECK (
    EXISTS (
        SELECT 1 
        FROM public.team_members 
        WHERE team_members.user_id = auth.uid() 
        AND EXISTS (
            SELECT 1 
            FROM public.chatbots 
            WHERE chatbots.id = feedback.chatbot_id 
            AND chatbots.team_id = team_members.team_id
        )
    )
);

CREATE TABLE feedback_summary (
    evaluation_set text PRIMARY KEY,
    positive integer DEFAULT 0,
    negative integer DEFAULT 0
) WITH (OIDS=FALSE);

ALTER TABLE feedback_summary ENABLE ROW LEVEL SECURITY;

CREATE TABLE evaluation_results (
    evaluation_set text,
    data text,
    timestamp timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (evaluation_set)
) WITH (OIDS=FALSE);

ALTER TABLE evaluation_results ENABLE ROW LEVEL SECURITY;