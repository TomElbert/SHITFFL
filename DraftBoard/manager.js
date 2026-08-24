const SUPABASE_URL = 'https://ntaoxvlujawgackfeuhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFub24iLCJpYXQiOjE3ODc0ODczNjIsImV4cCI6MjEwMzA2MzM2Mn0.ff_F8kYpN2SlXcSuopys88utBMIIc3g4msMcBfT4Or4';

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
  const {data, error} = await supabaseClient.from('teams').select('*').order('turn_order', {ascending:true, nullsFirst:false}).order('id', {ascending:true});
  if (error) {
    showMessage(error.message, true);
    return;
  }
  teams = data || [];
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
    row.innerHTML = `<input data-team-id="${team.id}" type="number" min="1" class="team-order w-20 p-2 border rounded" value="${team.turn_order || index + 1}" /><span class="flex-1">${escapeHtml(team.manager_name || ('Team '+team.id))}</span><button data-team-id="${team.id}" class="remove-team bg-red-600 text-white px-2 py-1 rounded">Remove</button>`;
    row.querySelector('.remove-team').addEventListener('click', () => removeTeam(team));
    teamsListEl.appendChild(row);
  });
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
