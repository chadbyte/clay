var test = require('node:test');
var assert = require('node:assert/strict');
var fixture = require('./fixtures/a2ui-server.cjs');
function copy() { return JSON.parse(JSON.stringify(fixture.sample)); }
test('A2UI rejects unsafe, cyclic, unknown and oversized response data before resolving', async function () {
  var validate = (await import('../lib/a2ui/contract.mjs')).validateResponse;
  assert.equal(validate(JSON.stringify(copy())).title, fixture.sample.title);
  var cases = [
    function (d) { d.messages[0].version = '0.9'; },
    function (d) { d.messages[0].createSurface.catalogId = 'https://untrusted.invalid'; },
    function (d) { d.messages[0].createSurface.components[0].children.push('root'); },
    function (d) { d.messages[0].createSurface.components[0].children.push('missing'); },
    function (d) { d.messages[0].createSurface.components[1].component = 'Image'; },
    function (d) { d.messages[0].createSurface.components[2].text = {'@call':'fetch',args:{}}; },
    function (d) { d.messages[0].createSurface.components[2].text = {'@path':'/__proto__/x'}; },
    function (d) { d.messages[0].createSurface.components[2].text = 'x'.repeat(16001); },
    function (d) { d.messages[0].createSurface.components[0].children = {path:'/data', componentId:'root'}; },
    function (d) { d.messages.push(d.messages[0]); },
  ];
  cases.forEach(function (mutate) { var d=copy();mutate(d);assert.throws(function(){validate(JSON.stringify(d));}); });
  assert.throws(function(){validate('{"__proto__":{}}');});
  assert.throws(function(){validate(' '.repeat(100001));});
});
test('official A2UI renderer explores locally, restores history and fails closed', async function () {
  var playwright = require('playwright');
  var running = await fixture.start(0, {auth:true});
  var browser = await playwright.chromium.launch({headless:true});
  var page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(running.url);
    await page.getByText('Explore locally', {exact:false}).waitFor();
    var frame = page.frameLocator('iframe');
    await frame.getByText('Start with one team.', {exact:false}).waitFor();
    var before = running.requests.length;
    await frame.getByText('Everyone', {exact:true}).click();
    await frame.getByText('Release to everyone together.', {exact:false}).waitFor();
    await frame.getByText('Faster reach,', {exact:false}).waitFor();
    await frame.getByText('Before deciding', {exact:true}).click();
    await frame.getByText('Consider reversibility,', {exact:false}).waitFor();
    assert.equal(running.requests.length, before, 'selection must not send any network request');
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    var child = page.frames()[1];
    assert.equal(await child.evaluate(function () { try { return !!parent.document; } catch(e) {return false;} }), false);
    assert.equal(await child.evaluate(async function () { try {await fetch('/leak');return true;}catch(e){return false;} }), false);
    assert.equal(await child.evaluate(function () { var script=document.createElement('script');script.textContent='window.untrustedRan=true';document.body.appendChild(script);return window.untrustedRan===true; }), false);
    await page.getByText('Change theme', {exact:true}).click();
    await page.waitForFunction(function(){return !document.documentElement.classList.contains('light-theme');});
    await frame.locator('html.a2ui-dark').waitFor();
    await frame.getByText('Release to everyone together.', {exact:false}).waitFor();
    await page.getByText('Explore budget', {exact:true}).click();
    await frame.getByText('Estimated total: $550.00', {exact:true}).waitFor();
    await frame.getByText('Include materials', {exact:true}).click();
    await frame.getByText('Estimated total: $670.00', {exact:true}).waitFor();
    await frame.locator('input[type=range]').focus();
    await page.keyboard.press('ArrowRight');
    await frame.getByText('Estimated total: $695.00', {exact:true}).waitFor();
    await frame.getByText('Your draft', {exact:true}).click();
    await frame.locator('input[type=text]').fill('<img src=/leak onerror=alert(1)>');
    assert.equal(await frame.locator('img').count(),0);
    await page.getByText('Reopen history', {exact:true}).click();
    await frame.getByText('Start with one team.', {exact:false}).waitFor();
    await page.setViewportSize({width:360,height:800});
    assert.ok(await page.evaluate(function(){return document.documentElement.scrollWidth<=window.innerWidth;}));
    await page.evaluate(function(){window.replayTest();});
    await page.getByText('Explore locally', {exact:false}).waitFor();
    await page.evaluate(function(){window.render(window.sample,'msg-user');});
    assert.equal(await page.locator('iframe').count(),0);
    await page.evaluate(function(){var d=structuredClone(window.sample);d.messages[0].createSurface.components[2].text={'@call':'unknown',args:{}};window.render(d);});
    await page.getByText('Interactive view unavailable.', {exact:false}).waitFor();
    assert.equal(await page.locator('iframe').count(),0);
    await page.evaluate(function(){var d=structuredClone(window.sample);d.messages[0].createSurface.components[2].variant='h4';window.render(d);});
    await page.getByText('Interactive view unavailable.', {exact:false}).waitFor();
    assert.ok(await page.getByText('A pilot limits initial exposure',{exact:false}).count());
  } finally { await browser.close(); await new Promise(function(resolve){running.server.close(resolve);}); }
});
test('response JSON retains punctuation through the production Markdown normalizer', function () {
  var fs = require('fs');
  var vm = require('vm');
  var source = fs.readFileSync(require.resolve('../lib/public/modules/markdown.js'),'utf8');
  var start = source.indexOf('function normalizeAdjacentEmphasis');
  var end = source.indexOf('export function enhanceClaySessionLinks',start);
  var context = {marked:{parse:function(text){return text;}},DOMPurify:{sanitize:function(text){return text;}}};
  vm.runInNewContext(source.slice(start,end).replace('export function renderMarkdown','function renderMarkdown')+';this.render=renderMarkdown;',context);
  var json = JSON.stringify({title:'“Compare”',summary:'Don’t change these “quotes”',messages:[]});
  assert.equal(context.render('```clay-a2ui\n'+json+'\n```'),'```clay-a2ui\n'+json+'\n```');
});
test('exploration guidance is available through the shared prompt and bundled skill discovery', function () {
  var fs = require('fs');
  var source = fs.readFileSync(require.resolve('../lib/project'),'utf8');
  assert.match(source,/var a2uiPrompt = require\("\.\/a2ui-prompt"\)/);
  assert.match(source,/a2uiPrompt\.prompt/);
  var skill = require('../lib/yoke/skill-discovery').discoverSkills(process.cwd(), {homeDir:'/nonexistent-a2ui-test-home'}).find(function(s){return s.name==='clay-a2ui';});
  assert.ok(skill);
  assert.equal(skill.source,'clay-builtin');
});

test('authenticated renderer asset denial preserves fallback without starting a frame', async function () {
  var running = await fixture.start(0, {auth:true, denyAssets:true});
  var browser = await require('playwright').chromium.launch({headless:true});
  try {
    var page = await browser.newPage();
    await page.goto(running.url);
    await page.getByText('Interactive view unavailable.', {exact:false}).waitFor();
    assert.equal(await page.locator('iframe').count(), 0);
    await page.getByText('Response source', {exact:true}).click();
    assert.ok(await page.locator('pre').isVisible());
  } finally { await browser.close(); await new Promise(function (resolve) { running.server.close(resolve); }); }
});
