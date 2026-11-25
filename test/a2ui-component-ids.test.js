var test = require('node:test');
var assert = require('node:assert/strict');
var fixture = require('./fixtures/a2ui-server.cjs');

function exploration() {
  var doc = JSON.parse(JSON.stringify(fixture.sample));
  var surface = doc.messages[0].createSurface;
  surface.dataModel.day = ['1'];
  surface.dataModel.plans = {'pilot|1':'Pilot arrival', 'pilot|2':'Pilot rest day', 'all|1':'Wide arrival', 'all|2':'Wide travel day'};
  surface.components[0].children.push('daily-card', '1day-picker');
  surface.components.push(
    {id:'daily-card', component:'Card', child:'daily_card'},
    {id:'daily_card', component:'Column', children:['clay_component_1']},
    {id:'clay_component_1', component:'Text', text:{'@call':'lookup', args:{table:{'@path':'/plans'}, keys:[{'@path':'/choice/0'},{'@path':'/day/0'}]}}},
    {id:'1day-picker', component:'ChoicePicker', label:'Day', variant:'mutuallyExclusive', displayStyle:'chips', options:[{label:'Day one',value:'1'},{label:'Day two',value:'2'}], value:{'@path':'/day'}}
  );
  // Exercise tab references as well as children and Card.child references.
  surface.components.forEach(function (component) {
    if (component.id === 'tradeoff') component.id = 'trade-off';
    if (component.tabs) component.tabs[0].child = 'trade-off';
  });
  return doc;
}

test('Clay component aliases map to collision-free renderer IDs without changing data', async function () {
  var validate = (await import('../lib/a2ui/contract.mjs')).validateResponse;
  var original = exploration();
  var source = JSON.stringify(original);
  var doc = validate(source);
  var surface = doc.messages[0].createSurface;
  var ids = surface.components.map(function (component) {return component.id;});
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('root'));
  ids.forEach(function (id) {assert.match(id, /^[A-Za-z_][A-Za-z0-9_]*$/);});
  assert.deepEqual(surface.dataModel, original.messages[0].createSurface.dataModel);
  assert.equal(JSON.stringify(original), source);
  assert.deepEqual(validate(JSON.stringify(doc)), doc, 'normalisation is stable');
});

test('official renderer explores nested cards and tabs with hyphenated and numeric aliases', async function () {
  var running = await fixture.start(0, {auth:true});
  var browser = await require('playwright').chromium.launch({headless:true});
  try {
    var page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(running.url);
    await page.getByText('Explore locally', {exact:false}).waitFor();
    await page.evaluate(function (doc) {window.render(doc);}, exploration());
    var frame = page.frameLocator('iframe.a2ui-frame');
    await frame.getByText('Pilot arrival', {exact:true}).waitFor();
    var before = running.requests.length;
    await frame.getByText('Day two', {exact:true}).click();
    await frame.getByText('Pilot rest day', {exact:true}).waitFor();
    await frame.getByText('Everyone', {exact:true}).click();
    await frame.getByText('Wide travel day', {exact:true}).waitFor();
    await frame.getByText('Before deciding', {exact:true}).click();
    await frame.getByText('Consider reversibility,', {exact:false}).waitFor();
    assert.equal(running.requests.length, before);
    await page.evaluate(function (doc) {window.render(doc);}, exploration());
    await frame.getByText('Pilot arrival', {exact:true}).waitFor();
  } finally {await browser.close(); await new Promise(function (resolve) {running.server.close(resolve);});}
});
