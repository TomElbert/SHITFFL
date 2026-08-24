// Admin panel for DraftBoard
// Replace with your Supabase URL and anon key
const SUPABASE_URL = 'https://ntaoxvlujawgackfeuhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50YW94dmx1amF3Z2Fja2ZldWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0ODczNjIsImV4cCI6MjEwMzA2MzM2Mn0.ff_F8kYpN2SlXcSuopys88utBMIIc3g4msMcBfT4Or4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const STARTING_BUDGET = 200;
const REQUIRED_SLOTS = {QB:1, RB:2, WRTE:3, FLEX:1, DEF:1, K:1};

// Elements
const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const signinBtn = document.getElementById('signin');
const authMsg = document.getElementById('auth-msg');
const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const playerSearch = document.getElementById('player-search');
const playerResults = document.getElementById('player-results');
const bidAmount = document.getElementById('bid-amount');
const teamSelect = document.getElementById('team-select');
const draftBtn = document.getElementById('draft-btn');
const draftMsg = document.getElementById('draft-msg');
const logList = document.getElementById('log-list');

let cache = {players:[], teams:[], picks:[]};
let selectedPlayer = null;

async function signIn() {
  signinBtn.disabled = true;
  authMsg.textContent='';
  try {
    const {error} = await supabaseClient.auth.signInWithPassword({email: emailEl.value, password: passEl.value});
    if (error) {
      authMsg.textContent = error.message;
      return;
    }
    await loadAll();
    authEl.classList.add('hidden');
    appEl.classList.remove('hidden');
  } catch (error) {
    authMsg.textContent = error.message || 'Unable to sign in.';
  } finally {
    signinBtn.disabled = false;
  }
}

signinBtn.addEventListener('click', signIn);
[emailEl, passEl].forEach(input => input.addEventListener('keydown', event => {
  if (event.key === 'Enter') signIn();
}));

async function loadAll(){
  const [players,tRes,dRes] = await Promise.all([
    loadAllPlayers(),
    supabaseClient.from('teams').select('*'),
    supabaseClient.from('draft_picks').select('*')
  ]);
  cache.players = players;
  cache.teams = tRes.data || [];
  cache.picks = (dRes.data || []).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  await loadPlayersForPicks(cache.picks);
  renderTeams();
  renderLog();
}

async function loadAllPlayers(){
  const pageSize = 1000;
  const players = [];

  for (let page = 0; ; page += 1) {
    const {data, error} = await supabaseClient
      .from('players')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    players.push(...(data || []));
    if (!data || data.length < pageSize) return players;
  }
}

async function loadPlayersForPicks(picks){
  const playerIds = [...new Set(picks.map(pick => String(pick.player_id)).filter(Boolean))];
  if (!playerIds.length) return;

  const {data, error} = await supabaseClient.from('players').select('*').in('id', playerIds);
  if (error) {
    console.error('Unable to load drafted player details:', error);
    return;
  }

  const playersById = new Map(cache.players.map(player => [String(player.id), player]));
  (data || []).forEach(player => playersById.set(String(player.id), player));
  cache.players = [...playersById.values()];
}

function renderTeams(){
  teamSelect.innerHTML='<option value="" selected disabled>Select winning team</option>';
  cache.teams.forEach(t=>{
    const opt = document.createElement('option'); opt.value = t.id; opt.text = t.manager_name || ('Team '+t.id);
    teamSelect.appendChild(opt);
  });
}

