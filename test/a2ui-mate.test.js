var test = require('node:test');
var assert = require('node:assert/strict');
var fixture = require('./fixtures/a2ui-server.cjs');

test('Mate bubbles render authenticated exploration in full and nested floating chat', async function () {
  var running = await fixture.start(0, {auth:true, mate:true});
  var browser = await require('playwright').chromium.launch({headless:true});
  var page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(running.url + '/p/mate-fixture/');
    await page.frameLocator('iframe.a2ui-frame').getByText('Start with one team.', {exact:false}).waitFor();
    assert.equal(await page.locator('.dm-bubble-name').textContent(), 'Test Mate');
    var before = running.requests.length;
    await page.frameLocator('iframe.a2ui-frame').getByText('Everyone', {exact:true}).click();
    await page.frameLocator('iframe.a2ui-frame').getByText('Release to everyone together.', {exact:false}).waitFor();
    assert.equal(running.requests.length, before);
    await page.getByText('Response source', {exact:true}).click();
    assert.equal(await page.locator('.copy-primed').count(), 0);
    await page.getByText('Reopen history', {exact:true}).click();
    await page.frameLocator('iframe.a2ui-frame').getByText('Start with one team.', {exact:false}).waitFor();
    await page.evaluate(function (url) { var frame=document.createElement('iframe');frame.id='floating-mate';frame.src=url;document.body.replaceChildren(frame); }, running.url + '/p/mate-fixture/?pane=1&contextual=1');
    var floating = page.frameLocator('#floating-mate');
    var exploration = floating.frameLocator('iframe.a2ui-frame');
    await exploration.getByText('Start with one team.', {exact:false}).waitFor();
    await exploration.getByText('Everyone', {exact:true}).click();
    await exploration.getByText('Release to everyone together.', {exact:false}).waitFor();
    await floating.getByText('Reopen history', {exact:true}).click();
    await exploration.getByText('Start with one team.', {exact:false}).waitFor();
    assert.equal(await floating.locator('iframe.a2ui-frame').getAttribute('sandbox'), 'allow-scripts');
  } finally { await browser.close(); await new Promise(function (resolve) {running.server.close(resolve);}); }
});

test('fresh and resumed Mate sessions receive the shared exploration guidance', function () {
  var fs = require('node:fs');
  var vm = require('node:vm');
  var source = fs.readFileSync(require.resolve('../lib/project'), 'utf8');
  var body = source.slice(source.indexOf('  function composeSessionSystemPrompt('), source.indexOf('  function composeSessionToolDefs('));
  var prompt = require('../lib/a2ui-prompt').prompt;
  var context = {
    a2uiPrompt: {prompt:prompt},
    composeSystemPrompts: function (parts) {return parts.filter(Boolean).join('\n');},
    _agentBehavior: {view:function(){return {mode:function(){return 'auto';}};},autoPrompt:function(s,k,build){return build();},notice:function(){return '';}},
    _scheduledTasks:null, _mateScheduling:null, _autonomousRun:null,
  };
  ['_sessionPair','_sessionNotes','_sessionHandoff','_driverContinuation','_sessionDocument','_sharedBrowser','_capsuleCatalog','_projectLogs','_issues','_sessionGithub','_sessionLinear','_mateKnowledge','_userKnowledge'].forEach(function (key) {
    context[key] = {getSystemPrompt:function(){return '';}};
  });
  vm.runInNewContext(body + '\nthis.compose=composeSessionSystemPrompt;', context);
  [{isMate:true},{isMate:true,sdkSessionId:'resumed-mate'},{isMate:false}].forEach(function (session) {
    assert.ok(context.compose(session).includes(prompt));
  });
  assert.equal(context.compose({youCurator:true}), '');
  var discovered = require('../lib/yoke/skill-discovery').discoverSkills('/nonexistent/mate-fixture', {homeDir:'/nonexistent-a2ui-test-home'});
  assert.ok(discovered.some(function(skill){return skill.name==='clay-a2ui' && skill.source==='clay-builtin';}));
});
