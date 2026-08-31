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
const showDraftedPlayers = document.getElementById('show-drafted-players');
const playerResults = document.getElementById('player-results');
const bidAmount = document.getElementById('bid-amount');
const teamSelect = document.getElementById('team-select');
const draftBtn = document.getElementById('draft-btn');
const draftMsg = document.getElementById('draft-msg');
const logList = document.getElementById('log-list');
const turnStatus = document.getElementById('turn-status');
const turnOrderList = document.getElementById('turn-order-list');
const startDraftBtn = document.getElementById('start-draft');
const syncPlayersBtn = document.getElementById('sync-players');
const nextRoundBtn = document.getElementById('next-round');
const resetDraftBtn = document.getElementById('reset-draft');
const draftControlMsg = document.getElementById('draft-control-msg');
const syncMsg = document.getElementById('sync-msg');
const draftResultSummary = document.getElementById('draft-result-summary');
const managerRosterOverview = document.getElementById('manager-roster-overview');

let cache = {players:[], teams:[], picks:[], draftState:null};
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
startDraftBtn.addEventListener('click', startDraft);
syncPlayersBtn.addEventListener('click', syncPlayers);
resetDraftBtn.addEventListener('click', resetDraft);
nextRoundBtn.addEventListener('click', proceedToNextRound);

async function loadAll(){
  try {
    const [players,tRes,dRes,sRes] = await Promise.all([
      loadAllPlayers(),
      supabaseClient.from('teams').select('*'),
      supabaseClient.from('draft_picks').select('*'),
      supabaseClient.from('draft_state').select('*').eq('id', 1).maybeSingle()
    ]);
    if (tRes.error) throw tRes.error;
    if (dRes.error) throw dRes.error;
    if (sRes.error) throw sRes.error;
    cache.players = players;
    cache.teams = tRes.data || [];
    cache.picks = (dRes.data || []).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
    cache.draftState = sRes.data || {current_turn_order:1, round_number:1, draft_started:false, round_complete:false, nominated_player_id:null, last_winner_player_id:null, last_winner_team_id:null, last_winning_cost:null};
    await loadPlayersForPicks(cache.picks);
    renderTeams();
    renderTurnControls();
    renderLog();
    renderManagerRosterOverview();
  } catch (error) {
    console.error('Failed to load draft data:', error);
    authMsg.textContent = 'Error loading draft data: ' + (error.message || String(error));
  }
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

function orderedTeams(){
  return cache.teams.filter(team => !team.completed).sort((a, b) => {
    const aOrder = Number.isInteger(Number(a.turn_order)) ? Number(a.turn_order) : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isInteger(Number(b.turn_order)) ? Number(b.turn_order) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || Number(a.id) - Number(b.id);
  });
}

function renderTurnControls(){
  const teams = orderedTeams();
  startDraftBtn.classList.toggle('hidden', Boolean(cache.draftState?.draft_started));
  syncPlayersBtn.classList.toggle('hidden', Boolean(cache.draftState?.draft_started));
  nextRoundBtn.classList.toggle('hidden', !Boolean(cache.draftState?.round_complete));
  draftBtn.disabled = Boolean(cache.draftState?.round_complete);
  turnOrderList.innerHTML = '';
  teams.forEach((team, index) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `<span class="w-8 font-semibold">${team.turn_order || index + 1}.</span><span>${escapeHtml(team.manager_name || ('Team '+team.id))}</span>`;
    turnOrderList.appendChild(row);
  });
  const current = teams.find(team => Number(team.turn_order) === Number(cache.draftState.current_turn_order));
  turnStatus.textContent = current
    ? `${cache.draftState.draft_started ? 'Round '+cache.draftState.round_number+': ' : 'Draft not started. '}${current.manager_name || ('Team '+current.id)} is ${cache.draftState.draft_started ? 'up to nominate a player.' : 'first in the saved order.'}`
    : 'Set and save a team order to begin the nomination turn.';
}

