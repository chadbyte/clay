// Fixture-only Home transcript card on the real app's authenticated /ws connection.
import { store } from '/modules/store.js';
import { getWs } from '/modules/ws-ref.js';
import { createHomeDebateQuestionCard, markHomeDebateQuestionSubmitting } from '/modules/home-debate-planning.js';
var opened = false, question, surface;
function respond(item, action, button, answers) {
  markHomeDebateQuestionSubmitting(item, button);
  getWs().send(JSON.stringify({ type: 'home_mate_question_response', mateId: 'FIXTURE_MATE_ID', sessionId: 'local:FIXTURE_SOURCE_SESSION', requestId: 'integration-global', toolId: item.toolId, answers: answers }));
}
function open() {
  var ws = getWs();
  if (opened || !store.get('connected') || !ws || ws.readyState !== 1) return;
  opened = true;
  surface = document.createElement('section'); surface.id = 'fixture-home-review';
  surface.style.cssText = 'position:fixed;z-index:100000;top:12px;left:20px;right:20px;max-width:700px;padding:16px;background:var(--bg);border:1px solid var(--border);border-radius:12px';
  surface.textContent = 'Isolated Home transcript on authenticated global /ws'; document.body.appendChild(surface);
  ws.addEventListener('message', function (event) {
    var msg = JSON.parse(event.data);
    if (msg.type === 'home_mate_history') surface.textContent = 'Home conversation loaded through global /ws';
    if (msg.type === 'home_mate_question') { question = { role: 'question', flow: 'mate_question', toolId: msg.toolId, status: 'pending', questions: msg.questions }; surface.replaceChildren(createHomeDebateQuestionCard(question, respond)); }
    if (msg.type === 'home_mate_question_resolved' && question) { question.status = msg.status; question.answers = msg.answers; surface.replaceChildren(createHomeDebateQuestionCard(question, respond)); }
  });
  ws.send(JSON.stringify({ type: 'home_mate_session_open', mateId: 'FIXTURE_MATE_ID', sessionId: 'local:FIXTURE_SOURCE_SESSION', requestId: 'integration-global' }));
}
store.subscribe(open); setTimeout(open, 100);
