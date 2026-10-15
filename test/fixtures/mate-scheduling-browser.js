import { createHomeMateProposalCard } from '/modules/home-mate-creation.js';
import { createHomeDebateQuestionCard } from '/modules/home-debate-planning.js';
var socket;
var state;
function send(msg) { socket.send(JSON.stringify(msg)); }
function render(value) {
  state = value;
  var cards = document.getElementById('cards'); cards.replaceChildren();
  var schedules = document.getElementById('schedules'); schedules.replaceChildren();
  if (value.forbidden) { document.getElementById('status').textContent = 'Owner access required.'; return; }
  document.getElementById('status').textContent = value.schedules.length + ' saved schedules · ' + value.dispatched + ' dispatched';
  if (value.proposal) cards.appendChild(createHomeMateProposalCard({ proposal: value.proposal, status: 'pending' }, function (message, action) { send({ type: 'creation_response', proposalId: message.proposal.proposalId, action: action }); }));
  value.questions.forEach(function (message) {
    cards.appendChild(createHomeDebateQuestionCard(message, function (entry, action, opener, answers) { send({ type: 'home_mate_question_response', toolId: entry.toolId, answers: answers }); }));
  });
  value.schedules.forEach(function (record) {
    var li = document.createElement('li'); li.textContent = record.message + ' · ' + record.state + ' · ' + record.rule.anchorDate + ' ' + record.rule.time + ' UTC ';
    [['Read', 'read_schedule'], ['Update', 'update_schedule'], ['Cancel schedule', 'cancel_schedule']].forEach(function (action) {
      var button = document.createElement('button'); button.textContent = action[0]; button.disabled = record.state !== 'active' && action[0] !== 'Read';
      button.addEventListener('click', function () { send({ type: action[1], id: record.id, revision: record.revision }); }); li.appendChild(button);
    }); schedules.appendChild(li);
  });
  document.getElementById('evidence').textContent = JSON.stringify({ jobs: value.jobs.map(function (job) { return { id: job.id, state: job.state }; }), results: value.results }, null, 2);
  window.fixtureState = value;
}
function connect() {
  socket = new WebSocket('ws://' + location.host + location.search);
  socket.addEventListener('message', function (event) { var msg = JSON.parse(event.data); if (msg.type === 'fixture_state') render(msg); else document.getElementById('status').textContent = msg.error; });
}
document.getElementById('creation').addEventListener('click', function () { send({ type: 'review_creation' }); });
document.getElementById('existing').addEventListener('click', function () { send({ type: 'review_schedule' }); });
document.getElementById('reconnect').addEventListener('click', function () { socket.close(); connect(); });
document.getElementById('dispatch').addEventListener('click', function () { send({ type: 'dispatch' }); });
connect();
