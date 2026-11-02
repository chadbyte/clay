var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
var catalog = require('../lib/public/workspace-background-catalog');
// The fixture isolates HOME/config and fences provider processes before importing services.
async function fixture(t, args) {
  var child = cp.fork(path.join(__dirname, 'fixtures/server-settings-server.js'), args || [], { stdio: ['ignore','pipe','pipe','ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  return 'http://127.0.0.1:' + info.port;
}
var color = { id: 'custom-rose', name: 'Quiet rose', light: '#e9cbd4', dark: '#49333d' };
[false, true].forEach(function (solo) {
  test('custom definitions, owner isolation, merged selection validation and seed (' + (solo ? 'solo' : 'account') + ')', async function (t) {
    var base = await fixture(t, solo ? ['--solo'] : []);
    var headers = {'Content-Type':'application/json','X-Clay-Settings':'1'};
    if (!solo) headers.Cookie = 'relay_auth_user=network-admin';
    async function put(values) { return fetch(base + '/api/user/appearance', { method: 'PUT', headers: headers, body: JSON.stringify(values) }); }
    async function get() { return (await fetch(base + '/api/user/appearance', { headers: headers })).json(); }
    assert.equal(catalog.colors.length, 15);
    assert.equal((await put({ customBackgroundColors: [color], backgroundColor: color.id })).status, 200);
    var saved = await get();
    assert.deepEqual(saved.customBackgroundColors, [Object.assign({}, color, { light: '#E9CBD4', dark: '#49333D' })]);
    assert.equal(saved.backgroundColor, color.id);
    assert.equal((await put({ theme: 'clay-dark', mode: 'dark' })).status, 200);
    saved = await get(); assert.equal(saved.backgroundColor, color.id); assert.equal(saved.customBackgroundColors.length, 1);
    var seed = JSON.parse((await (await fetch(base + '/p/sample/', {headers:headers})).text()).match(/window\.__clayAppearanceSeed=(.*?);<\/script>/)[1]);
    assert.equal(seed.backgroundColor, color.id); assert.deepEqual(seed.customBackgroundColors, saved.customBackgroundColors);
    if (!solo) {
      var other = await (await fetch(base + '/api/user/appearance', {headers:{Cookie:'relay_auth_user=network-member'}})).json();
      assert.deepEqual(other.customBackgroundColors, []); assert.equal(other.backgroundColor, 'sky');
      assert.equal((await fetch(base + '/api/user/appearance', {method:'PUT',headers:{'Content-Type':'application/json','X-Clay-Settings':'1',Cookie:'relay_auth_user=network-member'},body:JSON.stringify({backgroundColor:color.id})})).status, 400);
    }
    // A collection-only deletion cannot leave a dangling selection after merge.
    assert.equal((await put({customBackgroundColors:[]})).status, 400);
    for (var bad of [null, {}, [color,color], Array.from({length:13}, function (_, i) { return Object.assign({},color,{id:'custom-' + i}); }),
      [Object.assign({},color,{id:'clay'})], [Object.assign({},color,{id:'custom-../x'})], [Object.assign({},color,{name:'<img onerror=alert(1)>'})],
      [Object.assign({},color,{name:'x'.repeat(41)})], [Object.assign({},color,{name:''})]]) {
      assert.equal((await put({customBackgroundColors:bad})).status, 400);
    }
    for (var badHex of ['#fff','red','url(https://x)', '#123456; color:red', '<script>', '#GGGGGG', ' #123456', 123, null]) {
      assert.equal((await put({customBackgroundColors:[Object.assign({},color,{light:badHex})]})).status,400);
      assert.equal((await put({customBackgroundColors:[Object.assign({},color,{dark:badHex})]})).status,400);
    }
    assert.equal((await put({backgroundColor:'custom-missing'})).status,400);
    assert.equal((await put({customBackgroundColors:[],backgroundColor:'clay',background:'plain'})).status,200);
    assert.deepEqual((await get()).customBackgroundColors,[]); assert.equal((await get()).backgroundColor,'clay');
    var full = Array.from({length:12},function (_, i) { return Object.assign({},color,{id:'custom-' + i}); });
    assert.equal((await put({customBackgroundColors:full,backgroundColor:'custom-11'})).status,200);
    assert.equal((await get()).customBackgroundColors.length,12);
    assert.equal((await put({mode:'light'})).status,200);
    assert.equal((await get()).backgroundColor,'custom-11');
  });
});
async function open(page) {
  await page.locator('#user-account-trigger').click(); await page.locator('.account-settings-button').click();
  if (await page.locator('#settings-page-select').isVisible()) await page.locator('#settings-page-select').selectOption('us-appearance');
  else await page.locator('#settings-page-nav [data-section="us-appearance"]').click();
  await page.locator('#us-workspace-background').waitFor();
}
async function saved(page) { await page.locator('#us-appearance-status').filter({hasText:'Saved.'}).waitFor(); }
async function pair(page, light, dark) {
  await page.getByRole('button',{name:'Light color',exact:true}).click(); await page.locator('#us-color-hex').fill(light);
  await page.getByRole('button',{name:'Dark color',exact:true}).click(); await page.locator('#us-color-hex').fill(dark);
}
async function inStrip(page, choice) {
  await page.waitForFunction(function (id) {
    var strip = document.querySelector('.us-background-colors').getBoundingClientRect();
    var button = Array.from(document.querySelectorAll('[data-background-choice]')).find(function (node) {return node.dataset.backgroundChoice === id;}).getBoundingClientRect();
    return button.left >= strip.left - 1 && button.right <= strip.right + 1;
  },choice);
}
[false,true].forEach(function (built) {
  test('round single-row palette, anchored picker, keyboard, touch and responsive geometry (' + (built ? 'built' : 'source') + ')', {timeout:60000}, async function (t) {
    var base = await fixture(t,built ? ['--built-settings'] : []), browser = await chromium.launch(); t.after(function () {return browser.close();});
    var context = await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light',hasTouch:true});
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(); page.setDefaultTimeout(10000);
    if (!built) await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base + '/__fixture/admin'); await open(page);
    for (var width of [1280,390]) {
      await page.setViewportSize({width:width,height:width === 390 ? 844 : 800});
      for (var scheme of ['light','dark']) {
        await page.emulateMedia({colorScheme:scheme});
        await page.waitForFunction(function (scheme) {return document.documentElement.classList.contains(scheme + '-theme');},scheme);
        var geometry = await page.locator('.us-background-colors').evaluate(function (el) {
          var samples = Array.from(el.querySelectorAll('.us-background-sample')).map(function (sample) {var box=sample.getBoundingClientRect();return {y:box.y,w:box.width,h:box.height,r:getComputedStyle(sample).borderRadius};});
          return {samples:samples,height:el.getBoundingClientRect().height,scroll:el.scrollWidth > el.clientWidth,text:el.textContent};
        });
        assert.equal(geometry.samples.length,15); assert.equal(geometry.text,''); assert.equal(geometry.scroll,true);
        assert.ok(geometry.height <= 52);
        geometry.samples.forEach(function (sample) { assert.equal(sample.w,32);assert.equal(sample.h,32);assert.equal(sample.r,'50%');assert.equal(sample.y,geometry.samples[0].y); });
        assert.equal(await page.locator('.us-background-custom, .us-custom-color-actions, #us-color-name').count(),0);
        assert.equal(await page.locator('#us-workspace-background [title]').count(),0);
        var clay = page.getByRole('radio',{name:'Clay',exact:true}); await clay.focus(); await clay.press('End');
        await page.getByRole('radio',{name:'Workshop',exact:true}).press('ArrowLeft'); await inStrip(page,'paper');
        assert.equal(await page.getByRole('radio',{name:'Paper',exact:true}).getAttribute('aria-checked'),'true');
        await page.getByRole('radio',{name:'Paper',exact:true}).press('Home'); await inStrip(page,'clay'); await saved(page);
        await page.getByRole('button',{name:'Next colors',exact:true}).click();
        await page.waitForFunction(function () {return document.querySelector('.us-background-colors').scrollLeft > 0;});
        var before = await page.locator('#settings-shell-content').evaluate(function (el) {return el.scrollHeight;});
        await page.locator('#us-add-color').click();
        var box = await page.locator('#us-custom-color-editor').boundingBox(), anchor = await page.locator('#us-add-color').boundingBox();
        assert.equal(box.width,260);assert.ok(box.height < 330);assert.ok(box.x >= 8 && box.x + box.width <= width - 8);
        assert.ok(Math.min(Math.abs(box.y + box.height - anchor.y),Math.abs(box.y - anchor.y - anchor.height)) <= 8);
        assert.equal(await page.locator('#settings-shell-content').evaluate(function (el) {return el.scrollHeight;}),before,'opening the picker must not add page height');
        assert.equal(await page.locator('#us-custom-color-editor input[type="range"]').count(),1);
        assert.equal(await page.locator('#us-custom-color-editor input:not([type="range"])').count(),1);
        var priorHex = await page.locator('#us-color-hex').inputValue();
        await page.locator('#us-color-area').click({position:{x:90,y:30}});
        assert.notEqual(await page.locator('#us-color-hex').inputValue(),priorHex);
        await page.locator('#us-color-hue').fill('210');
        assert.match(await page.locator('#us-color-hex').inputValue(),/^#[A-F0-9]{6}$/);
        await page.locator('#us-color-area').press('ArrowLeft'); await page.locator('#us-color-area').press('ArrowUp');
        assert.match(await page.locator('#us-color-area').getAttribute('aria-valuetext'),/Saturation .*brightness/);
        await page.locator('#us-color-area').press('Escape');
        assert.equal(await page.locator('#us-custom-color-editor').isHidden(),true);
        assert.equal(await page.locator('#settings-shell').isVisible(),true);
        assert.equal(await page.locator('#us-add-color').evaluate(function (el) {return document.activeElement === el;}),true);
        assert.equal(await page.locator('html').getAttribute('data-workspace-color'),'clay');
        await page.locator('#us-add-color').click(); await pair(page,'#E9CBD4','#49333D');
        await page.locator('#us-color-cancel').click(); assert.equal(await page.locator('html').getAttribute('data-workspace-color'),'clay');
        await page.locator('#us-add-color').click(); await pair(page,'#E9CBD4','#49333D');
        await page.locator('#us-workspace-background h3').click();
        assert.equal(await page.locator('#us-custom-color-editor').isHidden(),true); assert.equal(await page.locator('html').getAttribute('data-workspace-color'),'clay');
        assert.equal(await page.locator('#us-workspace-background [aria-checked="true"]').count(),1);
      }
    }
    await page.getByRole('radio',{name:'Clay',exact:true}).focus(); await page.keyboard.press('Home'); await saved(page);
    var strip = await page.locator('.us-background-colors').boundingBox(), cdp = await context.newCDPSession(page);
    var x = strip.x + strip.width - 10, y = strip.y + strip.height / 2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x,y:y}]});
    for (var offset of [30,70,120]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-offset,y:y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(function () {return document.querySelector('.us-background-colors').scrollLeft > 20;});
  });
  test('compact custom color preview, validation, failed acknowledgement, queue, reload and saved strip (' + (built ? 'built' : 'source') + ')', {timeout:60000}, async function (t) {
    var base = await fixture(t,built ? ['--built-settings'] : []), browser = await chromium.launch(); t.after(function () {return browser.close();});
    var context = await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light'});
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(), errors=[]; page.setDefaultTimeout(10000);page.on('pageerror',function (error) {errors.push(error.message);});
    if (!built) await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base + '/__fixture/admin'); await open(page);
    await page.locator('#us-add-color').click(); await pair(page,'#E9CBD4','#bad'); await page.locator('#us-color-save').click();
    assert.match(await page.locator('#us-color-error').innerText(),/six-digit HEX/);assert.equal(await page.locator('#us-color-hex').getAttribute('aria-invalid'),'true');
    assert.equal((await (await page.request.get(base+'/api/user/appearance')).json()).configured,false);
    await page.locator('#us-color-hex').fill('#49333D');
    assert.equal(await page.locator('html').evaluate(function (el) {return el.style.getPropertyValue('--workspace-solid-light');}),'#E9CBD4');
    var fail = true, releases=[];
    await page.route('**/api/user/appearance',function (route) {
      if (route.request().method() !== 'PUT') return route.continue();
      if (fail) return route.fulfill({status:503,json:{error:'Fixture failure'}});
      return new Promise(function (resolve) {releases.push(function () {resolve(route.continue());});});
    });
    await page.locator('#us-color-save').click(); await page.locator('#us-color-error').filter({hasText:'Could not save'}).waitFor();
    assert.equal(await page.locator('#us-color-hex').inputValue(),'#49333D');
    assert.equal(await page.locator('#us-color-save').evaluate(function (el) {return document.activeElement === el;}),true);
    assert.deepEqual((await (await page.request.get(base+'/api/user/appearance')).json()).customBackgroundColors,[]);
    fail=false;await page.locator('#us-color-save').click(); await page.waitForTimeout(100);assert.equal(releases.length,1);
    assert.equal(await page.getByRole('radio',{name:'Clay',exact:true}).isDisabled(),true);
    assert.equal(await page.locator('#us-color-cancel').isDisabled(),true);
    releases.shift()();await saved(page);assert.equal(await page.locator('#us-custom-color-editor').isHidden(),true);
    var custom = page.getByRole('radio',{name:'#E9CBD4 / #49333D',exact:true}), id = await custom.getAttribute('data-background-choice');
    assert.equal(await custom.getAttribute('aria-checked'),'true');await inStrip(page,id);
    assert.equal(await custom.evaluate(function (el) {return document.activeElement === el;}),true);
    assert.equal(await custom.evaluate(function (el) {return el.parentElement.className;}),'us-background-colors');
    await page.getByRole('radio',{name:'Sage',exact:true}).click();await page.waitForTimeout(100);
    await page.getByRole('radio',{name:'Sky',exact:true}).click(); releases.shift()(); await page.waitForTimeout(150);
    assert.equal(await page.getByRole('radio',{name:'Sky',exact:true}).getAttribute('aria-checked'),'true');
    assert.equal(releases.length,1);releases.shift()();await saved(page);
    await custom.click();await page.waitForTimeout(100);releases.shift()();await saved(page);
    await page.unroute('**/api/user/appearance');
    await page.route('**/api/user/appearance',function (route) {return route.request().method()==='GET' ? route.fulfill({status:503,json:{error:'Hydration held'}}) : route.continue();});
    await page.reload();assert.equal(await page.locator('html').getAttribute('data-workspace-color'),id);
    assert.equal(await page.locator('html').evaluate(function (el) {return el.style.getPropertyValue('--workspace-solid-dark');}),'#49333D');
    await page.unroute('**/api/user/appearance');await open(page);
    for (var scheme of ['dark','light']) {
      await page.emulateMedia({colorScheme:scheme});await page.waitForFunction(function (scheme) {return document.documentElement.classList.contains(scheme+'-theme');},scheme);
      assert.equal(await page.locator('#layout').evaluate(function (el) {return getComputedStyle(el).backgroundColor;}),scheme==='dark'?'rgb(73, 51, 61)':'rgb(233, 203, 212)');
    }
    fail = true;
    await page.route('**/api/user/appearance',function (route) {return route.request().method()==='PUT' && fail ? route.fulfill({status:503,json:{error:'Fixture failure'}}) : route.continue();});
    await page.getByRole('radio',{name:'Sage',exact:true}).click();
    await page.locator('#us-appearance-status').filter({hasText:'Could not save'}).waitFor();
    await page.locator('#us-add-color').click();await pair(page,'#EACCD5','#38212C');
    await page.locator('#us-color-save').click();await page.locator('#us-color-error').filter({hasText:'Could not save'}).waitFor();
    await page.locator('#us-color-cancel').click();
    assert.equal(await page.locator('html').getAttribute('data-workspace-color'),'sage','cancel must preserve the earlier scalar draft');
    fail=false;await page.getByRole('button',{name:'Retry save',exact:true}).click();await saved(page);
    assert.equal((await (await page.request.get(base+'/api/user/appearance')).json()).customBackgroundColors.length,1);
    await page.unroute('**/api/user/appearance');
    // Storage remains capable of bounded collection changes, although the palette has no management rows.
    var full=Array.from({length:12},function (_,i) {return Object.assign({},color,{id:'custom-'+i,name:'Color '+i});});
    await page.request.put(base+'/api/user/appearance',{headers:{'X-Clay-Settings':'1'},data:{customBackgroundColors:full,backgroundColor:'clay'}});
    await page.reload();await open(page);await page.locator('#us-add-color').click();
    assert.match(await page.locator('#us-color-error').innerText(),/12 custom colors saved/);
    assert.equal(await page.locator('#us-color-save').isHidden(),true);assert.equal(await page.locator('#us-color-hex').isHidden(),true);
    await page.locator('#us-color-cancel').click();assert.deepEqual(errors,[]);
  });
});
[false,true].forEach(function (built) {
  test('selected color reveals on open and selection changes without resetting manual browsing (' + (built ? 'built' : 'source') + ')', {timeout:60000}, async function (t) {
    var base = await fixture(t,built ? ['--built-settings'] : []), browser = await chromium.launch();t.after(function () {return browser.close();});
    var context = await browser.newContext({viewport:{width:1280,height:800}});
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    await context.request.put(base+'/api/user/appearance',{headers:{Cookie:'relay_auth_user=network-admin','X-Clay-Settings':'1'},data:{customBackgroundColors:[color],backgroundColor:color.id}});
    var page = await context.newPage();page.setDefaultTimeout(10000);
    if (!built) await require('./fixtures/source-module-runtime.cjs').install(page);
    for (var width of [1280,390]) {
      await page.setViewportSize({width:width,height:width===390?844:800});
      await page.goto(base+'/__fixture/admin');await open(page);await inStrip(page,color.id);
      var custom = page.getByRole('radio',{name:color.name,exact:true});
      assert.equal(await custom.getAttribute('aria-checked'),'true');
      assert.equal(await custom.evaluate(function (el) {return el===document.activeElement;}),false,'initial reveal must not steal focus');
      var strip=page.locator('.us-background-colors'), previous=page.getByRole('button',{name:'Previous colors',exact:true});
      var selectedLeft=await strip.evaluate(function (el) {return el.scrollLeft;});
      await previous.click();await page.waitForFunction(function (before) {return document.querySelector('.us-background-colors').scrollLeft < before;},selectedLeft);
      var browsed=await strip.evaluate(function (el) {return el.scrollLeft;});
      await page.locator('#us-add-color').click();await pair(page,'#EACCD5','#38212C');
      assert.equal(await strip.evaluate(function (el) {return el.scrollLeft;}),browsed,'preview/store updates must preserve manual browsing');
      await page.locator('#us-color-cancel').click();
      assert.equal(await strip.evaluate(function (el) {return el.scrollLeft;}),browsed);
      await page.locator('#settings-shell-close').click();await open(page);await inStrip(page,color.id);
      // Programmatic activation has no native focus/scroll side effect of its own.
      var content=page.locator('#settings-shell-content');
      await content.evaluate(function (el) {el.scrollTop=80;});var top=await content.evaluate(function (el) {return el.scrollTop;});
      await page.getByRole('radio',{name:'Clay',exact:true}).evaluate(function (el) {el.click();});await inStrip(page,'clay');await saved(page);
      assert.equal(await content.evaluate(function (el) {return el.scrollTop;}),top,'reveal only changes horizontal strip position');
      await page.getByRole('button',{name:'Next colors',exact:true}).click();
      await page.waitForFunction(function () {return document.querySelector('.us-background-colors').scrollLeft > 0;});
      browsed=await strip.evaluate(function (el) {return el.scrollLeft;});
      var release;
      await page.route('**/api/user/appearance',function (route) {
        if (route.request().method()!=='PUT') return route.continue();
        return new Promise(function (resolve) {release=function () {resolve(route.continue());};});
      });
      if (width===390) await page.locator('#us-theme-mode').selectOption('dark');
      else {await page.locator('#us-theme-mode + .settings-picker .settings-picker-trigger').click();await page.getByRole('option',{name:'Light',exact:true}).click();}
      for (var attempt=0;attempt<50 && !release;attempt++) await page.waitForTimeout(20);
      assert.equal(typeof release,'function');assert.equal(await strip.evaluate(function (el) {return el.scrollLeft;}),browsed,'pending unrelated save must not recenter selection');
      release();await saved(page);assert.equal(await strip.evaluate(function (el) {return el.scrollLeft;}),browsed,'acknowledgement must not recenter selection');
      await page.unroute('**/api/user/appearance');
      await custom.evaluate(function (el) {el.click();});await inStrip(page,color.id);await saved(page);
      await page.reload();await open(page);await inStrip(page,color.id);
    }
  });
});
