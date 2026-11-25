var test = require('node:test');
var assert = require('node:assert/strict');
var marked = require('marked');
var fixture = require('./fixtures/a2ui-server.cjs');

test('shared assistant bubbles hide streaming JSON and settle completed or interrupted views', async function () {
  var running = await fixture.start(0, {auth:true});
  var browser = await require('playwright').chromium.launch({headless:true});
  try {
    var page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(running.url);
    await page.getByText('Explore locally', {exact:false}).waitFor();
    await page.evaluate(async function () {
      // Fixed trusted fixtures use real Marked output supplied by Node. This
      // test exercises bubble lifecycle, not the independent sanitizer policy.
      window.marked = {use:function(){},parse:function(){return window.fixtureHtml;}};
      window.DOMPurify = {sanitize:function(html){return html;}};
      window.hljs = {highlightElement:function(){}};
      window.bubbles = await import('/modules/chat-bubble-renderer.js');
      window.row = window.bubbles.createAssistantBubble({name:'Assistant'});
      document.getElementById('messages').replaceChildren(window.row);
    });
    var json = JSON.stringify(fixture.sample);
    async function render(text, done) {
      await page.evaluate(function (args) {
        window.fixtureHtml = args.html;
        if (args.done) window.bubbles.finalizeAssistantBubble(window.row,args.text,false);
        else window.bubbles.renderAssistantBubbleText(window.row,args.text,false);
      }, {html:marked.parse(text),text:text,done:done});
    }
    for (var length of [1, 30, json.length]) {
      await render('Before\n\n```clay-a2ui\n' + json.slice(0,length), false);
      assert.equal(await page.locator('.a2ui-pending').count(),1);
      assert.equal(await page.locator('pre').isVisible(),false);
      assert.equal(await page.locator('iframe').count(),0);
      assert.ok((await page.locator('#messages').innerText()).includes('Before'));
    }
    var complete = 'Before\n\n```clay-a2ui\n' + json + '\n```\n\nAfter';
    await render(complete,false);
    assert.ok((await page.locator('#messages').innerText()).includes('After'));
    assert.equal(await page.locator('iframe').count(),0);
    await render(complete,true);
    await page.frameLocator('iframe').getByText('Start with one team.',{exact:false}).waitFor();
    assert.equal(await page.locator('.a2ui-pending').count(),0);
    await page.getByText('Response source',{exact:true}).click();
    assert.equal(await page.locator('pre').isVisible(),true);
    await render('Before\n\n```clay-a2ui\n{"title":',true);
    assert.equal(await page.locator('.a2ui-pending').count(),0);
    await page.getByText('Interactive view incomplete or unavailable.',{exact:false}).waitFor();
    assert.equal(await page.locator('pre').isVisible(),false);
    await page.getByText('Response source',{exact:true}).click();
    assert.equal(await page.locator('pre').innerText(),'{"title":\n');
    await render('```json\n{"ordinary":true}\n```',false);
    assert.equal(await page.locator('pre').isVisible(),true);
    assert.equal(await page.locator('.a2ui-pending').count(),0);
    await page.evaluate(function (args) {
      window.fixtureHtml = args.html;
      window.bubbles.renderAssistantBubbleText(window.row,args.text,false,{readOnly:true});
    }, {html:marked.parse(complete),text:complete});
    assert.equal(await page.locator('pre').isVisible(),true);
    assert.equal(await page.locator('.a2ui-pending').count(),0);
  } finally {await browser.close(); await new Promise(function(resolve){running.server.close(resolve);});}
});
