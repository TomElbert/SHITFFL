-- Supabase schema for DraftBoard
-- Teams and draft_picks tables, RLS policies, and realtime publication

-- Create teams table
CREATE TABLE IF NOT EXISTS public.teams (
  id SERIAL PRIMARY KEY,
  manager_name TEXT
);

-- Create draft_picks table
CREATE TABLE IF NOT EXISTS public.draft_picks (
  id SERIAL PRIMARY KEY,
  player_id TEXT REFERENCES public.players(id),
  team_id INTEGER REFERENCES public.teams(id),
  cost INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Add this to an existing players table so the Viewer can show NFL bye weeks.
ALTER TABLE IF EXISTS public.players
  ADD COLUMN IF NOT EXISTS bye_week INTEGER;

-- Enable Row Level Security
ALTER TABLE IF EXISTS public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.players ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables
CREATE POLICY teams_public_select ON public.teams
  FOR SELECT
  USING (true);

CREATE POLICY draft_picks_public_select ON public.draft_picks
  FOR SELECT
  USING (true);

CREATE POLICY players_public_select ON public.players
  FOR SELECT
  USING (true);

-- Authenticated modify access for draft_picks
CREATE POLICY draft_picks_authenticated_insert ON public.draft_picks
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY draft_picks_authenticated_update ON public.draft_picks
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY draft_picks_authenticated_delete ON public.draft_picks
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Authenticated modify access for players (to allow marking drafted)
CREATE POLICY players_authenticated_insert ON public.players
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY players_authenticated_update ON public.players
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY players_authenticated_delete ON public.players
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Note: teams are read-only public. If you wish to restrict team creation/editing,
-- you may add authenticated policies similar to draft_picks/players.

-- Enable realtime publication for draft_picks and players
-- (Run as a privileged SQL role / psql in Supabase SQL editor)
ALTER PUBLICATION supabase_realtime
  ADD TABLE public.draft_picks;

ALTER PUBLICATION supabase_realtime
  ADD TABLE public.players;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_draft_picks_team_id ON public.draft_picks(team_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_player_id ON public.draft_picks(player_id);

-- End of schema
