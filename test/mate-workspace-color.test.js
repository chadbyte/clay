var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var vm = require('node:vm');
var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/mate-workspace-color.js'), 'utf8');
var api = {};
vm.runInNewContext(source.replace(/export /g, ''), api);
function rgb(hex) { return [1,3,5].map(function (i) { return parseInt(hex.slice(i,i+2),16); }); }
function luminance(channels) {
  return channels.map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (sum, v, i) { return sum + v * [0.2126,0.7152,0.0722][i]; },0);
}
function contrast(a,b) { var x = luminance(a), y = luminance(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }

test('every permitted workspace tint preserves normal text contrast in both themes', function () {
  assert.deepEqual(Array.from(api.MATE_WORKSPACE_COLORS, function (c) { return c.id; }), require('../lib/mate-workspace-color').colors);
  api.MATE_WORKSPACE_COLORS.forEach(function (preset) {
    var color = api.workspaceColor({workspaceColor:preset.id});
    ['light','dark'].forEach(function (theme) {
      var bg = rgb(color[theme]);
      var ink = rgb(theme === 'light' ? '#252522' : '#e8e8e2');
      // The workspace's faintest text is mixed at 68% ink against its surround.
      var faint = ink.map(function (v,i) { return v * 0.68 + bg[i] * 0.32; });
      assert.ok(contrast(faint,bg) >= 4.5, preset.id + ' ' + theme + ' faint text');
      assert.ok(contrast(rgb(theme === 'light' ? '#44443f' : '#d1d1ca'),bg) >= 4.5, preset.id + ' ' + theme + ' captions');
    });
    assert.ok(contrast(rgb('#171717'),rgb(preset.pigment)) >= 4.5, preset.id + ' selection check');
  });
});

test('Clay stays mint and invalid or missing presets fall back safely', function () {
  var mint = api.workspaceColor({workspaceColor:'mint'});
  [{builtinKey:'clay',workspaceColor:'coral'}, {primary:true,workspaceColor:'indigo'}, {workspaceColor:'url(evil)'}, null].forEach(function (mate) {
    assert.deepEqual(api.workspaceColor(mate),mint);
  });
});

test('workspace colors persist per owner, reject arbitrary values and cannot change Clay', function (t) {
  var home = fs.mkdtempSync(path.join(os.tmpdir(),'mate-colors-'));
  t.after(function () { fs.rmSync(home,{recursive:true,force:true}); });
  var script = [
    "var assert = require('node:assert/strict'); var mates = require('./lib/mates');",
    "var alice = {userId:'alice',multiUser:true}; var bob = {userId:'bob',multiUser:true};",
    "var mate = mates.createMate(alice,{vendor:'codex'});",
    "assert.equal(mates.updateMate(alice,mate.id,{workspaceColor:'rose'}).workspaceColor,'rose');",
    "assert.equal(mates.getMate(alice,mate.id).workspaceColor,'rose');",
    "assert.equal(mates.updateMate(bob,mate.id,{workspaceColor:'sky'}),null);",
    "assert.ok(mates.updateMate(alice,mate.id,{workspaceColor:'#ffffff',name:'Wrong'}).error);",
    "assert.equal(mates.getMate(alice,mate.id).workspaceColor,'rose');",
    "assert.notEqual(mates.getMate(alice,mate.id).name,'Wrong');",
    "var clay = mates.createBuiltinMate(alice,'clay');",
    "assert.equal(mates.updateMate(alice,clay.id,{workspaceColor:'rose'}).workspaceColor,undefined);"
  ].join('\n');
  var result = require('node:child_process').spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:Object.assign({},process.env,{CLAY_HOME:home,CLAY_CONFIG:path.join(home,'daemon.json'),CLAY_DEV:''}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr || result.stdout);
});

test('color save acknowledgements correlate by request and Mate; failures never report success', function () {
  var picker = fs.readFileSync(path.join(__dirname,'../lib/public/modules/home-mate-color-picker.js'),'utf8');
  var data = {mateColorSave:{mateId:'arch',requestId:'request-1',color:'rose'}};
  var context = {
    store:{get:function (key) {return data[key];},set:function (patch) {Object.assign(data,patch);}},
    clearTimeout:function () {}
  };
  vm.runInNewContext(picker.replace(/^import .*$/gm,'').replace(/export /g,''),context);
  assert.equal(context.mateColorSaving(),true);
  assert.equal(context.applyMateColorResult({requestId:'stale',mate:{id:'arch'}}),false);
  assert.equal(context.applyMateColorResult({requestId:'request-1',mate:{id:'other'}}),false);
  assert.equal(context.applyMateColorResult({requestId:'request-1',mateId:'arch',error:'Denied'}),true);
  assert.equal(data.mateColorSave.saved,false);
  assert.equal(data.mateColorSave.error,'Denied');
  assert.equal(context.mateColorSaving(),false);
  data.mateColorSave = {mateId:'arch',requestId:'request-2',color:'rose'};
  assert.equal(context.applyMateColorResult({requestId:'request-1',mate:{id:'arch'}}),false);
  assert.equal(context.applyMateColorResult({requestId:'request-2',mate:{id:'arch',workspaceColor:'rose'}}),true);
  assert.equal(data.mateColorSave.saved,true);
  context.resetMateColor();
  assert.equal(data.mateColorSave,null);
});

test('workspace navigation replaces both theme colors and resets to mint for Clay', function () {
  var values = {};
  api.document = {body:{style:{setProperty:function (key,value) {values[key]=value;}}}};
  api.applyWorkspaceColor({workspaceColor:'rose'});
  assert.equal(values['--mate-surround-dark'],api.workspaceColor({workspaceColor:'rose'}).dark);
  api.applyWorkspaceColor({builtinKey:'clay',workspaceColor:'rose'});
  assert.equal(values['--mate-surround-light'],api.workspaceColor(null).light);
  assert.equal(values['--mate-surround-dark'],api.workspaceColor(null).dark);
});

test('Clay omits the entire workspace color section', function () {
  var picker = fs.readFileSync(path.join(__dirname,'../lib/public/modules/home-mate-color-picker.js'),'utf8');
  var context = {clearTimeout:function () {}};
  vm.runInNewContext(picker.replace(/^import .*$/gm,'').replace(/export /g,''),context);
  // No DOM or store should be touched for a fixed-color identity.
  context.renderMateColorPicker(null,{builtinKey:'clay'},null);
  context.renderMateColorPicker(null,{primary:true},null);
});