const BYE_WEEKS = {
  CAR:5, KC:5, CIN:6, DET:6, MIA:6, MIN:6, BUF:7, JAX:7, LAC:7, WAS:7,
  HOU:8, NO:8, NYG:8, SF:8, PIT:9, TEN:9, CHI:10, DEN:10, PHI:10, TB:10,
  ATL:11, CLE:11, GB:11, LAR:11, NE:11, SEA:11, BAL:13, IND:13, LV:13,
  NYJ:13, ARI:14, DAL:14
};

async function syncPlayers(){
  syncMsg.className = 'text-sm mt-2 text-gray-600';
  syncMsg.textContent = 'Fetching the latest player data...';
  syncPlayersBtn.disabled = true;
  try {
    const response = await fetch('https://api.sleeper.app/v1/players/nfl');
    if (!response.ok) throw new Error(`Sleeper API returned ${response.status}.`);
    const allPlayers = await response.json();
    const draftedResponse = await supabaseClient.from('players').select('id').eq('is_drafted', true);
    if (draftedResponse.error) throw draftedResponse.error;
    const draftedIds = new Set((draftedResponse.data || []).map(player => String(player.id)));
    const fantasyPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    const formattedPlayers = [];

    Object.entries(allPlayers).forEach(([playerId, player]) => {
      let position = player.position;
      if (!position && (player.fantasy_positions || []).includes('DEF')) position = 'DEF';
      const isActive = player.active === undefined || player.active === null ? true : player.active;
      if (!fantasyPositions.has(position) || !isActive) return;
      const nflTeam = player.team || 'FA';
      let name = `${player.first_name || ''} ${player.last_name || ''}`.trim();
      if (position === 'DEF') name = name || nflTeam || String(playerId);
      if (!name) return;
      const depthChartOrder = player.depth_chart_order === null || player.depth_chart_order === undefined ? null : Number(player.depth_chart_order);
      formattedPlayers.push({
        id:String(playerId), name, position, nfl_team:nflTeam,
        injury_status:player.injury_status || null, is_drafted:draftedIds.has(String(playerId)),
        depth_chart_position:player.depth_chart_position || null,
        depth_chart_order:Number.isFinite(depthChartOrder) ? depthChartOrder : null,
        status:player.status || null, injury_notes:player.injury_notes || null,
        injury_start_date:player.injury_start_date || null,
        espn_id:player.espn_id == null ? null : String(player.espn_id),
        yahoo_id:player.yahoo_id == null ? null : String(player.yahoo_id),
        rotowire_id:player.rotowire_id == null ? null : String(player.rotowire_id),
        bye_week:BYE_WEEKS[nflTeam] || null
      });
    });

    for (let index = 0; index < formattedPlayers.length; index += 500) {
      const batch = formattedPlayers.slice(index, index + 500);
      const {error} = await supabaseClient.from('players').upsert(batch, {onConflict:'id'});
      if (error) throw error;
      syncMsg.textContent = `Synced ${Math.min(index + batch.length, formattedPlayers.length)} of ${formattedPlayers.length} players...`;
    }
    syncMsg.className = 'text-sm mt-2 text-green-600';
    syncMsg.textContent = `Player sync complete. ${formattedPlayers.length} players updated.`;
    await loadAll();
  } catch (error) {
    syncMsg.className = 'text-sm mt-2 text-red-500';
    syncMsg.textContent = error.message || 'Player sync failed.';
  } finally {
    syncPlayersBtn.disabled = false;
    renderTurnControls();
  }
}

async function startDraft(){
  draftControlMsg.textContent = '';
  const teams = orderedTeams();
  if (!teams.length || teams.some(team => !Number.isInteger(Number(team.turn_order)) || Number(team.turn_order) < 1)) {
    draftControlMsg.textContent = 'Set a complete team order on the Manager Team Setup page first.';
    return;
  }
  const {error} = await supabaseClient.from('draft_state').update({draft_started:true, round_complete:false, current_turn_order:Number(teams[0].turn_order), round_number:1, nominated_player_id:null, last_winner_player_id:null, last_winner_team_id:null, last_winning_cost:null}).eq('id',1);
  if (error) { draftControlMsg.textContent = error.message; return; }
  await loadAll();
}

