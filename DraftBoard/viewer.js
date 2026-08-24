// Viewer frontend: connects to Supabase and renders league + team views
// Replace with your Supabase URL and anon key
const SUPABASE_URL = 'https://ntaoxvlujawgackfeuhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50YW94dmx1amF3Z2Fja2ZldWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0ODczNjIsImV4cCI6MjEwMzA2MzM2Mn0.ff_F8kYpN2SlXcSuopys88utBMIIc3g4msMcBfT4Or4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STARTING_BUDGET = 200;
const REQUIRED_SLOTS = {
  QB: 1,
  RB: 2,
  WRTE: 3, // WR or TE combined
  FLEX: 1, // RB/WR/TE
  DEF: 1,
  K: 1
};

const els = {
  leagueView: document.getElementById('league-view'),
  teamsList: document.getElementById('teams-list'),
  teamView: document.getElementById('team-view'),
  backBtn: document.getElementById('back-btn'),
  teamTitle: document.getElementById('team-title'),
  teamMeta: document.getElementById('team-meta'),
  checklist: document.getElementById('required-checklist'),
  rosterList: document.getElementById('roster-list')
};

let state = {
  teams: [],
  players: {}, // map id -> player
  picks: []
};

async function init() {
  await loadAll();
  subscribeRealtime();
  els.backBtn.addEventListener('click', () => showLeague());
}

async function loadAll() {
  const [tRes, pRes, dRes] = await Promise.all([
    supabaseClient.from('teams').select('*'),
    supabaseClient.from('players').select('*'),
    supabaseClient.from('draft_picks').select('*')
  ]);

  state.teams = (tRes.data || []).slice();
  state.players = {};
  (pRes.data || []).forEach(p => state.players[p.id] = p);
  state.picks = (dRes.data || []).slice();
  await loadPlayersForPicks(state.picks);
  renderLeague();
}

async function loadPlayersForPicks(picks) {
  const playerIds = [...new Set(picks.map(pick => String(pick.player_id)).filter(Boolean))];
  if (!playerIds.length) return;

  const {data, error} = await supabaseClient.from('players').select('*').in('id', playerIds);
  if (error) {
    console.error('Unable to load drafted player details:', error);
    return;
  }

  (data || []).forEach(player => {
    state.players[String(player.id)] = player;
  });
}

function subscribeRealtime() {
  supabaseClient.channel('draft-channel')
    .on('postgres_changes', {event: '*', schema: 'public', table: 'draft_picks'}, payload => {
      // reload picks
      loadPicksOnly();
    })
    .on('postgres_changes', {event: '*', schema: 'public', table: 'players'}, payload => {
      loadPlayersOnly();
    })
    .subscribe();
}

async function loadPicksOnly() {
  const {data} = await supabaseClient.from('draft_picks').select('*');
  state.picks = data || [];
  await loadPlayersForPicks(state.picks);
  renderLeague();
  // if team view visible, refresh it
  if (!els.teamView.classList.contains('hidden')) {
    const teamId = +els.teamView.dataset.teamId;
    if (teamId) showTeam(teamId);
  }
}

async function loadPlayersOnly(){
  const {data} = await supabaseClient.from('players').select('*');
  state.players = {};
  (data||[]).forEach(p=> state.players[p.id] = p);
  if (!els.teamView.classList.contains('hidden')) {
    const teamId = +els.teamView.dataset.teamId;
    if (teamId) showTeam(teamId);
  }
}

function renderLeague() {
  els.teamsList.innerHTML = '';
  state.teams.forEach(team => {
    const teamPicks = state.picks.filter(dp => dp.team_id === team.id);
    const spent = teamPicks.reduce((s, x) => s + (x.cost||0), 0);
    const rosterCount = teamPicks.length;
    const remaining = STARTING_BUDGET - spent;

    const div = document.createElement('div');
    div.className = 'p-3 bg-gray-50 rounded border flex justify-between items-center';
    div.innerHTML = `
      <div>
        <div class="font-semibold">${escapeHtml(team.manager_name || 'Team '+team.id)}</div>
        <div class="text-sm text-gray-500">Roster: ${rosterCount} — Remaining: $${remaining}</div>
      </div>
      <div>
        <button data-team="${team.id}" class="view-team px-3 py-1 bg-blue-600 text-white rounded">View</button>
      </div>
    `;
    els.teamsList.appendChild(div);
  });

  document.querySelectorAll('.view-team').forEach(btn => {
    btn.addEventListener('click', (e) => showTeam(+e.target.dataset.team));
  });
}

