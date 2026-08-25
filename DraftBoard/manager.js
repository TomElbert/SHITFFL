const SUPABASE_URL = 'https://ntaoxvlujawgackfeuhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50YW94dmx1amF3Z2Fja2ZldWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0ODczNjIsImV4cCI6MjEwMzA2MzM2Mn0.ff_F8kYpN2SlXcSuopys88utBMIIc3g4msMcBfT4Or4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const emailEl = document.getElementById('email');
const passwordEl = document.getElementById('password');
const signInBtn = document.getElementById('signin');
const authMsg = document.getElementById('auth-msg');
const teamNameEl = document.getElementById('team-name');
const addTeamBtn = document.getElementById('add-team');
const saveOrderBtn = document.getElementById('save-order');
const teamsListEl = document.getElementById('teams-list');
const messageEl = document.getElementById('message');

let teams = [];
let picks = [];
let players = {};

signInBtn.addEventListener('click', signIn);
[emailEl, passwordEl].forEach(input => input.addEventListener('keydown', event => {
  if (event.key === 'Enter') signIn();
}));
addTeamBtn.addEventListener('click', addTeam);
teamNameEl.addEventListener('keydown', event => {
  if (event.key === 'Enter') addTeam();
});
saveOrderBtn.addEventListener('click', saveOrder);

async function signIn() {
  authMsg.textContent = '';
  signInBtn.disabled = true;
  try {
    const {error} = await supabaseClient.auth.signInWithPassword({email: emailEl.value, password: passwordEl.value});
    if (error) {
      authMsg.textContent = error.message;
      return;
    }
    authEl.classList.add('hidden');
    appEl.classList.remove('hidden');
    await loadTeams();
  } catch (error) {
    authMsg.textContent = error.message || 'Unable to sign in.';
  } finally {
    signInBtn.disabled = false;
  }
}

async function loadTeams() {
  const [{data, error}, picksResult, playersResult] = await Promise.all([
    supabaseClient.from('teams').select('*').order('turn_order', {ascending:true, nullsFirst:false}).order('id', {ascending:true}),
    supabaseClient.from('draft_picks').select('*'),
    supabaseClient.from('players').select('id,position')
  ]);
  if (error) {
    showMessage(error.message, true);
    return;
  }
  teams = data || [];
  picks = picksResult.data || [];
  players = Object.fromEntries((playersResult.data || []).map(player => [String(player.id), player]));
  const pickIds = [...new Set(picks.map(pick => String(pick.player_id)).filter(Boolean))];
  if (pickIds.length) {
    const draftedPlayers = await supabaseClient.from('players').select('id,position').in('id', pickIds);
    if (draftedPlayers.error) {
      showMessage(draftedPlayers.error.message, true);
      return;
    }
    draftedPlayers.data.forEach(player => { players[String(player.id)] = player; });
  }
  renderTeams();
}

function renderTeams() {
  teamsListEl.innerHTML = '';
  if (!teams.length) {
    teamsListEl.innerHTML = '<p class="text-sm text-gray-500">No teams added yet.</p>';
    return;
  }
  teams.forEach((team, index) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 p-2 border rounded';
    const teamPicks = picks.filter(pick => Number(pick.team_id) === Number(team.id));
    const status = computeRequiredStatus(teamPicks.map(pick => players[String(pick.player_id)]));
    const canComplete = teamPicks.length >= 12 && Object.values(status).every(slot => slot.filled);
    row.innerHTML = `<input data-team-id="${team.id}" type="number" min="1" class="team-order w-20 p-2 border rounded" value="${team.turn_order || index + 1}" /><span class="flex-1">${escapeHtml(team.manager_name || ('Team '+team.id))} <span class="text-xs text-gray-500">${teamPicks.length}/14 players${team.completed ? ' | Completed' : ''}</span></span><button data-team-id="${team.id}" class="complete-team ${team.completed ? 'bg-yellow-600' : 'bg-green-600'} text-white px-2 py-1 rounded" ${!team.completed && !canComplete ? 'disabled' : ''}>${team.completed ? 'Reopen' : 'Mark Complete'}</button><button data-team-id="${team.id}" class="remove-team bg-red-600 text-white px-2 py-1 rounded">Remove</button>`;
    row.querySelector('.complete-team').addEventListener('click', () => setCompleted(team, !team.completed, canComplete));
    row.querySelector('.remove-team').addEventListener('click', () => removeTeam(team));
    teamsListEl.appendChild(row);
  });
}