async function resetDraft(){
  const confirmation = window.prompt("This deletes every pick and resets every player. Type exactly: I know this will reset");
  if (confirmation !== 'I know this will reset') {
    draftControlMsg.textContent = 'Reset cancelled. The confirmation text did not match.';
    return;
  }
  draftControlMsg.textContent = '';
  const {error:pickError} = await supabaseClient.from('draft_picks').delete().neq('id', 0);
  if (pickError) { draftControlMsg.textContent = pickError.message; return; }
  const {error:playerError} = await supabaseClient.from('players').update({is_drafted:false}).neq('id', '');
  if (playerError) { draftControlMsg.textContent = playerError.message; return; }
  const {error:stateError} = await supabaseClient.from('draft_state').update({draft_started:false, round_complete:false, current_turn_order:1, round_number:1, nominated_player_id:null, last_winner_player_id:null, last_winner_team_id:null, last_winning_cost:null}).eq('id',1);
  if (stateError) { draftControlMsg.textContent = stateError.message; return; }
  draftControlMsg.textContent = 'Draft reset successfully.';
  await loadAll();
}

async function proceedToNextRound(){
  const teams = orderedTeams();
  if (!teams.length || teams.some(team => !Number.isInteger(Number(team.turn_order)) || Number(team.turn_order) < 1)) {
    draftControlMsg.textContent = 'Set a complete team order before starting another round.';
    return;
  }
  const {error} = await supabaseClient.from('draft_state').update({
    current_turn_order:Number(teams[0].turn_order),
    round_number:cache.draftState.round_number + 1,
    round_complete:false,
    nominated_player_id:null,
    last_winner_player_id:null,
    last_winner_team_id:null,
    last_winning_cost:null
  }).eq('id',1);
  if (error) { draftControlMsg.textContent = error.message; return; }
  await loadAll();
}

async function advanceTurn(){
  const allTeams = [...cache.teams].sort((a, b) => Number(a.turn_order || Number.MAX_SAFE_INTEGER) - Number(b.turn_order || Number.MAX_SAFE_INTEGER) || Number(a.id) - Number(b.id));
  const teams = allTeams.filter(team => !team.completed);
  if (!teams.length || allTeams.some(team => !Number.isInteger(Number(team.turn_order)) || Number(team.turn_order) < 1)) {
    draftMsg.textContent = 'Set a complete team order on the Manager Team Setup page before drafting.';
    return;
  }
  const nextTeam = teams.find(team => Number(team.turn_order) > Number(cache.draftState.current_turn_order)) || teams[0];
  const isLastTeam = !nextTeam || Number(nextTeam.turn_order) === Number(teams[0].turn_order);
  if (isLastTeam) {
    const {error} = await supabaseClient.from('draft_state').update({round_complete:true, nominated_player_id:null}).eq('id',1);
    if (error) draftMsg.textContent = error.message;
    await loadAll();
    return;
  }
  const {error} = await supabaseClient.from('draft_state').update({
    current_turn_order: nextTeam.turn_order,
    round_complete:false
  }).eq('id', 1);
  if (error) { draftMsg.textContent = error.message; return; }
  await loadAll();
}

function renderTeams(){
  teamSelect.innerHTML='<option value="" selected disabled>Select winning team</option>';
  cache.teams.filter(team => !team.completed).forEach(t=>{
    const opt = document.createElement('option'); opt.value = t.id; opt.text = t.manager_name || ('Team '+t.id);
    teamSelect.appendChild(opt);
  });
}

playerSearch.addEventListener('input', renderPlayerSearch);
showDraftedPlayers.addEventListener('change', ()=>{
  if (playerSearch.value.trim()) renderPlayerSearch();
  else playerResults.innerHTML = '';
});

