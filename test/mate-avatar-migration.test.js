var test=require('node:test');
var assert=require('node:assert/strict');
var fs=require('node:fs');
var os=require('node:os');
var path=require('node:path');
var child=require('node:child_process');
var migration=require('../lib/mate-avatar-migration');

test('normal registry loading persists stable migration, preserves uploads and isolates owners across restarts',function(t){
  var home=fs.mkdtempSync(path.join(os.tmpdir(),'clay-avatar-migration-'));
  t.after(function(){fs.rmSync(home,{recursive:true,force:true});});
  var profiles=['thumbs','bottts','pixel-art','adventurer','micah','fun-emoji','icons','imprint','initial'].map(function(style,n){return {id:'mate_old_'+n,profile:{displayName:'Old '+n,avatarStyle:style,avatarSeed:'seed-'+n}};});
  profiles.push({id:'mate_absent'},{id:'mate_default',profile:{}},{id:'mate_chosen',profile:{avatarCatalogId:'C48',avatarStyle:'catalog'}});
  profiles.push({id:'mate_clay',builtinKey:'clay',primary:true,profile:{avatarCustom:'/clay-studio-symbol.png',avatarLocked:true}});
  profiles.push({id:'mate_ally',builtinKey:'ally',profile:{avatarCustom:'/mates/ally.png',avatarLocked:true}});
  var custom={id:'mate_custom',profile:{avatarCustom:'/api/mate-avatar/mate_custom?v=7',avatarStyle:'bottts',avatarSeed:'keep',extra:'unchanged'}};
  var customClay={id:'mate_uploaded_clay',builtinKey:'clay',primary:true,profile:{avatarCustom:'/api/mate-avatar/mate_uploaded_clay?v=9',avatarLocked:true,avatarStyle:'imprint',avatarSeed:'keep-too'}};
  profiles.push(custom,customClay);
  var dir=path.join(home,'mates','owner-a');fs.mkdirSync(dir,{recursive:true});
  var file=path.join(dir,'mates.json');fs.writeFileSync(file,JSON.stringify({mates:profiles}));
  var otherDir=path.join(home,'mates','owner-b');fs.mkdirSync(otherDir,{recursive:true});
  var otherFile=path.join(otherDir,'mates.json');var other=JSON.stringify({mates:[{id:'mate_foreign',profile:{avatarStyle:'micah',avatarSeed:'other'}}]});fs.writeFileSync(otherFile,other);
  var env=Object.assign({},process.env,{CLAY_HOME:home,CLAY_CONFIG:path.join(home,'daemon.json'),CLAY_DEV:''});
  var script="var m=require('./lib/mates');var c={userId:'owner-a',multiUser:true,linuxUser:null};process.stdout.write(JSON.stringify(m.getAllMates(c)));";
  function read(){var result=child.spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
  var migrated=read();var bytes=fs.readFileSync(file,'utf8');var stat=fs.statSync(file).mtimeMs;
  assert.equal(JSON.parse(bytes).avatarCatalogMigrationVersion,1);
  migrated.forEach(function(m){if(m.id===custom.id||m.id===customClay.id)return;assert.equal(m.profile.avatarStyle,'catalog');assert.equal(m.profile.avatarSeed,undefined);assert.match(m.profile.avatarCatalogId,/^(?:[BC]\d{2}|lead-clay)$/);});
  assert.equal(migrated.find(function(m){return m.id==='mate_clay';}).profile.avatarCatalogId,'lead-clay');
  assert.equal(migrated.find(function(m){return m.id==='mate_clay';}).profile.avatarCustom,'');
  assert.equal(migrated.find(function(m){return m.id==='mate_chosen';}).profile.avatarCatalogId,'C48');
  assert.deepEqual(migrated.find(function(m){return m.id===custom.id;}),custom);
  assert.deepEqual(migrated.find(function(m){return m.id===customClay.id;}),customClay);
  profiles.slice(0,11).forEach(function(m){assert.equal(migrated.find(function(e){return e.id===m.id;}).profile.avatarCatalogId,migration.mappedId(m));});
  assert.deepEqual(read(),migrated);assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(fs.statSync(file).mtimeMs,stat);
  assert.equal(fs.readFileSync(otherFile,'utf8'),other);
  var create="var m=require('./lib/mates');var c={userId:'owner-a',multiUser:true,linuxUser:null};var a=m.createMate(c,{vendor:'codex'});var b=m.createBuiltinMate(c,'clay');process.stdout.write(JSON.stringify([a,b]));";
  var result=child.spawnSync(process.execPath,['-e',create],{cwd:path.resolve(__dirname,'..'),env:env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  var fresh=JSON.parse(result.stdout);assert.match(fresh[0].profile.avatarCatalogId,/^B\d{2}$/);assert.equal(fresh[0].profile.avatarStyle,'catalog');assert.equal(fresh[1].profile.avatarCatalogId,'lead-clay');
  assert.equal(fs.readFileSync(otherFile,'utf8'),other);
});

test('lead identity cannot be selected for an ordinary Mate and custom profiles remain byte-equivalent',function(){
  var catalog=require('../lib/mate-avatar-catalog');assert.ok(catalog.validate({avatarCatalogId:'lead-clay'},{id:'ordinary'}));assert.equal(catalog.validate({avatarCatalogId:'lead-clay'},{builtinKey:'clay'}),null);
  var data={mates:[{id:'uploaded',profile:{avatarCustom:'https://example.test/avatar.png',avatarStyle:'micah',avatarSeed:'old'}}]};
  var profile=JSON.stringify(data.mates[0].profile);assert.equal(migration.migrate(data),true);assert.equal(JSON.stringify(data.mates[0].profile),profile);assert.equal(migration.migrate(data),false);
});

test('migration write failure propagates and leaves the old registry intact',function(t){
  var home=fs.mkdtempSync(path.join(os.tmpdir(),'clay-avatar-migration-failure-'));t.after(function(){fs.rmSync(home,{recursive:true,force:true});});
  var dir=path.join(home,'mates');fs.mkdirSync(dir,{recursive:true});var file=path.join(dir,'mates.json');var original=JSON.stringify({mates:[{id:'mate_old',profile:{avatarStyle:'bottts',avatarSeed:'old'}}]});fs.writeFileSync(file,original);
  var script="var fs=require('node:fs');var m=require('./lib/mates');fs.renameSync=function(){throw new Error('fixture migration write failure');};try{m.getAllMates({multiUser:false});process.exit(2);}catch(e){if(!/fixture migration write failure/.test(e.message))throw e;}";
  var result=child.spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:Object.assign({},process.env,{CLAY_HOME:home,CLAY_CONFIG:path.join(home,'daemon.json'),CLAY_DEV:''}),encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('lead portrait ships separately and old Mate chooser code is absent',function(){
  var root=path.resolve(__dirname,'..');var bytes=fs.readFileSync(path.join(root,'lib/public/mate-avatars/lead-clay.png'));assert.equal(bytes.readUInt32BE(16),192);assert.equal(bytes.readUInt32BE(20),192);
  var catalog=require('../lib/public/mate-avatars/catalog.json');assert.equal(catalog.length,96);assert.equal(catalog.some(function(e){return e.id==='lead-clay';}),false);
  var profile=fs.readFileSync(path.join(root,'lib/public/modules/profile.js'),'utf8');assert.doesNotMatch(profile,/showMateProfilePopover|Mate initial|Use initial/);
  var editor=fs.readFileSync(path.join(root,'lib/public/modules/home-mate-avatar-editor.js'),'utf8');assert.doesNotMatch(editor,/Shuffle|MATE_AVATAR_STYLES/);
});

test('startup primary sync preserves a canonical Clay custom upload',function(t){
  var home=fs.mkdtempSync(path.join(os.tmpdir(),'clay-avatar-clay-custom-'));t.after(function(){fs.rmSync(home,{recursive:true,force:true});});
  var dir=path.join(home,'mates');fs.mkdirSync(dir,{recursive:true});
  var profile={displayName:'Clay',avatarCustom:'/api/mate-avatar/mate_clay?v=9',avatarStyle:'bottts',avatarSeed:'keep',avatarColor:'#5857fc',avatarLocked:true};
  fs.writeFileSync(path.join(dir,'mates.json'),JSON.stringify({mates:[{id:'mate_clay',builtinKey:'clay',primary:true,templateVersion:1,profile:profile}]}));
  var script="var m=require('./lib/mates');var c={multiUser:false};m.syncPrimaryMates(c);process.stdout.write(JSON.stringify(m.getMate(c,'mate_clay').profile));";
  var result=child.spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:Object.assign({},process.env,{CLAY_HOME:home,CLAY_CONFIG:path.join(home,'daemon.json'),CLAY_DEV:''}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),profile);
});
