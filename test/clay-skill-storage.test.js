var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var storage = require('../lib/clay-skill-storage');
var discovery = require('../lib/yoke/skill-discovery');
function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'clay-private-skills-')); }
function skill(root, name, body) { var dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: Test\n---\n' + body); return dir; }

test('Clay skills and aliases leave global roots while ordinary skills remain', function () {
  var home = fixture();
  try {
    var agents = path.join(home, '.agents', 'skills');
    var claude = path.join(home, '.claude', 'skills'); fs.mkdirSync(claude, { recursive: true });
    var source = skill(agents, 'clay-future-feature', 'private workflow');
    skill(agents, 'ordinary', 'shared workflow');
    fs.symlinkSync(source, path.join(claude, 'clay-future-feature'), 'dir');
    var found = discovery.discoverSkills(null, { homeDir: home });
    var clay = found.find(function (entry) { return entry.name === 'clay-future-feature'; });
    assert.equal(clay.source, 'clay-user');
    assert.match(fs.readFileSync(clay.path, 'utf8'), /private workflow/);
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readdirSync(claude).length, 0);
    assert.ok(fs.existsSync(path.join(agents, 'ordinary', 'SKILL.md')));
    assert.equal(storage.migrate([{ path: agents, base: home }]), 0);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('private project skills retain precedence and conflicting contents are backed up', function () {
  var home = fixture(); var cwd = path.join(home, 'project');
  try {
    skill(path.join(home, '.agents', 'skills'), 'clay-demo', 'global');
    skill(path.join(cwd, '.agents', 'skills'), 'clay-demo', 'project');
    skill(storage.privateRoot(cwd), 'clay-demo', 'existing private');
    var found = discovery.discoverSkills(cwd, { homeDir: home });
    var clay = found.find(function (entry) { return entry.name === 'clay-demo'; });
    assert.equal(clay.source, 'clay-project');
    assert.match(fs.readFileSync(clay.path, 'utf8'), /existing private/);
    var backup = path.join(cwd, '.clay', 'skill-backups');
    assert.match(fs.readFileSync(path.join(backup, fs.readdirSync(backup)[0], 'SKILL.md'), 'utf8'), /project/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('migration refuses a redirected private root without removing the public source', function () {
  var home = fixture();
  try {
    var source = skill(path.join(home, '.agents', 'skills'), 'clay-demo', 'keep me');
    fs.mkdirSync(path.join(home, 'elsewhere')); fs.symlinkSync(path.join(home, 'elsewhere'), path.join(home, '.clay'), 'dir');
    assert.throws(function () { storage.migrate([{ path: path.dirname(source), base: home }]); }, /symlink/);
    assert.ok(fs.existsSync(path.join(source, 'SKILL.md')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Clay installer stages privately and publishes only to the Clay skill root', { skip: process.platform === 'win32' }, function () {
  var home = fixture();
  try {
    var bin = path.join(home, 'bin'); fs.mkdirSync(bin);
    var fake = '#!' + process.execPath + '\n' +
      'var fs=require("fs"),path=require("path"); var args=process.argv.slice(2); if(args.includes("--global"))process.exit(2);' +
      'var name=args[args.indexOf("--skill")+1];var dir=path.join(process.cwd(),".agents","skills",name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"SKILL.md"),"installed privately");';
    fs.writeFileSync(path.join(bin, 'npx'), fake, { mode: 0o755 });
    var result = require('child_process').spawnSync(process.execPath, [require.resolve('../lib/clay-skill-install'), home, 'clay-example', 'https://example.com/skill'], {
      env: Object.assign({}, process.env, { HOME: home, PATH: bin + path.delimiter + process.env.PATH }), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(storage.privateRoot(home), 'clay-example', 'SKILL.md'), 'utf8'), 'installed privately');
    assert.equal(fs.existsSync(path.join(home, '.agents')), false);
    assert.equal(fs.existsSync(path.join(home, '.claude')), false);
    assert.equal(fs.readdirSync(path.join(home, '.clay')).some(function (name) { return name.startsWith('skill-install-'); }), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
