var test = require('node:test');
var assert = require('node:assert/strict');
var child = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var root = path.resolve(__dirname, '..');
var catalog = require('../lib/public/mate-avatars/catalog.json');

test('catalog selections round-trip through owner-scoped production handler and a fresh process', function (t) {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-catalog-'));
  t.after(function () { fs.rmSync(home, {recursive:true,force:true}); });
  var env = Object.assign({}, process.env, {CLAY_HOME:home,CLAY_CONFIG:path.join(home,'daemon.json'),CLAY_DEV:''});
  var script = [
    "var assert=require('node:assert/strict');var fs=require('node:fs');var path=require('node:path');var mates=require('./lib/mates');",
    "var owner={userId:'fixture-owner',multiUser:true,linuxUser:null};var foreign={userId:'fixture-other',multiUser:true,linuxUser:null};",
    "var mate=mates.createMate(owner,{vendor:'codex'}); assert.match(mate.profile.avatarCatalogId,/^B/);",
    "var handler=require('./lib/server-mates').attachMates({users:{isMultiUser:function(){return true;}},mates:Object.assign({},mates,{buildMateCtx:function(id){return id==='fixture-owner'?owner:foreign;}}),projects:new Map()});",
    "var replies=[];var ws={readyState:1,_clayUser:{id:'fixture-owner'},send:function(raw){replies.push(JSON.parse(raw));}};",
    "function update(id){handler.handleMessage(ws,{type:'mate_update',mateId:mate.id,requestId:'request-'+id,updates:{profile:Object.assign({},mate.profile,{avatarCatalogId:id})}});return replies.pop();}",
    "require('./lib/public/mate-avatars/catalog.json').forEach(function(e){var r=update(e.id);assert.equal(r.type,'mate_updated');assert.equal(r.mate.profile.avatarCatalogId,e.id);});",
    "['B00','B49','C49','A01','../../secret','/mate-avatars/B01.png',null,{},42].forEach(function(id){assert.equal(update(id).type,'mate_error');assert.equal(mates.getMate(owner,mate.id).profile.avatarCatalogId,'C48');});",
    "ws._clayUser.id='fixture-other';var denied=update('B01');assert.equal(denied.type,'mate_error');assert.equal(mates.getMate(owner,mate.id).profile.avatarCatalogId,'C48');ws._clayUser.id='fixture-owner';",
    "var locked=Object.assign({},mates.getMate(owner,mate.id).profile,{avatarLocked:true,avatarCustom:'/locked.png'});mates.updateMate(owner,mate.id,{profile:locked});var r=update('B01');assert.equal(r.mate.profile.avatarCatalogId,'C48');assert.equal(r.mate.profile.avatarCustom,'/locked.png');",
    "var legacy=mates.createMate(owner,{vendor:'codex'});var p={displayName:'Legacy',avatarStyle:'bottts',avatarSeed:'old'};mates.updateMate(owner,legacy.id,{profile:p});",
    "var custom=mates.createMate(owner,{vendor:'codex'});mates.updateMate(owner,custom.id,{profile:{avatarCustom:'/api/mate-avatar/'+custom.id+'?v=1',avatarStyle:'pixel-art'}});",
    "process.stdout.write(JSON.stringify({mateId:mate.id,legacyId:legacy.id,customId:custom.id}));"
  ].join('\n');
  var result = child.spawnSync(process.execPath,['-e',script],{cwd:root,env:env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); var ids = JSON.parse(result.stdout);
  var reload = "var m=require('./lib/mates');var c={userId:'fixture-owner',multiUser:true,linuxUser:null};process.stdout.write(JSON.stringify(m.getAllMates(c)));";
  var restarted = child.spawnSync(process.execPath,['-e',reload],{cwd:root,env:env,encoding:'utf8'});
  assert.equal(restarted.status,0,restarted.stderr);
  var records = JSON.parse(restarted.stdout);
  assert.equal(records.find(function(m){return m.id===ids.mateId;}).profile.avatarCatalogId,'C48');
  assert.match(records.find(function(m){return m.id===ids.legacyId;}).profile.avatarCatalogId,/^[BC]\d{2}$/);
  assert.equal(records.find(function(m){return m.id===ids.legacyId;}).profile.avatarStyle,'catalog');
  assert.match(records.find(function(m){return m.id===ids.customId;}).profile.avatarCustom,/^\/api\/mate-avatar\//);
});

test('Mate persistence failures return a correlated error instead of a save acknowledgement', function () {
  var replies=[];
  var handler=require('../lib/server-mates').attachMates({users:{isMultiUser:function(){return true;}},mates:{buildMateCtx:function(){return {};},updateMate:function(){throw new Error('fixture disk failure');}},projects:new Map()});
  handler.handleMessage({readyState:1,_clayUser:{id:'fixture-owner'},send:function(raw){replies.push(JSON.parse(raw));}},{type:'mate_update',mateId:'fixture-mate',requestId:'fixture-save',updates:{profile:{avatarCatalogId:'C01'}}});
  assert.equal(replies[0].type,'mate_error');assert.equal(replies[0].requestId,'fixture-save');assert.equal(replies[0].mateId,'fixture-mate');
});

test('all 96 unique shipped PNGs are 192 square and match the reproducible manifest', function () {
  var manifest = JSON.parse(fs.readFileSync(path.join(root,'output/imagegen/clay-mates/manifest.json'),'utf8'));
  assert.equal(catalog.length,96); assert.equal(catalog.filter(function(e){return e.family==='B';}).length,48);
  assert.equal(catalog.filter(function(e){return e.family==='C';}).length,48);
  var hashes = new Set(); var total = 0;
  manifest.entries.forEach(function(e){
    var bytes=fs.readFileSync(path.join(root,e.shipped));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),192);assert.equal(bytes.readUInt32BE(20),192);
    var hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');assert.equal(hash,e.sha256);hashes.add(hash);total+=bytes.length;
    assert.ok(fs.existsSync(path.join(root,e.master)));assert.ok(fs.existsSync(path.join(root,e.source)));
  });
  assert.equal(hashes.size,96);assert.equal(total,manifest.totalPngBytes);
});