playerSearch.addEventListener('input', ()=>{
  const q = playerSearch.value.trim().toLowerCase();
  const available = cache.players
    .filter(p=>!p.is_drafted && playerName(p).toLowerCase().includes(q))
    .sort((a, b) => {
      const aName = playerName(a).toLowerCase();
      const bName = playerName(b).toLowerCase();
      return Number(!aName.startsWith(q)) - Number(!bName.startsWith(q)) || aName.localeCompare(bName);
    });
  playerResults.innerHTML='';
  available.slice(0,25).forEach(p=>{
    const div = document.createElement('div');
    div.className='p-2 border-b cursor-pointer flex justify-between items-center';
    const name = playerName(p);
    div.innerHTML = `<div><div class="font-medium">${escapeHtml(name)}</div><div class="text-xs text-gray-500">${p.position||''} ${p.depth_chart_order?('<span class="text-yellow-600">★'+p.depth_chart_order+'</span>'):''} ${p.injury_status?'<span class="text-red-600">INJ</span>':''}</div></div><div class="text-sm text-gray-600">${p.nfl_team||p.team||''}</div>`;
    div.addEventListener('click', ()=> selectPlayer(p));
    playerResults.appendChild(div);
  });
});

function selectPlayer(p){
  selectedPlayer = p;
  playerSearch.value = playerName(p);
  playerResults.innerHTML = `<div class="p-2 text-sm">Selected: ${escapeHtml(playerSearch.value)} ${p.injury_status?'<span class="text-red-600">INJ</span>':''}</div>`;
}

// Draft button logic with validations
draftBtn.addEventListener('click', async ()=>{
  draftMsg.textContent='';
  if (!selectedPlayer) { draftMsg.textContent = 'Select a player first'; return; }
  const bid = Math.max(1, Math.floor(Number(bidAmount.value)||0));
  const teamId = Number(teamSelect.value);
  if (!teamId) { draftMsg.textContent = 'Select a team'; return; }

  // load current picks for team
  const teamPicks = cache.picks.filter(p=>p.team_id === teamId);
  if (teamPicks.length >= 14) { draftMsg.textContent = 'Team already at max roster (14)'; return; }

  const totalSpent = teamPicks.reduce((s,x)=>s+(x.cost||0),0);
  // compute remaining required slots optimally from existing roster
  const rosterPlayers = teamPicks.map(dp => findPlayer(dp.player_id));
  const status = computeRequiredStatus(rosterPlayers);
  const remainingRequiredSlots = Object.values(status).reduce((acc,s)=> acc + (s.needCount||0), 0);

  const maxAllowable = STARTING_BUDGET - totalSpent - remainingRequiredSlots + 1;
  if (bid > maxAllowable) { draftMsg.textContent = `Bid too high. Max allowable: $${maxAllowable}`; return; }

  // OK: insert draft_picks and update player
  const {error:insErr} = await supabaseClient.from('draft_picks').insert([{player_id: selectedPlayer.id, team_id: teamId, cost: bid}]);
  if (insErr) { draftMsg.textContent = insErr.message; return; }
  const {error:updErr} = await supabaseClient.from('players').update({is_drafted:true}).eq('id', selectedPlayer.id);
  if (updErr) { draftMsg.textContent = 'Drafted but failed to mark player: '+updErr.message; }

  draftMsg.textContent = 'Draft successful';
  // refresh
  await loadAll();
  // reset selection
  selectedPlayer = null; playerSearch.value=''; bidAmount.value=''; playerResults.innerHTML='';
});

function renderLog(){
  logList.innerHTML = '<div class="grid grid-cols-5 gap-2 px-2 pb-2 text-xs font-semibold uppercase text-gray-500"><div>Player Name</div><div>Position</div><div>Cost</div><div>Manager</div><div></div></div>';
  cache.picks.forEach(pick=>{
    const player = findPlayer(pick.player_id);
    const team = cache.teams.find(t=>t.id===pick.team_id) || {};
    const div = document.createElement('div');
    div.className = 'draft-log-row grid grid-cols-5 gap-2 items-center p-2 border-b text-sm';
    div.innerHTML = `<div class="font-medium">${escapeHtml(playerName(player) || pick.player_id)}</div><div>${escapeHtml(player.position || '')}</div><div>$${pick.cost}</div><div>${escapeHtml(team.manager_name || ('Team '+pick.team_id))}</div><div><button data-id="${pick.id}" class="edit-px bg-yellow-500 text-white px-2 py-1 rounded text-sm">Edit</button></div>`;
    logList.appendChild(div);
  });
  document.querySelectorAll('.edit-px').forEach(btn=> btn.addEventListener('click', onEditPick));
}

