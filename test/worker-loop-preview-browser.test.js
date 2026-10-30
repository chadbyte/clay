var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
[false,true].forEach(function (compiled) {
  test('Worker loop and activity previews use real events, scoped cleanup and compact motion (' + (compiled?'built':'source') + ')', { timeout:60000 },async function(t){
    var child=cp.fork(path.join(__dirname,'fixtures/pane-reuse-server.cjs'),[],{env:Object.assign({},process.env,{CLAY_WORKER_ACTIVITY_ONLY:'1'}),stdio:['ignore','pipe','pipe','ipc']});
    t.after(function(){child.kill('SIGTERM');});child.stdout.resume();child.stderr.resume();
    var info=await new Promise(function(resolve){child.once('message',resolve);});
    var browser=await chromium.launch();t.after(function(){return browser.close();});
    var page=await browser.newPage({viewport:{width:1280,height:800}}),base='http://127.0.0.1:'+info.port,errors=[];
    page.on('pageerror',function(error){errors.push(error.message);});
    if(!compiled)await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base+'/fixture/login');
    var data=await(await page.request.get(base+'/fixture/state')).json(),group=data.groups[0];
    await page.locator('.session-item[data-session-id="'+group.pair.driverId+'"]').first().click();
    var chip=page.locator('.split-view-worker-chip').first(),loop=chip.locator('.split-view-worker-loop');
    await loop.waitFor();await page.waitForTimeout(180);
    assert.equal(await loop.evaluate(function(el){return el.style.transform;}),'rotate(0deg)');
    var geometry=await chip.boundingBox(); assert.ok(geometry.height <= 22, 'chip retains its compact height');
    var identity=await loop.evaluate(function(el){window.fixtureLoopNode=el;return {width:getComputedStyle(el).width,duration:getComputedStyle(el).transitionDuration};});
    assert.equal(identity.width,'10px');assert.equal(identity.duration,'0.35s');
    async function measureGlyph() {
      return loop.evaluate(function (el) {
        var svg = el.querySelector('svg'), style = getComputedStyle(svg), matrix = svg.getScreenCTM();
        var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
        function rgb(color) { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3); }
        function luminance(color) { return rgb(color).map(function (v) { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }).reduce(function (sum, value, index) { return sum + value * [.2126, .7152, .0722][index]; }, 0); }
        var fg = luminance(style.color), bg = luminance(getComputedStyle(el).getPropertyValue('--bg-alt'));
        return { width: svg.clientWidth, paintedStroke: parseFloat(style.strokeWidth) * Math.hypot(matrix.a, matrix.b), color: style.color, contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
      });
    }
    async function useTheme(theme) {
      var toggle = page.getByRole('button', { name: 'Switch to ' + theme + ' mode', exact: true });
      if (await toggle.count()) await toggle.click();
      await page.waitForFunction(function (light) { return document.documentElement.classList.contains('light-theme') === light; }, theme === 'light');
    }
    var measurements = [];
    for (var theme of ['light', 'dark']) {
      await useTheme(theme);
      var measure = await measureGlyph();
      assert.ok(measure.width >= 10 && measure.paintedStroke >= 1.2, 'glyph has a legible optical stroke at real chip size');
      assert.ok(measure.contrast >= 3, theme + ' idle glyph contrast: ' + measure.contrast);
      measurements.push(measure);
      if (process.env.CLAY_WORKER_CAPTURES) await page.screenshot({ path: path.join(process.env.CLAY_WORKER_CAPTURES, (compiled ? 'built-' : 'source-') + theme + '-idle.png') });
    }
    assert.notEqual(measurements[0].color, measurements[1].color, 'idle foreground adapts to the theme');
    await loop.evaluate(function(el){
      window.fixtureAngles=[]; var end=performance.now()+700;
      function sample(){var transform=getComputedStyle(el).transform,angle=transform==='none'?0:Math.atan2(new DOMMatrix(transform).b,new DOMMatrix(transform).a)*180/Math.PI;window.fixtureAngles.push(angle);if(performance.now()<end)requestAnimationFrame(sample);}
      sample();
    });
    await page.request.post(base+'/fixture/worker-activity?id='+group.pair.workerId+'&count=100');
    await page.waitForFunction(function(){return document.querySelector('.split-view-worker-loop').style.transform==='rotate(30deg)';});
    assert.equal(await loop.evaluate(function(el){return window.fixtureLoopNode===el;}),true,'status snapshots preserve the animated node');
    await page.waitForTimeout(800);assert.equal(await loop.evaluate(function(el){return el.style.transform;}),'rotate(30deg)','quiet never creates another step');
    var angles=await page.evaluate(function(){return window.fixtureAngles;});
    assert.ok(angles.some(function(angle){return angle>0.1&&angle<29.9;}),'rotation has smooth intermediate positions');
    assert.ok(angles.every(function(angle,index){return index===0||angle+0.01>=angles[index-1];}),'the step travels clockwise without reversal');
    assert.equal(await loop.getAttribute('data-state'),'working');
    for (var theme of ['light', 'dark']) {
      await useTheme(theme); var working = await measureGlyph();
      assert.ok(working.contrast >= 3, theme + ' working glyph contrast: ' + working.contrast);
      assert.notEqual(working.color, measurements[theme === 'light' ? 0 : 1].color, 'running and idle remain visually distinct');
      console.log(theme + ' glyph measurements ' + JSON.stringify({ idle: measurements[theme === 'light' ? 0 : 1], working: working }));
      if (process.env.CLAY_WORKER_CAPTURES) await page.screenshot({ path: path.join(process.env.CLAY_WORKER_CAPTURES, (compiled ? 'built-' : 'source-') + theme + '-working.png') });
    }
    assert.equal((await chip.boundingBox()).width,geometry.width,'activity adds no header width');
    await chip.hover();var bubble=page.locator('#agent-message-bubble');await bubble.waitFor();
    await bubble.locator('.agent-message-bubble-activity').getByText(/Running a command · last activity \d+s ago/).waitFor();
    assert.match(await bubble.locator('.agent-message-bubble-text').innerText(),/Saved Worker|EXACT_TRANSCRIPT/);
    assert.equal(await bubble.locator('.agent-message-bubble-vendor').innerText(),'Codex');
    assert.match(await bubble.locator('.agent-message-bubble-avatar').getAttribute('src'),/codex-avatar/);
    assert.equal(await bubble.locator('time').innerText(),'Time unavailable','history without a time does not invent one');
    assert.equal(await bubble.locator('.agent-message-bubble-activity').evaluate(function(el){return !!(el.compareDocumentPosition(el.nextElementSibling)&Node.DOCUMENT_POSITION_FOLLOWING);}),true);
    assert.equal(await bubble.getAttribute('data-held'),'true');
    assert.equal(await bubble.locator('.agent-message-bubble-activity').evaluate(function(el){return el.hasAttribute('aria-live');}),false);
    await page.request.post(base+'/fixture/worker-activity?id='+group.pair.workerId);
    await page.waitForFunction(function(){return document.querySelector('.split-view-worker-loop').style.transform==='rotate(60deg)';});
    await chip.click();await page.locator('#split-view-worker-popover').waitFor();assert.equal(await bubble.count(),0,'viewer suppresses hover preview');
    await page.keyboard.press('Escape');await page.mouse.move(1270,20);
    var activityOnly=data.groups[1];
    await page.locator('.session-item[data-session-id="'+activityOnly.pair.driverId+'"]').first().click();
    await page.waitForTimeout(200);await page.request.post(base+'/fixture/worker-activity?id='+activityOnly.pair.workerId);
    var next=page.locator('.split-view-worker-chip').first();await next.focus();
    await bubble.locator('.agent-message-bubble-activity').getByText(/Running a command/).waitFor();
    assert.equal(await bubble.locator('.agent-message-bubble-text').isVisible(),false);
    assert.equal(await bubble.locator('time').innerText(),'No recent message');
    assert.equal(await next.getAttribute('aria-describedby'),'agent-message-bubble');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await next.locator('.split-view-worker-loop').evaluate(function(el){return getComputedStyle(el).transitionDuration;}),'0s');
    await page.mouse.move(1270,20);await next.blur();
    await page.setViewportSize({width:390,height:844});await next.focus();await bubble.waitFor();
    var bounds=await bubble.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390,'compact preview stays inside viewport');
    await page.keyboard.press('Escape');assert.equal(await bubble.count(),0);
    assert.deepEqual(errors,[]);
  });
});
