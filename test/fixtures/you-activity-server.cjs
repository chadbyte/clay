// Persist fixture memories through the real owner-bound curation service and WS.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-you-activity-'));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CLAY_CONFIG = path.join(root, '.clay/daemon.json');
process.env.CODEX_HOME = path.join(root, '.codex');
process.env.SUDO_USER = ''; process.env.SUDO_HOME = ''; process.env.CLAY_DEV = '';
process.env.CLAY_CONTEXTUAL_FIXTURE = '1';
process.env.CLAY_CONTEXTUAL_FIXTURE_PORT = '0';
process.argv[2] = root;
require('../helpers/yoke-no-provider-processes.cjs');
process.on('exit', function () { fs.rmSync(root, { recursive: true, force: true }); });
var runtime, relay, sequence = 0;
var knowledge = require('../../lib/server-user-knowledge'), attach = knowledge.attachServerUserKnowledge;
knowledge.attachServerUserKnowledge = function (options) { runtime = attach(options); return runtime; };
var server = require('../../lib/server'), create = server.createServer;
server.createServer = function (options) {
  relay = create(options);
  var original = relay.server.listeners('request');
  relay.server.removeAllListeners('request');
  relay.server.on('request', function (req, res) {
    var url = new URL(req.url, 'http://fixture');
    if (url.pathname !== '/__memory-fixture/save') { original.forEach(function (handler) { handler(req, res); }); return; }
    if (req.method !== 'POST' || !String(req.headers.cookie || '').split(';').some(function (cookie) { return cookie.trim() === 'relay_auth_user=fixture-owner-token'; })) {
      res.writeHead(403); res.end(); return;
    }
    try {
      var tools;
      relay.forEachProject(function (project, slug) {
        if (tools) return;
        project.getSessionManager().sessions.forEach(function (session) {
          if (tools || session.ownerId !== 'owner') return;
          var candidate = runtime.service.bind({ projectSlug: slug, session: session });
          if (candidate.isClay()) tools = candidate;
        });
      });
      if (!tools) throw new Error('Canonical fixture Clay is not ready.');
      var count = Math.max(1, Math.min(30, Number(url.searchParams.get('count')) || 1));
      for (var i = 0; i < count; i++) {
        var text = url.searchParams.get('text') || 'Prefers concise review summaries.';
        var observation = tools.report({ observation: text, evidence: 'Disposable fixture preference ' + (++sequence), evidenceType: 'explicit' });
        tools.curate({ reportRef: observation.ref, action: 'save', title: 'Fixture preference ' + sequence,
          category: 'workflow', summary: text, body: text, reason: 'Explicit disposable fixture evidence.' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runtime.service.activity('owner', { limit: 30 })));
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  return relay;
};
require('./clay-final-integration.cjs');
