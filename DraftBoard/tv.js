const SUPABASE_URL = 'https://ntaoxvlujawgackfeuhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50YW94dmx1amF3Z2Fja2ZldWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0ODczNjIsImV4cCI6MjEwMzA2MzM2Mn0.ff_F8kYpN2SlXcSuopys88utBMIIc3g4msMcBfT4Or4';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const els = {
  round: document.getElementById('round-display'),
  nominator: document.getElementById('nominator'),
  nominated: document.getElementById('nominated-player'),
  nominatedMeta: document.getElementById('nominated-meta'),
  winner: document.getElementById('winner-player'),
  winnerMeta: document.getElementById('winner-meta'),
  recapRound: document.getElementById('recap-round'),
  recap: document.getElementById('recap-list')
};

let state = {teams:[], players:{}, picks:[], draftState:null};

async function loadAll(){
  const [teamsResult, playersResult, picksResult, stateResult] = await Promise.all([
    supabaseClient.from('teams').select('*'),
    supabaseClient.from('players').select('*'),
    supabaseClient.from('draft_picks').select('*'),
    supabaseClient.from('draft_state').select('*').eq('id', 1).maybeSingle()
  ]);
  const errors = [teamsResult, playersResult, picksResult, stateResult].filter(result => result.error);
  if (errors.length) throw errors[0].error;
  state.teams = teamsResult.data || [];
  state.players = {};
  (playersResult.data || []).forEach(player => state.players[String(player.id)] = player);
  state.picks = picksResult.data || [];
  state.draftState = stateResult.data || {current_turn_order:1, round_number:1, draft_started:false};
  await loadPlayersForPicks([
    ...state.picks,
    {player_id: state.draftState.nominated_player_id},
    {player_id: state.draftState.last_winner_player_id}
  ]);
  render();
}

async function loadPlayersForPicks(picks){
  const ids = [...new Set(picks.map(pick => String(pick.player_id)).filter(Boolean))];
  if (!ids.length) return;
  const {data, error} = await supabaseClient.from('players').select('*').in('id', ids);
  if (error) throw error;
  (data || []).forEach(player => state.players[String(player.id)] = player);
}

function subscribe(){
  supabaseClient.channel('tv-draft-channel')
    .on('postgres_changes', {event:'*', schema:'public', table:'draft_state'}, loadAll)
    .on('postgres_changes', {event:'*', schema:'public', table:'draft_picks'}, loadAll)
    .on('postgres_changes', {event:'*', schema:'public', table:'teams'}, loadAll)
    .on('postgres_changes', {event:'*', schema:'public', table:'players'}, loadAll)
    .subscribe();
}

function orderedTeams(){
  return [...state.teams].sort((a,b) => Number(a.turn_order || 999999) - Number(b.turn_order || 999999) || Number(a.id) - Number(b.id));
}

function findPlayer(id){ return state.players[String(id)] || {}; }
function playerName(player, fallback='Unknown player'){ return player.name || player.display_name || player.full_name || fallback; }

function render(){
  const teams = orderedTeams();
  const currentTeam = teams.find(team => Number(team.turn_order) === Number(state.draftState.current_turn_order));
  const nominated = findPlayer(state.draftState.nominated_player_id);
  const winner = findPlayer(state.draftState.last_winner_player_id);
  const winnerTeam = state.teams.find(team => Number(team.id) === Number(state.draftState.last_winner_team_id));

  els.round.textContent = state.draftState.draft_started ? `Round ${state.draftState.round_number}` : 'Draft not started';
  els.nominator.textContent = state.draftState.draft_started && currentTeam ? currentTeam.manager_name || `Team ${currentTeam.id}` : 'Waiting';
  els.nominated.textContent = state.draftState.nominated_player_id ? playerName(nominated, state.draftState.nominated_player_id) : 'Waiting for nomination';
  els.nominatedMeta.textContent = nominated.position ? `${nominated.position} — ${nominated.nfl_team || 'FA'}` : '';
  els.winner.textContent = state.draftState.last_winner_player_id ? playerName(winner, state.draftState.last_winner_player_id) : 'No completed auction yet';
  els.winnerMeta.textContent = state.draftState.last_winner_player_id ? `${winnerTeam?.manager_name || 'Unknown team'} — $${state.draftState.last_winning_cost}` : '';

  const recapRound = state.picks.reduce((highest, pick) => Math.max(highest, Number(pick.round_number) || 1), 0);
  const recapPicks = state.picks.filter(pick => (Number(pick.round_number) || 1) === recapRound).sort((a,b) => Number(b.id) - Number(a.id));
  els.recapRound.textContent = recapPicks.length ? `Round ${recapRound}` : '';
  els.recap.innerHTML = recapPicks.length ? '' : '<tr><td colspan="4" class="p-3 text-gray-400">No completed auctions yet.</td></tr>';
  recapPicks.forEach(pick => {
    const player = findPlayer(pick.player_id);
    const team = state.teams.find(item => Number(item.id) === Number(pick.team_id));
    const row = document.createElement('tr');
    row.className = 'border-b border-gray-700';
    row.innerHTML = `<td class="p-3">${escapeHtml(playerName(player, pick.player_id))}</td><td class="p-3">${escapeHtml(player.position || '')}</td><td class="p-3">${escapeHtml(team?.manager_name || `Team ${pick.team_id}`)}</td><td class="p-3">$${pick.cost}</td>`;
    els.recap.appendChild(row);
  });
}

function escapeHtml(value){ return String(value || '').replace(/[&"'<>]/g, character => ({'&':'&amp;','"':'&quot;','\'':'&#39;','<':'&lt;','>':'&gt;'}[character])); }

loadAll().then(subscribe).catch(error => { console.error(error); els.round.textContent = 'Unable to load draft'; });
