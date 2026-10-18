'use strict';
// Static, network-free fixture for right-workbench expansion geometry.
// It serves the production index.html markup and CSS from lib/public with every
// script removed, then builds only the session title, split panes, Browser,
// Files and Terminal surfaces the layout needs. No provider, PTY, daemon,
// WebSocket, account or external host is started or contacted.
//
//   node test/fixtures/workbench-expansion-fixture.cjs [port]
//   open http://127.0.0.1:<port>/?theme=dark&panel=browser&split=1
//
// Query: theme=light|dark, panel=none|browser|files|terminal, wide=1,
//        full=1 (expanded), split=0|1|2 (number of split panes), w/h not used.
var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..', '..', 'lib', 'public');
var TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.html': 'text/html' };

var BOOT = function () {
  var q = new URLSearchParams(location.search);
  var root = document.documentElement;
  root.classList.add(q.get('theme') === 'light' ? 'light-theme' : 'dark-theme');
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  var perm = '<div class="session-permission-control %C" role="group"><div class="session-permission-segmented">' +
    '<button type="button" data-permission-mode="default"><span class="permission-label">Ask</span></button>' +
    '<button type="button" data-permission-mode="auto"><span class="permission-label">Auto</span></button>' +
    '<button type="button" class="pending" data-permission-mode="bypassPermissions"><span class="permission-label">Skip</span><span class="permission-spinner" aria-hidden="true"></span></button></div>' +
    '<span class="session-permission-status">Applying</span></div>';
  // Session title bar: real DOM, a long active title with the permission control visible.
  document.getElementById('header-title').textContent = 'Clone Orca for Competitive Analysis';
  var full = document.getElementById('header-full-access-btn'); full.classList.remove('hidden');
  full.classList.add('permission-pending');
  full.querySelector('.session-permission-status').classList.remove('hidden');
  full.querySelector('.session-permission-status').textContent = 'Applying';
  document.getElementById('connect-overlay').style.display = 'none';
  var msgs = document.getElementById('messages');
  msgs.innerHTML = '<button id="fixture-chat-button" type="button" style="position:absolute;left:12px;top:12px">Underlying chat control</button>';
  // Split panes: the production class names and header structure of createSplitPane.
  var panels = document.getElementById('main-panels'); var app = document.getElementById('app');
  var panes = Number(q.get('split') || 0);
  if (panes) {
    var host = el('<div id="split-host" class="visible"></div>');
    for (var i = 0; i < panes; i++) {
      host.appendChild(el('<section class="split-pane"><header class="split-pane-header">' +
        '<span class="split-pane-title">' + (i ? 'Split Worker' : 'Driver') + '</span>' +
        perm.replace('%C', 'split-pane-full-access') +
        '<button type="button" class="split-pane-context has-data" title="Context usage"><span class="split-pane-context-bar"><span class="split-pane-context-fill" style="width:48%"></span></span><span class="split-pane-context-label">48%</span></button>' +
        '<button type="button" class="split-pane-close" aria-label="Close pane">x</button></header>' +
        '<iframe class="split-pane-frame" title="pane" src="about:blank" style="flex:1;border:0"></iframe></section>'));
    }
    panels.insertBefore(host, app.nextSibling);
    app.classList.add('split-native-hidden');
  }
  // Browser panel: production classes and header structure (see shared-browser.js ensurePanel).
  var browser = el('<section id="shared-browser-panel" class="shared-browser-panel hidden"><header class="shared-browser-header"><span class="shared-browser-title">Browser</span><span class="shared-browser-phase">Starting...</span><div class="shared-browser-window"><button type="button">w</button><button type="button" data-action="fullscreen" aria-label="Toggle browser fullscreen">f</button><button type="button">x</button></div></header>' +
    '<form class="shared-browser-address"><input aria-label="Browser address" placeholder="Enter a URL"></form><div class="shared-browser-viewport"></div></section>');
  panels.appendChild(browser);
  // File viewer and terminal ship in index.html; give each a visible header target.
  var viewer = document.getElementById('file-viewer'); var term = document.getElementById('terminal-container');
  var panel = q.get('panel') || 'none';
  var map = { browser: browser, files: viewer, terminal: term };
  window.fixture = {
    panels: map,
    show: function (name, opts) {
      Object.keys(map).forEach(function (k) {
        map[k].classList.add('hidden'); map[k].classList.remove('panel-fullscreen');
      });
      if (!name || name === 'none') return;
      map[name].classList.remove('hidden');
      if (opts && opts.full) map[name].classList.add('panel-fullscreen');
    }
  };
  window.fixture.show(panel, { full: q.get('full') === '1' });
  if (q.get('wide') === '1' && map[panel]) map[panel].classList.add(panel === 'files' ? 'file-viewer-wide' : panel === 'browser' ? 'shared-browser-wide' : 'x');
  root.dataset.fixtureReady = '1';
};

function transform(html) {
  html = html.replace(/<script\b[\s\S]*?<\/script>/g, '');
  html = html.replace(/<link\b[^>]*https?:\/\/[^>]*>/g, '');
  html = html.replace(/(href|src)="https?:\/\/[^"]*"/g, '$1=""');
  return html.replace('</body>', '<script>(' + BOOT.toString() + ')();</script></body>');
}

function createServer() {
  return http.createServer(function (req, res) {
    var url = new URL(req.url, 'http://127.0.0.1');
    var rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
    var file = path.normalize(path.join(ROOT, rel));
    if (file.indexOf(ROOT + path.sep) !== 0 || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('not found'); }
    var body = fs.readFileSync(file);
    if (rel === '/index.html') body = transform(body.toString('utf8'));
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  });
}

function start(port) {
  return new Promise(function (resolve) {
    var server = createServer();
    server.listen(port || 0, '127.0.0.1', function () { resolve({ server: server, port: server.address().port }); });
  });
}

module.exports = { start: start };

if (require.main === module) {
  start(Number(process.argv[2]) || 0).then(function (info) {
    console.log('workbench fixture: http://127.0.0.1:' + info.port + '/?theme=dark&panel=browser&split=2&full=1');
  });
}
