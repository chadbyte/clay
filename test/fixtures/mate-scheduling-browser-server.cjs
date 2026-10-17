var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var home = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-schedule-browser-'));
process.env.HOME = home;
process.env.CLAY_HOME = home;
process.env.TZ = 'UTC';
var clock = Date.UTC(2031, 0, 1, 8, 0);
Date.now = function () { return clock; };
var WebSocketServer = require('ws').WebSocketServer;
var r = require('./mate-scheduling-runtime.cjs').runtime();
var events = require('../../lib/server-home-chat-events');
var publicRoot = path.resolve(__dirname, '../../lib/public');
var clients = new Set();
var target = r.create();
var targetTools;
var interviewer;
var interviewTools;
var pendingResults = [];
var homeConsent = require('../../lib/server-home-mcp-consent').attachHomeMcpConsent({
  findMateProject: function (actor, id) { return actor === r.owner.id && id === target.mate.id ? { mate: target.mate, ctx: target.project, slug: 'mate-' + target.mate.id } : null; },
  resolveHomeSession: function (found, actor, id) { return actor === r.owner.id && id === target.session.sessionOriginId ? target.session : null; },
  messageTap: function (ws) { return ws.tap; }, isActorLive: function (ws, actor) { return ws._clayUser.id === actor && !!r.users.findUserById(actor); },
  sendError: function (ws, id, error) { ws.send(JSON.stringify({ type: 'fixture_error', error: error })); },
});
function tool(tools, name) { return tools.find(function (item) { return item.name === name; }); }
function rule() { return { version: 1, timezone: 'server-local', anchorDate: '2031-01-01', time: '09:00', recurrence: null }; }
function state(ws) {
  if (ws._clayUser.id !== r.owner.id) return { type: 'fixture_state', forbidden: true };
  var session = target.session;
  var proposal = interviewer && interviewer.session.history.findLast(function (event) { return event.type === 'mate_creation_proposal'; });
  var resolution = proposal && interviewer.session.history.findLast(function (event) { return event.type === 'mate_creation_proposal_resolved' && event.proposalId === proposal.proposal.proposalId; });
  ws.tap = { mateSlug: 'mate-' + target.mate.id, sessionId: session.localId, requestId: 'fixture-view' };
  return { type: 'fixture_state', mateId: target.mate.id, sessionId: session.sessionOriginId,
    proposal: proposal && !resolution ? proposal.proposal : null,
    questions: events.historyToHomeChat(session.history, false, false, session.pendingAskUser).filter(function (item) { return item.role === 'question'; }),
    schedules: session.mateSchedules || [], jobs: r.scheduler.listJobs().filter(function (job) { return job.projectId === 'mate-' + target.mate.id; }),
    dispatched: session.history.filter(function (event) { return event.type === 'scheduled_message_sent'; }).length,
    results: pendingResults };
}
function publish() { clients.forEach(function (ws) { if (ws.readyState === 1) ws.send(JSON.stringify(state(ws))); }); }
async function beginCreation() {
  if (!interviewer) {
    var clay = r.mates.getAllMates(r.mates.buildMateCtx(r.owner.id)).find(function (mate) { return mate.builtinKey === 'clay'; });
    interviewer = r.open(clay, true);
    interviewer.session.mateCreationMode = true;
    interviewer.sm.sendAndRecord(interviewer.session, { type: 'ask_user_answered', toolId: 'fixture-interview', answers: { 0: 'A daily brief partner' } });
    interviewTools = await r.tools(interviewer);
  }
  var definition = r.definition({ message: 'Send my creation-time briefing', scheduleRule: rule() });
  definition.activities = JSON.stringify(definition.activities);
  definition.communicationStyle = JSON.stringify(definition.communicationStyle);
  definition.scheduleIntent = JSON.stringify(definition.scheduleIntent);
  tool(interviewTools, 'propose_mate').handler(definition).then(async function () {
    var resolved = interviewer.session.history.findLast(function (event) { return event.type === 'mate_creation_proposal_resolved'; });
    if (resolved && resolved.action === 'create') {
      var project = r.projects.get('mate-' + resolved.mateId);
      target = { mate: r.mates.getMate(r.mates.buildMateCtx(r.owner.id), resolved.mateId), project: project, sm: project.getSessionManager() };
      target.session = Array.from(target.sm.sessions.values()).find(function (session) { return session.ownerId === r.owner.id; });
      targetTools = await r.tools(target);
    }
    publish();
  });
}
function observe(promise) { promise.then(function (result) { pendingResults.push(JSON.parse(result.content[0].text)); publish(); }); }
var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  var file = url.pathname === '/' ? path.join(__dirname, 'mate-scheduling-browser.html') : url.pathname === '/fixture.js' ? path.join(__dirname, 'mate-scheduling-browser.js') : path.resolve(publicRoot, '.' + url.pathname);
  if (file.indexOf(publicRoot + path.sep) !== 0 && file !== path.join(__dirname, 'mate-scheduling-browser.html') && file !== path.join(__dirname, 'mate-scheduling-browser.js')) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (error, data) {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
var wss = new WebSocketServer({ server: server });
wss.on('connection', function (ws, req) {
  ws._clayUser = req.url.indexOf('foreign=1') >= 0 ? r.stranger : r.owner;
  clients.add(ws); ws.send(JSON.stringify(state(ws)));
  ws.on('close', function () { clients.delete(ws); });
  ws.on('message', async function (raw) {
    try {
      var msg = JSON.parse(raw);
      if (ws._clayUser.id !== r.owner.id) { ws.send(JSON.stringify({ type: 'fixture_error', error: 'Owner access required.' })); return; }
      if (!targetTools || ['cancel_schedule', 'read_schedule', 'update_schedule'].indexOf(msg.type) >= 0) targetTools = await r.tools(target);
      if (msg.type === 'review_creation') await beginCreation();
      else if (msg.type === 'creation_response') interviewer.project.handleHomeMateCreationProposalResponse(ws, msg, interviewer.session);
      else if (msg.type === 'review_schedule') observe(tool(targetTools, 'propose_mate_schedule').handler({ message: 'Send my existing-Mate briefing', scheduleRule: rule() }));
      else if (msg.type === 'home_mate_question_response') homeConsent.respond(ws, r.owner.id, Object.assign({ mateId: target.mate.id, sessionId: target.session.sessionOriginId, requestId: 'fixture-view' }, msg));
      else if (msg.type === 'cancel_schedule') observe(tool(targetTools, 'cancel_mate_schedule').handler(msg));
      else if (msg.type === 'read_schedule') observe(tool(targetTools, 'read_mate_schedule').handler(msg));
      else if (msg.type === 'update_schedule') observe(tool(targetTools, 'update_mate_schedule').handler(Object.assign({}, msg, { date: '2031-01-02', time: '10:30' })));
      else if (msg.type === 'dispatch') { clock = Date.UTC(2031, 0, 1, 9, 1); r.scheduler.tick(); setTimeout(publish, 150); }
      publish();
    } catch (error) { ws.send(JSON.stringify({ type: 'fixture_error', error: error.message })); }
  });
});
server.listen(Number(process.argv[2] || 27159), '127.0.0.1', function () { console.log('Scheduling fixture http://127.0.0.1:' + server.address().port + ' (isolated ' + home + ')'); });
async function stop() {
  clients.forEach(function (ws) { ws.close(); });
  wss.close(); server.close(); await r.close(); fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
