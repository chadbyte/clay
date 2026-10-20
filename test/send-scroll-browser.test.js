// Real composer send -> sent user turn geometry, in isolated browser fixtures.
// Transport is the fixture's in-process synthetic turn (no provider, process or
// network); storage, provider and Git fences are set by pane-reuse-server.cjs.
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
var LONG = 'Immediate streamed answer paragraph. '.repeat(160);

async function start(t, env) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '', CLAY_FIXTURE_SYNTHETIC_TURN: '1' }, env), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  var origin = 'http://127.0.0.1:' + info.port;
  await page.goto(origin + '/fixture/login');
  var data = await (await page.request.get(origin + '/fixture/state')).json();
  return { page: page, origin: origin, data: data, errors: errors };
}

async function paneFor(f, id) {
  await f.page.waitForFunction(function (id) {
    var frame = document.querySelector('#split-host .split-pane-frame[data-session-id="' + id + '"]');
    var live = frame && frame.clayPane && frame.clayPane.identity();
    return live && live.ready && live.sessionId === id && frame.contentDocument.getElementById('messages').dataset.controlSessionId === String(id) &&
      frame.contentDocument.getElementById('messages').scrollHeight > 1000;
  }, id, { timeout: 30000 });
  return await (await f.page.locator('#split-host .split-pane-frame[data-session-id="' + id + '"]').elementHandle()).contentFrame();
}

function geometry(frame) {
  return frame.evaluate(function () {
    var m = document.getElementById('messages'), composer = document.getElementById('input-area'), users = m.querySelectorAll('.msg-user'), u = users[users.length - 1];
    var mr = m.getBoundingClientRect(), ur = u.getBoundingClientRect();
    return { scrollTop: m.scrollTop, gap: m.scrollHeight - m.scrollTop - m.clientHeight, text: u.textContent, offsetTop: ur.top - mr.top, userBottom: ur.bottom,
      viewTop: mr.top, viewBottom: mr.bottom, composerTop: composer.getBoundingClientRect().top, inputHeight: document.getElementById('input').offsetHeight };
  });
}
function visible(g, label) {
  assert.ok(g.text.indexOf('SENT-TURN') >= 0, label + ': measured the sent turn');
  assert.ok(g.userBottom <= Math.min(g.viewBottom, g.composerTop) + 1, label + ': sent turn is not clipped by the composer ' + JSON.stringify(g));
  assert.ok(g.offsetTop >= -1, label + ': sent turn top is not scrolled out above the transcript ' + JSON.stringify(g));
}

async function send(frame, text) {
  var count = await frame.locator('#messages .msg-user').count();
  await frame.locator('#input').fill(text || 'SENT-TURN line1\nline2\nline3\nline4\nline5');
  if (!text) assert.ok((await frame.locator('#input').evaluate(function (el) { return el.offsetHeight; })) > 60, 'multiline composer expanded');
  await frame.locator('#input').press('Enter');
  await frame.waitForFunction(function (count) { var u = document.querySelectorAll('#messages .msg-user'); return u.length > count && u[u.length - 1].textContent.indexOf('SENT-TURN') >= 0; }, count);
  await frame.waitForFunction(function () { return document.getElementById('input').offsetHeight < 60; });
}
async function output(f, text) { await f.page.request.post(f.origin + '/fixture/synthetic?kind=text&text=' + encodeURIComponent(text)); }