async function setCompleted(team, completed, canComplete) {
  if (completed && !canComplete) {
    showMessage('A team must have at least 12 players and all required positions before completion.', true);
    return;
  }
  const {error} = await supabaseClient.from('teams').update({completed}).eq('id', team.id);
  if (error) { showMessage(error.message, true); return; }
  showMessage(completed ? 'Manager marked complete and removed from nomination rotation.' : 'Manager reopened.');
  await loadTeams();
}

function computeRequiredStatus(teamPlayers) {
  const counts = {QB:0, RB:0, WR:0, TE:0, DEF:0, K:0};
  (teamPlayers || []).forEach(player => { if (player && counts[player.position] !== undefined) counts[player.position] += 1; });
  const rb = Math.min(counts.RB, 2);
  const wrte = Math.min(counts.WR + counts.TE, 3);
  const flex = Math.min(Math.max(0, counts.RB - 2) + Math.max(0, counts.WR + counts.TE - 3), 1);
  return {QB:{filled:counts.QB >= 1},RB:{filled:counts.RB >= 2},WRTE:{filled:wrte >= 3},FLEX:{filled:flex >= 1},DEF:{filled:counts.DEF >= 1},K:{filled:counts.K >= 1}};
}

async function addTeam() {
  const managerName = teamNameEl.value.trim();
  if (!managerName) {
    showMessage('Enter a team or manager name first.', true);
    return;
  }
  const nextOrder = teams.reduce((highest, team) => Math.max(highest, Number(team.turn_order) || 0), 0) + 1;
  const {error} = await supabaseClient.from('teams').insert({manager_name:managerName, turn_order:nextOrder});
  if (error) {
    showMessage(error.message, true);
    return;
  }
  teamNameEl.value = '';
  showMessage('Team added. Save the order when ready.');
  await loadTeams();
}

async function removeTeam(team) {
  if (!window.confirm(`Remove ${team.manager_name || ('Team '+team.id)}? This will fail if the team already has draft picks.`)) return;
  const {error} = await supabaseClient.from('teams').delete().eq('id', team.id);
  if (error) {
    showMessage(error.message, true);
    return;
  }
  showMessage('Team removed. Save the order when ready.');
  await loadTeams();
}

async function saveOrder() {
  const entries = [...document.querySelectorAll('.team-order')].map(input => ({id:Number(input.dataset.teamId), order:Number(input.value)}));
  const orders = entries.map(entry => entry.order);
  if (entries.some(entry => !Number.isInteger(entry.order) || entry.order < 1) || new Set(orders).size !== orders.length) {
    showMessage('Each team needs a unique positive order number.', true);
    return;
  }
  const results = await Promise.all(entries.map(entry => supabaseClient.from('teams').update({turn_order:entry.order}).eq('id',entry.id)));
  const error = results.find(result => result.error)?.error;
  if (error) {
    showMessage(error.message, true);
    return;
  }
  showMessage('Team order saved.');
  await loadTeams();
}

function showMessage(message, isError = false) {
  messageEl.textContent = message;
  messageEl.className = `text-sm mt-3 ${isError ? 'text-red-500' : 'text-green-600'}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&"'<>]/g, character => ({'&':'&amp;','"':'&quot;','\'':'&#39;','<':'&lt;','>':'&gt;'}[character]));
}