test('npm ships all catalog PNGs and excludes full-resolution sources and masters', function () {
  var result=child.spawnSync('npm',['pack','--dry-run','--json'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  var files=JSON.parse(result.stdout)[0].files.map(function(f){return f.path;});
  assert.equal(files.filter(function(f){return /^lib\/public\/mate-avatars\/[BC]\d\d\.png$/.test(f);}).length,96);
  assert.ok(files.includes('lib/public/mate-avatars/catalog.json'));
  assert.ok(files.includes('lib/public/mate-avatars/lead-clay.png'));
  assert.equal(files.some(function(f){return /^output\/|generated_images|\/masters\//.test(f);}),false);
});

test('production DM target projection retains a saved catalog portrait', function () {
  var messages=[];var mate={id:'fixture-mate',name:'Ari',profile:{avatarCatalogId:'C48',avatarStyle:'bottts',avatarSeed:'legacy'}};
  var handler=require('../lib/server-dm').attachDm({users:{isMultiUser:function(){return true;}},mates:{buildMateCtx:function(){return {};},isMate:function(){return true;},getMate:function(){return mate;}},projects:new Map([['mate-fixture-mate',{}]]),dm:{loadHistory:function(){return [];}}});
  handler.handleMessage({_clayUser:{id:'fixture-owner'},send:function(raw){messages.push(JSON.parse(raw));}},{type:'dm_open',targetUserId:mate.id});
  assert.equal(messages[0].targetUser.avatarCatalogId,'C48');assert.equal(messages[0].targetUser.avatarStyle,'bottts');
});
