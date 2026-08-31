const SUPABASE_URL = 'https://ntaoxvlujawgackfeuhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50YW94dmx1amF3Z2Fja2ZldWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0ODczNjIsImV4cCI6MjEwMzA2MzM2Mn0.ff_F8kYpN2SlXcSuopys88utBMIIc3g4msMcBfT4Or4';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const els = {
  status: document.getElementById('rankings-status'),
  list: document.getElementById('rankings-list')
};
const POSITION_LABELS = {QB: 'Quarterbacks', RB: 'Running Backs', WR: 'Wide Receivers', TE: 'Tight Ends', DEF: 'Team Defenses', K: 'Kickers'};
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'DEF', 'K'];

let state = {players: [], picks: [], teams: []};

async function loadAll() {
  try {
    const [players, picksResult, teamsResult] = await Promise.all([
      loadAllPlayers(),
      supabaseClient.from('draft_picks').select('*'),
      supabaseClient.from('teams').select('*')
    ]);
    if (picksResult.error) throw picksResult.error;
    if (teamsResult.error) throw teamsResult.error;
    state = {players, picks: picksResult.data || [], teams: teamsResult.data || []};
    renderRankings();
  } catch (error) {
    console.error('Failed to load rankings status:', error);
    els.status.textContent = 'Unable to load live draft status.';
  }
}

async function loadAllPlayers() {
  const players = [];
  const pageSize = 1000;
  for (let page = 0; ; page += 1) {
    const {data, error} = await supabaseClient.from('players').select('*').range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    players.push(...(data || []));
    if (!data || data.length < pageSize) return players;
  }
}

function subscribe() {
  supabaseClient.channel('rankings-draft-channel')
    .on('postgres_changes', {event: '*', schema: 'public', table: 'draft_picks'}, loadAll)
    .on('postgres_changes', {event: '*', schema: 'public', table: 'players'}, loadAll)
    .on('postgres_changes', {event: '*', schema: 'public', table: 'teams'}, loadAll)
    .subscribe();
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function playerName(player) {
  return player.name || player.display_name || player.full_name || '';
}

function findDatabasePlayer(ranking) {
  const rankingName = normalizeName(ranking.name);
  const exactNameMatches = state.players.filter(player => normalizeName(playerName(player)) === rankingName);
  return exactNameMatches.find(player => (player.position || '').toUpperCase() === ranking.position && (player.nfl_team || player.team || '') === ranking.team)
    || exactNameMatches.find(player => (player.position || '').toUpperCase() === ranking.position)
    || exactNameMatches[0]
    || state.players.find(player => (player.position || '').toUpperCase() === ranking.position && (player.nfl_team || player.team || '') === ranking.team);
}

function renderRankings() {
  const draftedByPlayerId = new Map(state.picks.map(pick => [String(pick.player_id), pick]));
  const teamsById = new Map(state.teams.map(team => [Number(team.id), team]));
  const sections = POSITION_ORDER.map((position, index) => {
    const rankings = RANKINGS.filter(ranking => ranking.position === position);
    const draftedCount = rankings.reduce((count, ranking) => {
      const player = findDatabasePlayer(ranking);
      return count + Number(Boolean(player && draftedByPlayerId.has(String(player.id))));
    }, 0);
    const rows = rankings.map(ranking => {
      const player = findDatabasePlayer(ranking);
      const pick = player ? draftedByPlayerId.get(String(player.id)) : null;
      const manager = pick ? teamsById.get(Number(pick.team_id)) : null;
      const draftedClass = pick ? 'bg-red-50 text-red-700 line-through' : 'bg-white';
      const draftedNote = pick ? `<span class="block text-xs font-semibold text-red-700 no-underline">Drafted by ${escapeHtml(manager?.manager_name || `Team ${pick.team_id}`)} for $${pick.cost}</span>` : '';
      const matchNote = player ? '' : '<span class="block text-xs text-yellow-700">Not matched to player database</span>';
      return `<li class="grid items-center gap-2 border-t border-gray-200 px-3 py-1 leading-tight ${draftedClass}" style="grid-template-columns:1.75rem minmax(0,1fr) auto auto"><span class="text-sm font-semibold text-gray-500">${ranking.rank}</span><span class="min-w-0 truncate font-semibold">${escapeHtml(ranking.name)}${draftedNote}${matchNote}</span><span class="whitespace-nowrap text-xs text-gray-600">${escapeHtml(ranking.team)} | B${ranking.byeWeek}</span><span class="whitespace-nowrap text-right text-xs text-gray-600">#${ranking.overallRank}</span></li>`;
    }).join('');
    return `<details class="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm" ${index === 0 ? 'open' : ''}><summary class="cursor-pointer bg-gray-800 px-4 py-4 text-lg font-bold text-white"><span>${POSITION_LABELS[position]}</span><span class="ml-3 text-sm font-normal text-gray-300">${draftedCount}/${rankings.length} drafted</span></summary><ol>${rows}</ol></details>`;
  });
  els.list.innerHTML = sections.join('');
  els.status.textContent = `${state.picks.length} player${state.picks.length === 1 ? '' : 's'} drafted. Drafted rankings are crossed off in red.`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&"'<>]/g, character => ({'&':'&amp;','"':'&quot;','\'':'&#39;','<':'&lt;','>':'&gt;'}[character]));
}

loadAll().then(subscribe);