function showLeague(){
  els.teamView.classList.add('hidden');
  els.leagueView.classList.remove('hidden');
}

function showTeam(teamId){
  const team = state.teams.find(t=>t.id===teamId);
  if (!team) return;
  els.leagueView.classList.add('hidden');
  els.teamView.classList.remove('hidden');
  els.teamView.dataset.teamId = teamId;
  els.teamTitle.textContent = team.manager_name || ('Team '+team.id);

  // roster
  const teamPicks = state.picks.filter(dp => dp.team_id === teamId).sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));
  const roster = teamPicks.map(dp => ({...dp, player: state.players[String(dp.player_id)]}));

  const spent = teamPicks.reduce((s,x)=>s+(x.cost||0),0);
  els.teamMeta.textContent = `Roster: ${teamPicks.length} — Spent: $${spent} — Total money left: $${STARTING_BUDGET - spent}`;

  // compute required checklist
  const status = computeRequiredStatus(roster.map(r=>r.player));
  renderChecklist(status);

  // roster list
  els.rosterList.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead class="border-b text-xs uppercase text-gray-500"><tr><th class="p-2">Player Name</th><th class="p-2">Position</th><th class="p-2">Depth</th><th class="p-2">Bye Week</th><th class="p-2">Injury Status</th><th class="p-2">Injury Text</th><th class="p-2">Cost</th></tr></thead><tbody id="roster-table-body"></tbody></table></div>';
  const rosterBody = document.getElementById('roster-table-body');
  roster.forEach(r=>{
    const name = r.player ? (r.player.name || r.player.display_name || r.player.full_name || r.player.id) : r.player_id;
    const pos = r.player ? (r.player.position || 'UNK') : 'UNK';
    const depth = r.player ? (r.player.depth_chart_position || r.player.depth_chart_order || '') : '';
    const byeWeek = r.player ? (r.player.bye_week || '') : '';
    const injuryStatus = r.player ? (r.player.injury_status || '') : '';
    const injuryText = r.player ? (r.player.injury_notes || '') : '';
    const row = document.createElement('tr');
    row.className = 'border-b align-top';
    row.innerHTML = `<td class="p-2 font-medium">${escapeHtml(name)}</td><td class="p-2">${escapeHtml(pos)}</td><td class="p-2">${escapeHtml(depth)}</td><td class="p-2">${escapeHtml(byeWeek)}</td><td class="p-2">${escapeHtml(injuryStatus)}</td><td class="p-2">${escapeHtml(injuryText)}</td><td class="p-2">$${r.cost}</td>`;
    rosterBody.appendChild(row);
  });
}

function renderChecklist(status){
  els.checklist.innerHTML = '';
  const items = [
    {k:'QB', label:'1 QB'},
    {k:'RB', label:'2 RB'},
    {k:'WRTE', label:'3 WR/TE'},
    {k:'FLEX', label:'1 Flex (RB/WR/TE)'},
    {k:'DEF', label:'1 DEF'},
    {k:'K', label:'1 K'}
  ];
  items.forEach(it=>{
    const ok = status[it.k].filled;
    const have = status[it.k].haveCount;
    const need = status[it.k].needCount;
    const div = document.createElement('div');
    div.className = `p-2 rounded ${ok? 'bg-green-50 border-green-200':'bg-red-50 border-red-200'} border`;
    div.innerHTML = `<div class="font-medium">${it.label}</div><div class="text-xs text-gray-600">Have: ${have} — Need: ${need}</div>`;
    els.checklist.appendChild(div);
  });
}

