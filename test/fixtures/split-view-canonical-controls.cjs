// Optional controls in the isolated real-app fixture; no automatic approvals.
var fs = require('node:fs'), path = require('node:path');
function attach(relay) {
  var mates = require('../../lib/mates'), mateCtx = mates.buildMateCtx('owner');
  mates.ensureBuiltinMates(mateCtx);
  var mate = mates.getAllMates(mateCtx).find(function (item) { return item.builtinKey === 'clay'; });
  var slug = 'mate-' + mate.id;
  relay.addProject(mates.getMateDir(mateCtx, mate.id), slug, 'Clay', null, 'owner', null, { isMate: true, mateId: mate.id, isHostAgent: true });
  var source; relay.forEachProject(function (project, id) { if (id === slug) source = project; });
  var session = source.getSessionManager().createSession({ ownerId: 'owner', vendor: 'claude', sessionVisibility: 'private' });
  session.title = 'Canonical Split view fixture'; session._sdkQueryGeneration = 8; session.abortController = new AbortController();
  source.getSessionManager().sendAndRecord(session, { type: 'user_message', text: 'Inspect and operate only the selected isolated Split view through exact human review.' });
  source.getSessionManager().saveSessionFile(session);
  async function call(name, args) { return JSON.parse((await source.getMcpBridgeHandler(session.localId, true, 8).callTool('clay-workspace', name, args)).content[0].text); }
  function handle(req, res, url) {
    if (url.pathname === '/fixture/split-view-canonical-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-canonical-browser.js'))); return true; }
    if (url.pathname === '/fixture/view-control-info') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ mate: mate, sessionId: session.localId })); return true; }
    if (url.pathname !== '/fixture/view-control' || req.method !== 'POST') return false;
    var text = '';
    req.on('data', function (chunk) { text += chunk; if (text.length > 12000) req.destroy(); });
    req.on('end', async function () {
      try {
        var input = JSON.parse(text), names = { read: 'read_owner_screen', inspect: 'inspect_owner_screen_change', apply: 'control_owner_screen' };
        if (!names[input.kind]) throw new Error('Unsupported fixture operation');
        var result = await call(names[input.kind], input.args);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'failed', error: error.message })); }
    });
    return true;
  }
  return { handle: handle };
}
module.exports = { attach: attach };
