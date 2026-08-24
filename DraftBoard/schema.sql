-- Supabase schema for DraftBoard
-- Teams and draft_picks tables, RLS policies, and realtime publication

-- Create teams table
CREATE TABLE IF NOT EXISTS public.teams (
  id SERIAL PRIMARY KEY,
  manager_name TEXT,
  turn_order INTEGER
);

ALTER TABLE IF EXISTS public.teams
  ADD COLUMN IF NOT EXISTS turn_order INTEGER;

-- Persistent nomination-turn state. The Admin advances this after each team
-- has had its chance to nominate a player.
CREATE TABLE IF NOT EXISTS public.draft_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_turn_order INTEGER NOT NULL DEFAULT 1,
  round_number INTEGER NOT NULL DEFAULT 1,
  draft_started BOOLEAN NOT NULL DEFAULT FALSE,
  round_complete BOOLEAN NOT NULL DEFAULT FALSE,
  nominated_player_id TEXT REFERENCES public.players(id),
  last_winner_player_id TEXT REFERENCES public.players(id),
  last_winner_team_id INTEGER REFERENCES public.teams(id),
  last_winning_cost INTEGER
);

ALTER TABLE IF EXISTS public.draft_state
  ADD COLUMN IF NOT EXISTS draft_started BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.draft_state
  ADD COLUMN IF NOT EXISTS round_complete BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.draft_state
  ADD COLUMN IF NOT EXISTS nominated_player_id TEXT REFERENCES public.players(id);

ALTER TABLE IF EXISTS public.draft_state
  ADD COLUMN IF NOT EXISTS last_winner_player_id TEXT REFERENCES public.players(id);

ALTER TABLE IF EXISTS public.draft_state
  ADD COLUMN IF NOT EXISTS last_winner_team_id INTEGER REFERENCES public.teams(id);

ALTER TABLE IF EXISTS public.draft_state
  ADD COLUMN IF NOT EXISTS last_winning_cost INTEGER;

INSERT INTO public.draft_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Create draft_picks table
CREATE TABLE IF NOT EXISTS public.draft_picks (
  id SERIAL PRIMARY KEY,
  player_id TEXT REFERENCES public.players(id),
  team_id INTEGER REFERENCES public.teams(id),
  cost INTEGER NOT NULL,
  round_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

ALTER TABLE IF EXISTS public.draft_picks
  ADD COLUMN IF NOT EXISTS round_number INTEGER;

-- Add this to an existing players table so the Viewer can show NFL bye weeks.
ALTER TABLE IF EXISTS public.players
  ADD COLUMN IF NOT EXISTS bye_week INTEGER;

-- Enable Row Level Security
ALTER TABLE IF EXISTS public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.draft_state ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables
DROP POLICY IF EXISTS teams_public_select ON public.teams;
CREATE POLICY teams_public_select ON public.teams
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS draft_picks_public_select ON public.draft_picks;
CREATE POLICY draft_picks_public_select ON public.draft_picks
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS players_public_select ON public.players;
CREATE POLICY players_public_select ON public.players
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS draft_state_public_select ON public.draft_state;
CREATE POLICY draft_state_public_select ON public.draft_state
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS teams_authenticated_update ON public.teams;
CREATE POLICY teams_authenticated_update ON public.teams
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS teams_authenticated_insert ON public.teams;
CREATE POLICY teams_authenticated_insert ON public.teams
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS teams_authenticated_delete ON public.teams;
CREATE POLICY teams_authenticated_delete ON public.teams
  FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS draft_state_authenticated_update ON public.draft_state;
CREATE POLICY draft_state_authenticated_update ON public.draft_state
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Authenticated modify access for draft_picks
DROP POLICY IF EXISTS draft_picks_authenticated_insert ON public.draft_picks;
CREATE POLICY draft_picks_authenticated_insert ON public.draft_picks
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS draft_picks_authenticated_update ON public.draft_picks;
CREATE POLICY draft_picks_authenticated_update ON public.draft_picks
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS draft_picks_authenticated_delete ON public.draft_picks;
CREATE POLICY draft_picks_authenticated_delete ON public.draft_picks
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Authenticated modify access for players (to allow marking drafted)
DROP POLICY IF EXISTS players_authenticated_insert ON public.players;
CREATE POLICY players_authenticated_insert ON public.players
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS players_authenticated_update ON public.players;
CREATE POLICY players_authenticated_update ON public.players
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS players_authenticated_delete ON public.players;
CREATE POLICY players_authenticated_delete ON public.players
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Note: teams are read-only public. If you wish to restrict team creation/editing,
-- you may add authenticated policies similar to draft_picks/players.

-- Enable realtime publication for draft_picks, players, teams, and draft_state.
-- Add each table only when it is not already a member of the publication.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'draft_picks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_picks;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'players') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'draft_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_state;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_teams_turn_order ON public.teams(turn_order);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_draft_picks_team_id ON public.draft_picks(team_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_player_id ON public.draft_picks(player_id);

-- End of schema