async function onEditPick(e){
  const id = Number(e.target.dataset.id);
  const pick = cache.picks.find(p=>p.id===id);
  if (!pick) return;

  const row = e.target.closest('.draft-log-row');
  row.className = 'p-3 border-b bg-gray-100';
  row.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
      <select id="edit-team" class="p-2 border rounded"></select>
      <input id="edit-cost" type="number" min="1" class="p-2 border rounded" placeholder="Cost" />
      <input id="edit-player" class="p-2 border rounded md:col-span-2" placeholder="Search player" />
    </div>
    <div id="edit-player-results" class="mt-2 max-h-32 overflow-auto"></div>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <button id="save-edit" class="bg-blue-600 text-white px-3 py-2 rounded">Save</button>
      <button id="cancel-edit" class="bg-gray-400 text-white px-3 py-2 rounded">Cancel</button>
      <div id="edit-msg" class="text-sm text-red-500"></div>
    </div>
  `;

  // populate teams
  const editTeam = row.querySelector('#edit-team');
  cache.teams.forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.text=t.manager_name||('Team '+t.id); editTeam.appendChild(o); });
  editTeam.value = pick.team_id;
  row.querySelector('#edit-cost').value = pick.cost;
  const editPlayerInput = row.querySelector('#edit-player');
  const editPlayerResults = row.querySelector('#edit-player-results');

  // prefill player
  const currentPlayer = findPlayer(pick.player_id);
  editPlayerInput.value = currentPlayer ? playerName(currentPlayer) : pick.player_id;

  // search in edit
  editPlayerInput.addEventListener('input', ()=>{
    const q = editPlayerInput.value.toLowerCase();
    const list = cache.players
      .filter(p=>playerName(p).toLowerCase().includes(q))
      .sort((a, b) => {
        const aName = playerName(a).toLowerCase();
        const bName = playerName(b).toLowerCase();
        return Number(!aName.startsWith(q)) - Number(!bName.startsWith(q)) || aName.localeCompare(bName);
      });
    editPlayerResults.innerHTML='';
    list.slice(0,25).forEach(p=>{
      const d=document.createElement('div'); d.className='p-1 border-b cursor-pointer'; d.textContent = playerName(p)+` ${p.position||''}`;
      d.addEventListener('click', ()=>{ editPlayerInput.dataset.selected = p.id; editPlayerInput.value = playerName(p); editPlayerResults.innerHTML=''; });
      editPlayerResults.appendChild(d);
    });
  });

  row.querySelector('#cancel-edit').addEventListener('click', renderLog);

  row.querySelector('#save-edit').addEventListener('click', async ()=>{
    const newTeam = Number(editTeam.value);
    const newCost = Math.max(0, Math.floor(Number(row.querySelector('#edit-cost').value)||0));
    const newPlayerId = editPlayerInput.dataset.selected || pick.player_id;

    // Perform update in transaction-like sequence
    // 1) If player changed, mark old player's is_drafted=false and new player's is_drafted=true
    try{
      if (newPlayerId !== pick.player_id){
        // mark new player drafted
        const { error: u1 } = await supabaseClient.from('players').update({is_drafted:true}).eq('id', newPlayerId);
        if (u1) throw u1;
        // mark old player undrafted
        const { error: u2 } = await supabaseClient.from('players').update({is_drafted:false}).eq('id', pick.player_id);
        if (u2) throw u2;
      }
      // update draft_picks
      const { error: upd } = await supabaseClient.from('draft_picks').update({player_id:newPlayerId, team_id:newTeam, cost:newCost}).eq('id', pick.id);
      if (upd) throw upd;
      await loadAll();
    } catch(err){
      row.querySelector('#edit-msg').textContent = err.message || String(err);
    }
  });
}

// Utility: compute required status; same algorithm as viewer
function computeRequiredStatus(players){
  const posCounts = {QB:0, RB:0, WR:0, TE:0, DEF:0, K:0, OTHER:0};
  players.forEach(p=>{ if (!p||!p.position) { posCounts.OTHER++; return;} const pos = p.position.toUpperCase(); if (posCounts.hasOwnProperty(pos)) posCounts[pos]++; else posCounts.OTHER++; });
  const status = {QB:{haveCount:0,needCount:REQUIRED_SLOTS.QB,filled:false}, RB:{haveCount:0,needCount:REQUIRED_SLOTS.RB,filled:false}, WRTE:{haveCount:0,needCount:REQUIRED_SLOTS.WRTE,filled:false}, FLEX:{haveCount:0,needCount:REQUIRED_SLOTS.FLEX,filled:false}, DEF:{haveCount:0,needCount:REQUIRED_SLOTS.DEF,filled:false}, K:{haveCount:0,needCount:REQUIRED_SLOTS.K,filled:false}};
  status.QB.haveCount = Math.min(posCounts.QB, REQUIRED_SLOTS.QB);
  status.QB.filled = status.QB.haveCount >= REQUIRED_SLOTS.QB;
  status.DEF.haveCount = Math.min(posCounts.DEF, REQUIRED_SLOTS.DEF); status.DEF.filled = status.DEF.haveCount>=REQUIRED_SLOTS.DEF;
  status.K.haveCount = Math.min(posCounts.K, REQUIRED_SLOTS.K); status.K.filled = status.K.haveCount>=REQUIRED_SLOTS.K;
  let availRB = posCounts.RB; let availWR = posCounts.WR; let availTE = posCounts.TE;
  status.RB.haveCount = Math.min(availRB, REQUIRED_SLOTS.RB); availRB -= status.RB.haveCount; status.RB.filled = status.RB.haveCount>=REQUIRED_SLOTS.RB;
  let needWRTE = REQUIRED_SLOTS.WRTE; const takeWR = Math.min(availWR, needWRTE); status.WRTE.haveCount += takeWR; availWR -= takeWR; needWRTE -= takeWR; const takeTE = Math.min(availTE, needWRTE); status.WRTE.haveCount += takeTE; availTE -= takeTE; needWRTE -= takeTE; status.WRTE.filled = status.WRTE.haveCount >= REQUIRED_SLOTS.WRTE;
  const flexPool = availRB + availWR + availTE; status.FLEX.haveCount = Math.min(flexPool, REQUIRED_SLOTS.FLEX); status.FLEX.filled = status.FLEX.haveCount>=REQUIRED_SLOTS.FLEX;
  status.QB.needCount = Math.max(0, REQUIRED_SLOTS.QB - status.QB.haveCount);
  status.RB.needCount = Math.max(0, REQUIRED_SLOTS.RB - status.RB.haveCount);
  status.WRTE.needCount = Math.max(0, REQUIRED_SLOTS.WRTE - status.WRTE.haveCount);
  status.FLEX.needCount = Math.max(0, REQUIRED_SLOTS.FLEX - status.FLEX.haveCount);
  status.DEF.needCount = Math.max(0, REQUIRED_SLOTS.DEF - status.DEF.haveCount);
  status.K.needCount = Math.max(0, REQUIRED_SLOTS.K - status.K.haveCount);
  return status;
}

function escapeHtml(s){ if (!s) return ''; return String(s).replace(/[&"'<>]/g, (c)=>({'&':'&amp;','"':'&quot;','\'':'&#39;','<':'&lt;','>':'&gt;'}[c])); }

function playerName(player){
  return player.name || player.display_name || player.full_name || player.id || '';
}

function findPlayer(playerId){
  return cache.players.find(player => String(player.id) === String(playerId)) || {};
}

// initial load of teams & players for search
(async ()=>{ try{ const [players,tRes,dRes] = await Promise.all([ loadAllPlayers(), supabaseClient.from('teams').select('*'), supabaseClient.from('draft_picks').select('*') ]); cache.players = players; cache.teams = tRes.data || []; cache.picks = (dRes.data||[]).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)); await loadPlayersForPicks(cache.picks); renderTeams(); renderLog(); }catch(e){ console.error(e);} })();