function renderPlayerSearch(){
  const q = normalizeSearchText(playerSearch.value);
  const available = cache.players
    .filter(p=>(showDraftedPlayers.checked || !p.is_drafted) && normalizeSearchText(playerName(p)).includes(q))
    .sort((a, b) => {
      const aIsFreeAgent = (a.nfl_team || a.team || 'FA').toUpperCase() === 'FA';
      const bIsFreeAgent = (b.nfl_team || b.team || 'FA').toUpperCase() === 'FA';
      const aName = normalizeSearchText(playerName(a));
      const bName = normalizeSearchText(playerName(b));
      return Number(aIsFreeAgent) - Number(bIsFreeAgent)
        || Number(!aName.startsWith(q)) - Number(!bName.startsWith(q))
        || aName.localeCompare(bName);
    });
  playerResults.innerHTML='';
  available.slice(0,25).forEach(p=>{
    const div = document.createElement('div');
    const isDrafted = Boolean(p.is_drafted);
    div.className=`p-2 border-b flex justify-between items-center ${isDrafted ? 'cursor-not-allowed text-red-600 line-through' : 'cursor-pointer'}`;
    const name = playerName(p);
    div.innerHTML = `<div><div class="font-medium">${escapeHtml(name)}</div><div class="text-xs text-gray-500">${p.position||''} ${p.depth_chart_order?('<span class="text-yellow-600">★'+p.depth_chart_order+'</span>'):''} ${p.injury_status?'<span class="text-red-600">INJ</span>':''}</div></div><div class="text-sm text-gray-600">${p.nfl_team||p.team||''}</div>`;
    if (!isDrafted) div.addEventListener('click', ()=> selectPlayer(p));
    playerResults.appendChild(div);
  });
}

async function selectPlayer(p){
  if (cache.draftState?.round_complete) {
    draftMsg.textContent = 'Proceed to the next round before selecting another player.';
    return;
  }
  selectedPlayer = p;
  playerSearch.value = playerName(p);
  playerResults.innerHTML = `<div class="p-2 text-sm">Selected: ${escapeHtml(playerSearch.value)} ${p.injury_status?'<span class="text-red-600">INJ</span>':''}</div>`;
  const {error} = await supabaseClient.from('draft_state').update({
    nominated_player_id:p.id,
    last_winner_player_id:null,
    last_winner_team_id:null,
    last_winning_cost:null
  }).eq('id',1);
  if (error) draftMsg.textContent = `Player selected locally, but TV state could not update: ${error.message}`;
}

// Draft button logic with validations
draftBtn.addEventListener('click', async ()=>{
  draftMsg.textContent='';
  if (!cache.draftState?.draft_started) { draftMsg.textContent = 'Start the draft before entering picks.'; return; }
  if (cache.draftState?.round_complete) { draftMsg.textContent = 'Proceed to the next round before drafting again.'; return; }
  if (!selectedPlayer) { draftMsg.textContent = 'Select a player first'; return; }
  const bid = Number(bidAmount.value);
  if (!Number.isInteger(bid) || bid < 1) {
    draftMsg.textContent = 'Enter a bid amount of at least $1.';
    bidAmount.focus();
    return;
  }
  const teamId = Number(teamSelect.value);
  if (!teamId) { draftMsg.textContent = 'Select a team'; return; }

  // load current picks for team
  const teamPicks = cache.picks.filter(p=>Number(p.team_id) === teamId);
  if (teamPicks.length >= 14) { draftMsg.textContent = 'Team already at max roster (14)'; return; }

  const totalSpent = teamPicks.reduce((s,x)=>s+(x.cost||0),0);
  if (totalSpent + bid > STARTING_BUDGET) {
    draftMsg.textContent = `Bid exceeds the team's remaining budget of $${STARTING_BUDGET - totalSpent}.`;
    return;
  }

  const remainingRosterSpotsAfterPick = Math.max(0, 12 - (teamPicks.length + 1));
  const budgetAfterBid = STARTING_BUDGET - totalSpent - bid;
  if (budgetAfterBid < remainingRosterSpotsAfterPick) {
    draftMsg.textContent = `Bid too high. You must keep at least $${remainingRosterSpotsAfterPick} for the remaining players needed to reach 12.`;
    return;
  }

  // Evaluate the roster after this pick so the bid reserves money for every
  // required slot that is still empty.
  const rosterPlayers = teamPicks.map(dp => findPlayer(dp.player_id));
  const proposedRoster = [...rosterPlayers, selectedPlayer];
  const proposedStatus = computeRequiredStatus(proposedRoster);
  const remainingRequiredSlots = getRemainingRequiredSlots(proposedStatus);
  const proposedRosterCount = teamPicks.length + 1;
  const picksUntilMinimumRoster = Math.max(0, 12 - proposedRosterCount);
  const minimumDollarsToReserve = Math.max(remainingRequiredSlots, picksUntilMinimumRoster);

  if (remainingRequiredSlots > picksUntilMinimumRoster) {
    draftMsg.textContent = `This pick would make it impossible to complete the minimum team by pick 12. Remaining required slots: ${remainingRequiredSlots}.`;
    return;
  }

  const maxAllowable = STARTING_BUDGET - totalSpent - minimumDollarsToReserve;
  if (bid > maxAllowable) {
    draftMsg.textContent = `Bid too high. Max allowable: $${Math.max(0, maxAllowable)}. You must reserve $${minimumDollarsToReserve} for the remaining roster.`;
    return;
  }

  // OK: insert draft_picks and update player
  const {error:insErr} = await supabaseClient.from('draft_picks').insert([{player_id: selectedPlayer.id, team_id: teamId, cost: bid, round_number:cache.draftState.round_number}]);
  if (insErr) { draftMsg.textContent = insErr.message; return; }
  const {error:updErr} = await supabaseClient.from('players').update({is_drafted:true}).eq('id', selectedPlayer.id);
  if (updErr) { draftMsg.textContent = 'Drafted but failed to mark player: '+updErr.message; return; }

  const {error:stateError} = await supabaseClient.from('draft_state').update({
    nominated_player_id:null,
    last_winner_player_id:selectedPlayer.id,
    last_winner_team_id:teamId,
    last_winning_cost:bid
  }).eq('id',1);
  if (stateError) { draftMsg.textContent = `Draft saved, but TV winner state could not update: ${stateError.message}`; return; }

  await advanceTurn();
  draftMsg.textContent = 'Draft successful';
  renderDraftResultSummary(teamId);
  // reset selection
  selectedPlayer = null; playerSearch.value=''; bidAmount.value=''; playerResults.innerHTML='';
});

