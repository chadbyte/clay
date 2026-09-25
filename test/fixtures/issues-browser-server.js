var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var WebSocketServer = require('ws').WebSocketServer;
var attachService = require('../../lib/issues-service').attachIssuesService;
var attachProject = require('../../lib/project-issues').attachProjectIssues;
var attachLinks = require('../../lib/server-issue-links').attachIssueLinks;

var projectRoot = path.resolve(__dirname, '..', '..');
var routes = [
  { prefix: '/style.css', root: path.join(projectRoot, 'lib', 'public'), exact: true },
  { prefix: '/modules/', root: path.join(projectRoot, 'lib', 'public', 'modules') },
  { prefix: '/css/', root: path.join(projectRoot, 'lib', 'public', 'css') },
  { prefix: '/test/fixtures/', root: path.join(projectRoot, 'test', 'fixtures') },
];

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function resolveFile(url) {
  var pathname = new URL(url, 'http://127.0.0.1').pathname;
  if (pathname === '/') return path.join(__dirname, 'issues-browser.html');
  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    if (route.exact && pathname === route.prefix) return path.join(route.root, pathname.slice(1));
    if (route.exact) continue;
    if (!pathname.startsWith(route.prefix)) continue;
    var relative = pathname.slice(route.prefix.length);
    var candidate = path.resolve(route.root, relative);
    if (candidate === route.root || candidate.startsWith(route.root + path.sep)) return candidate;
  }
  return null;
}

var server = http.createServer(function (request, response) {
  var file = resolveFile(request.url);
  if (!file) { response.writeHead(404); response.end('Not found'); return; }
  fs.readFile(file, function (error, data) {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end('Unavailable'); return; }
    response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    response.end(data);
  });
});

var recordsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-issues-browser-'));
var owner = { id: 'fixture-user', displayName: 'Fixture User' };
var status = { slug: 'fixture', path: projectRoot, projectKnowledgeId: 'pk_issues_browser', projectOwnerId: owner.id };
var sessions = new Map();
var sm = { sessions: sessions, switchSession: function (id, socket) { socket._clayActiveSession = id; } };
var project = { getStatus: function () { return status; }, getSessionManager: function () { return sm; } };
var projects = new Map([['fixture', project]]);
var service = attachService({ getProjects: function () { return projects; }, isMultiUser: function () { return true; },
  analyzeGithub: async function (before, prompt) { return prompt.indexOf('queries') >= 0 ? JSON.stringify({ queries: ['sample bug', 'example problem'] }) : JSON.stringify({ decision: 'ambiguous', matches: [{ url: 'https://github.com/fixture/repository/issues/41', reason: 'Similar behavior; confirm the affected component.' }] }); },
  runGithub: process.env.ISSUES_FIXTURE_GITHUB === '1' ? async function (cwd, args, identity, input) {
    if (args[0] === 'repo') return { nameWithOwner: 'fixture/repository' };
    if (args[0] === 'api') return { html_url: 'https://github.com/fixture/repository/issues/42', title: JSON.parse(input).title, state: 'open' };
    var issue = { url: 'https://github.com/fixture/repository/issues/41', title: 'A related GitHub issue', state: 'OPEN' };
    return args[1] === 'list' ? [issue] : issue;
  } : undefined,
  findUserById: function (id) { return id === owner.id ? owner : null; }, canAccessProject: function (id) { return id === owner.id; },
  hasFullProjectAccess: function (id) { return id === owner.id; }, baseDir: recordsDir });
var seedSession = { localId: 1, ownerId: owner.id, vendor: 'codex', history: [] };
sessions.set(seedSession.localId, seedSession);
var seedDriver = service.bindProjectSession({ projectSlug: 'fixture', session: seedSession });
var seedPromise = process.env.ISSUES_FIXTURE_EMPTY === '1' ? Promise.resolve(null) : seedDriver.createIssue({ title: 'Fixture issue', summary: 'Ready to inspect', body: 'Initial **Markdown** body.', type: 'bug', priority: 'normal' });
var clients = new Set();
function sendTo(socket, message) { if (socket.readyState === 1) socket.send(JSON.stringify(message)); }
var controller = attachProject({ service: service, projectSlug: 'fixture', isMate: false, sm: sm,
  getClients: function () { return clients; }, sendTo: sendTo,
  startWork: function () { return Promise.reject(new Error('Paid Driver startup is disabled in this browser fixture.')); } });
var resolveLink = attachLinks({ projects: projects, service: service, sendMessage: sendTo });
var websocket = new WebSocketServer({ server: server, path: '/ws' });
websocket.on('connection', function (socket) {
  socket._clayUser = owner;
  clients.add(socket);
  seedPromise.then(function (entry) { if (entry) sendTo(socket, { type: 'fixture_ready', entry: entry }); });
  socket.on('message', function (raw) {
    var message;
    try { message = JSON.parse(raw.toString()); } catch (error) { return; }
    if (message.type === 'issue_reference_resolve') resolveLink(socket, message);
    else controller.handleMessage(socket, message);
  });
  socket.on('close', function () { clients.delete(socket); });
});

server.listen(0, '127.0.0.1', function () {
  process.stdout.write(String(server.address().port) + '\n');
});

function stop() {
  for (var socket of clients) socket.close();
  websocket.close();
  server.close(function () { fs.rmSync(recordsDir, { recursive: true, force: true }); process.exit(0); });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