// Compute optimal assignment for required slots from an array of player objects
function computeRequiredStatus(players){
  // players: array of objects, each may have .position (e.g., 'QB','RB','WR','TE','DEF','K')
  const posCounts = {QB:0, RB:0, WR:0, TE:0, DEF:0, K:0, OTHER:0};
  players.forEach(p=>{
    if (!p || !p.position) { posCounts.OTHER++; return; }
    const pos = p.position.toUpperCase();
    if (posCounts.hasOwnProperty(pos)) posCounts[pos]++;
    else posCounts.OTHER++;
  });

  // Start assigning
  const status = {
    QB: {haveCount:0, needCount: REQUIRED_SLOTS.QB, filled:false},
    RB: {haveCount:0, needCount: REQUIRED_SLOTS.RB, filled:false},
    WRTE: {haveCount:0, needCount: REQUIRED_SLOTS.WRTE, filled:false},
    FLEX: {haveCount:0, needCount: REQUIRED_SLOTS.FLEX, filled:false},
    DEF: {haveCount:0, needCount: REQUIRED_SLOTS.DEF, filled:false},
    K: {haveCount:0, needCount: REQUIRED_SLOTS.K, filled:false}
  };

  // Assign strict slots first
  status.QB.haveCount = Math.min(posCounts.QB, REQUIRED_SLOTS.QB);
  status.QB.filled = status.QB.haveCount >= REQUIRED_SLOTS.QB;

  status.DEF.haveCount = Math.min(posCounts.DEF, REQUIRED_SLOTS.DEF);
  status.DEF.filled = status.DEF.haveCount >= REQUIRED_SLOTS.DEF;

  status.K.haveCount = Math.min(posCounts.K, REQUIRED_SLOTS.K);
  status.K.filled = status.K.haveCount >= REQUIRED_SLOTS.K;

  // For RB and WRTE and FLEX we must be careful
  // Use available RB, WR, TE counts
  let availRB = posCounts.RB;
  let availWR = posCounts.WR;
  let availTE = posCounts.TE;

  // Assign RB required slots
  status.RB.haveCount = Math.min(availRB, REQUIRED_SLOTS.RB);
  availRB -= status.RB.haveCount;
  status.RB.filled = status.RB.haveCount >= REQUIRED_SLOTS.RB;

  // Assign WRTE required slots (from WR then TE)
  let needWRTE = REQUIRED_SLOTS.WRTE;
  const takeWR = Math.min(availWR, needWRTE);
  status.WRTE.haveCount += takeWR; availWR -= takeWR; needWRTE -= takeWR;
  const takeTE = Math.min(availTE, needWRTE);
  status.WRTE.haveCount += takeTE; availTE -= takeTE; needWRTE -= takeTE;
  status.WRTE.filled = status.WRTE.haveCount >= REQUIRED_SLOTS.WRTE;

  // For FLEX, any remaining RB/WR/TE can be used
  const flexPool = availRB + availWR + availTE;
  status.FLEX.haveCount = Math.min(flexPool, REQUIRED_SLOTS.FLEX);
  status.FLEX.filled = status.FLEX.haveCount >= REQUIRED_SLOTS.FLEX;

  // Calculate needCount per slot
  status.QB.needCount = Math.max(0, REQUIRED_SLOTS.QB - status.QB.haveCount);
  status.RB.needCount = Math.max(0, REQUIRED_SLOTS.RB - status.RB.haveCount);
  status.WRTE.needCount = Math.max(0, REQUIRED_SLOTS.WRTE - status.WRTE.haveCount);
  status.FLEX.needCount = Math.max(0, REQUIRED_SLOTS.FLEX - status.FLEX.haveCount);
  status.DEF.needCount = Math.max(0, REQUIRED_SLOTS.DEF - status.DEF.haveCount);
  status.K.needCount = Math.max(0, REQUIRED_SLOTS.K - status.K.haveCount);

  return status;
}

function escapeHtml(s){
  if (!s) return '';
  return String(s).replace(/[&"'<>]/g, (c)=>({
    '&':'&amp;','"':'&quot;','\'':'&#39;','<':'&lt;','>':'&gt;'
  }[c]));
}

init().catch(err=>console.error(err));