function getPositionCounts(picks){
  const counts = {QB:0, RB:0, WR:0, TE:0, DEF:0, K:0};
  picks.forEach(pick => {
    const position = (findPlayer(pick.player_id).position || '').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(counts, position)) counts[position]++;
  });
  return counts;
}

function formatPositionCounts(counts){
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([position, count]) => `${position}: ${count}`)
    .join(' | ') || 'No players';
}

function getTeamDraftSummary(teamId){
  const picks = cache.picks.filter(pick => Number(pick.team_id) === Number(teamId));
  const spent = picks.reduce((total, pick) => total + Number(pick.cost || 0), 0);
  return {
    picks,
    spent,
    remaining: STARTING_BUDGET - spent,
    counts: getPositionCounts(picks)
  };
}

function renderDraftResultSummary(teamId){
  const team = cache.teams.find(candidate => Number(candidate.id) === Number(teamId));
  if (!team) return;
  const summary = getTeamDraftSummary(teamId);
  draftResultSummary.textContent = `${team.manager_name || ('Team ' + team.id)} now has ${summary.picks.length} players: ${formatPositionCounts(summary.counts)}. $${summary.remaining} remaining.`;
}

function renderManagerRosterOverview(){
  managerRosterOverview.innerHTML = '';
  const slotOrder = {QB:1, RB:2, WRTE:3, FLEX:4, DEF:5, K:6, BENCH:7};
  cache.teams
    .slice()
    .sort((a, b) => Number(a.turn_order || Number.MAX_SAFE_INTEGER) - Number(b.turn_order || Number.MAX_SAFE_INTEGER) || Number(a.id) - Number(b.id))
    .forEach(team => {
      const summary = getTeamDraftSummary(team.id);
      const roster = summary.picks
        .map(pick => ({pick, player:findPlayer(pick.player_id)}))
        .sort((a, b) => {
          const aSlot = a.slot || 'BENCH';
          const bSlot = b.slot || 'BENCH';
          return (slotOrder[aSlot] || 99) - (slotOrder[bSlot] || 99)
            || playerName(a.player).localeCompare(playerName(b.player));
        });
      allocateRosterSlots(roster);
      roster.sort((a, b) => (slotOrder[a.slot] || 99) - (slotOrder[b.slot] || 99) || playerName(a.player).localeCompare(playerName(b.player)));
      const row = document.createElement('details');
      row.className = 'border-b pb-3 last:border-b-0 last:pb-0';
      const rosterHtml = roster.length
        ? roster.map(({pick, player, slot}) => `<li class="flex justify-between gap-3 py-1 border-t"><span><span class="font-semibold text-gray-500">${escapeHtml(slot)}</span> ${escapeHtml(playerName(player))}<span class="text-gray-500"> (${escapeHtml((player.position || 'UNK').toUpperCase())} - ${escapeHtml(player.nfl_team || player.team || 'FA')})</span></span><span class="whitespace-nowrap font-medium">$${Number(pick.cost || 0)}</span></li>`).join('')
        : '<li class="py-1 text-gray-500">No players drafted.</li>';
      row.innerHTML = `<summary class="cursor-pointer"><span class="font-medium">${escapeHtml(team.manager_name || ('Team ' + team.id))}</span><span class="inline-block ml-4 font-semibold">${summary.picks.length}/14 players | $${summary.remaining} left</span><span class="block text-sm text-gray-600 mt-1">${escapeHtml(formatPositionCounts(summary.counts))}</span></summary><ul class="text-sm mt-2">${rosterHtml}</ul>`;
      managerRosterOverview.appendChild(row);
    });
  if (!cache.teams.length) managerRosterOverview.textContent = 'No managers have been added.';
}

