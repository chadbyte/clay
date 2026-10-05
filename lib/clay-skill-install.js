// Runs under the requesting OS identity. The installer only sees a private staging project.
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var storage = require('./clay-skill-storage');
var base = process.argv[2];
var name = process.argv[3];
var url = process.argv[4];
if (!storage.isClaySkill(name) || !/^https:\/\//i.test(url)) throw new Error('Invalid Clay skill install request');
storage.directory(path.join(base, '.clay'));
var stage = fs.mkdtempSync(path.join(base, '.clay', 'skill-install-'));
var child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['skills', 'add', url, '--skill', name, '--yes', '--agent', 'claude-code'], { cwd: stage, stdio: 'inherit', env: process.env });
function cleanup() { fs.rmSync(stage, { recursive: true, force: true }); }
child.on('error', function (error) { console.error(error.message); cleanup(); process.exitCode = 1; });
process.on('SIGTERM', function () { child.kill('SIGTERM'); });
child.on('close', function (code) {
  try {
    if (code !== 0) throw new Error('Skill installer exited with code ' + code);
    var candidates = ['.agents', '.claude'].map(function (vendor) { return path.join(stage, vendor, 'skills', name); });
    var source = candidates.find(function (dir) { return fs.existsSync(path.join(dir, 'SKILL.md')); });
    if (!source) throw new Error('Installer did not create the requested skill in the private staging project');
    var root = storage.privateRoot(base); storage.directory(root);
    var destination = path.join(root, name);
    var pending = path.join(root, '.' + name + '-' + process.pid);
    fs.cpSync(source, pending, { recursive: true, dereference: true });
    if (fs.existsSync(destination)) {
      var backups = path.join(base, '.clay', 'skill-backups'); storage.directory(backups);
      fs.renameSync(destination, path.join(backups, name + '-' + Date.now()));
    }
    fs.renameSync(pending, destination);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { cleanup(); }
});