async function exercise(f, frame, label) {
  await send(frame);
  await f.page.waitForTimeout(300);
  visible(await geometry(frame), label + ' at send');
  // Host layout receipt arrives after the send and its end receipt never does.
  await f.page.evaluate(function (id) {
    var el = document.querySelector('#split-host .split-pane-frame[data-session-id="' + id + '"]');
    el.contentWindow.postMessage({ type: 'clay-pane-layout-resize', phase: 'begin', token: 'stuck-layout', scrollTop: 100, paneBinding: el.clayPane.identity().binding }, location.origin);
  }, f.paneId);
  await f.page.waitForTimeout(200);
  visible(await geometry(frame), label + ' after layout receipt');
  await output(f, LONG);
  await f.page.waitForTimeout(1500);
  var g = await geometry(frame);
  visible(g, label + ' after immediate large output');
  assert.ok(g.offsetTop <= 24, label + ': long reply starts below the sent turn aligned near the top ' + JSON.stringify(g));
  assert.ok(g.gap > 100, label + ': reply continues below the aligned turn');
  // Completion inside the follow window must not jump past the sent turn.
  await f.page.request.post(f.origin + '/fixture/synthetic?kind=result');
  await f.page.waitForTimeout(1500);
  g = await geometry(frame);
  visible(g, label + ' after completion');
  assert.ok(g.offsetTop <= 24 && g.gap > 100, label + ': completion keeps the aligned sent turn ' + JSON.stringify(g));
  // Completion arriving in the same instant as a long reply (inside the follow window).
  await send(frame, 'SENT-TURN immediate');
  await output(f, LONG);
  await f.page.request.post(f.origin + '/fixture/synthetic?kind=result');
  await f.page.waitForTimeout(1500);
  g = await geometry(frame);
  assert.ok(g.text.indexOf('SENT-TURN immediate') >= 0);
  visible(g, label + ' immediate completion');
  assert.ok(g.offsetTop <= 24 && g.gap > 100, label + ': immediate completion keeps the aligned sent turn ' + JSON.stringify(g));
  // A second turn with short latency: output and completion arrive at once.
  await send(frame, 'SENT-TURN second');
  await output(f, 'Short answer.');
  await f.page.request.post(f.origin + '/fixture/synthetic?kind=result');
  await f.page.waitForTimeout(1200);
  g = await geometry(frame);
  assert.ok(g.text.indexOf('SENT-TURN second') >= 0);
  visible(g, label + ' short turn after completion');
  // A third turn: manual reading survives further streaming and completion.
  await send(frame, 'SENT-TURN third');
  await output(f, LONG);
  await f.page.waitForTimeout(800);
  // Reading earlier content stays under user control during further streaming.
  var reading = await frame.evaluate(async function () {
    var m = document.getElementById('messages'); m.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }));
    m.scrollTop = Math.floor(m.scrollTop / 2); await new Promise(function (r) { setTimeout(r, 100); }); return m.scrollTop;
  });
  await output(f, 'More activity while reading. '.repeat(40));
  await f.page.waitForTimeout(800);
  assert.equal(await frame.locator('#messages').evaluate(function (m) { return Math.floor(m.scrollTop); }), Math.floor(reading), label + ': manual reading position preserved');
  await f.page.request.post(f.origin + '/fixture/synthetic?kind=result');
  await f.page.waitForTimeout(1200);
  assert.equal(await frame.locator('#messages').evaluate(function (m) { return Math.floor(m.scrollTop); }), Math.floor(reading), label + ': completion does not move a manual reading position');
}

test('sent turn stays visible above the composer in the ordinary single-session pane, and session switches are isolated', { timeout: 120000 }, async function (t) {
  var f = await start(t, {});
  var id = f.data.standaloneId, other = f.data.otherIds[0]; f.paneId = id;
  await f.page.request.post(f.origin + '/fixture/switch?id=' + id);
  var frame = await paneFor(f, id);
  await exercise(f, frame, 'single-session pane');
  await f.page.request.post(f.origin + '/fixture/switch?id=' + other);
  var next = await paneFor(f, other);
  await f.page.waitForTimeout(800);
  var state = await next.evaluate(function () { var m = document.getElementById('messages'); return { gap: m.scrollHeight - m.scrollTop - m.clientHeight, text: m.textContent.indexOf('SENT-TURN') >= 0 }; });
  assert.equal(state.text, false, 'other session has no sent turn from the first');
  assert.ok(state.gap < 5, 'switched session lands at its own bottom, not at the previous turn anchor: ' + JSON.stringify(state));
  assert.deepEqual(f.errors, []);
});

test('sent turn stays visible in a saved-view Driver pane', { timeout: 120000 }, async function (t) {
  var f = await start(t, { CLAY_PANE_PRESENTATION: '1' });
  var view = f.data.restoreView; f.paneId = view.pair.driverId;
  await f.page.locator('[data-split-view-id="' + view.id + '"] .split-view-group-open').first().click();
  var frame = await paneFor(f, view.pair.driverId);
  await exercise(f, frame, 'saved-view pane');
  assert.deepEqual(f.errors, []);
});