function allocateRosterSlots(roster){
  roster.forEach(entry => { entry.slot = 'BENCH'; });
  const byPosition = position => roster.filter(entry => (entry.player.position || '').toUpperCase() === position && entry.slot === 'BENCH');
  const assign = (position, slot, count) => byPosition(position).slice(0, count).forEach(entry => { entry.slot = slot; });
  assign('QB', 'QB', 1);
  assign('DEF', 'DEF', 1);
  assign('K', 'K', 1);
  assign('RB', 'RB', 2);
  assign('WR', 'WRTE', 3);
  assign('TE', 'WRTE', 3 - roster.filter(entry => entry.slot === 'WRTE').length);
  ['RB', 'WR', 'TE'].some(position => {
    const candidate = byPosition(position)[0];
    if (!candidate) return false;
    candidate.slot = 'FLEX';
    return true;
  });
}

function renderLog(){
  logList.innerHTML = '<div class="grid grid-cols-5 gap-2 px-2 pb-2 text-xs font-semibold uppercase text-gray-500"><div>Player Name</div><div>Position</div><div>Cost</div><div>Manager</div><div></div></div>';
  cache.picks.forEach(pick=>{
    const player = findPlayer(pick.player_id);
    const team = cache.teams.find(t=>Number(t.id)===Number(pick.team_id)) || {};
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

function getRemainingRequiredSlots(status){
  return Object.values(status).reduce((total, slot) => total + slot.needCount, 0);
}

function escapeHtml(s){ if (!s) return ''; return String(s).replace(/[&"'<>]/g, (c)=>({'&':'&amp;','"':'&quot;','\'':'&#39;','<':'&lt;','>':'&gt;'}[c])); }

function normalizeSearchText(value){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function playerName(player){
  return player.name || player.display_name || player.full_name || player.id || '';
}

function findPlayer(playerId){
  return cache.players.find(player => String(player.id) === String(playerId)) || {name:'Unknown', position:'UNK'};
}

// initial load of teams & players for search
(async ()=>{ try{ const [players,tRes,dRes,sRes] = await Promise.all([ loadAllPlayers(), supabaseClient.from('teams').select('*'), supabaseClient.from('draft_picks').select('*'), supabaseClient.from('draft_state').select('*').eq('id', 1).maybeSingle() ]); cache.players = players; cache.teams = tRes.data || []; cache.picks = (dRes.data||[]).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)); cache.draftState = sRes.data || {current_turn_order:1, round_number:1, draft_started:false, round_complete:false}; await loadPlayersForPicks(cache.picks); renderTeams(); renderTurnControls(); renderLog(); renderManagerRosterOverview(); }catch(e){ console.error(e);} })();
