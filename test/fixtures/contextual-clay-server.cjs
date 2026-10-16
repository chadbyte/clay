// Start the real authenticated app with the isolated integration fixture's providers.
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var previewPort = Number(process.argv[2] || 0);
if (!Number.isInteger(previewPort) || previewPort < 0 || previewPort > 65535) throw new Error('Supply a valid optional preview port.');
process.env.CLAY_CONTEXTUAL_FIXTURE_PORT = String(previewPort);
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-contextual-ui-'));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CLAY_CONFIG = path.join(root, '.clay/daemon.json');
process.env.CODEX_HOME = path.join(root, '.codex');
process.env.SUDO_USER = '';
process.env.SUDO_HOME = '';
process.env.CLAY_DEV = '';
process.env.CLAY_CONTEXTUAL_FIXTURE = '1';
process.argv[2] = root;
process.on('exit', function () { fs.rmSync(root, { recursive: true, force: true }); });
require('./clay-final-integration.cjs');
