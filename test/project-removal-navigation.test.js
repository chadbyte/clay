var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var pathToFileURL = require('node:url').pathToFileURL;

var root = path.join(__dirname, '..');
var targetPath = path.join(root, 'lib/public/modules/project-removal-target.js');
var projectsPath = path.join(root, 'lib/public/modules/app-projects.js');

test('active project removal selects the next regular project', async function () {
  var module = await import(pathToFileURL(targetPath).href);
  var projects = [
    { slug: 'alpha' },
    { slug: 'bravo' },
    { slug: 'charlie' },
  ];

  assert.equal(module.chooseProjectAfterRemoval(projects, 'bravo'), 'charlie');
});

test('removing the last project selects the previous regular project', async function () {
  var module = await import(pathToFileURL(targetPath).href);
  var projects = [
    { slug: 'alpha' },
    { slug: 'bravo' },
  ];

  assert.equal(module.chooseProjectAfterRemoval(projects, 'bravo'), 'alpha');
});

test('worktree removal prefers its parent project', async function () {
  var module = await import(pathToFileURL(targetPath).href);
  var projects = [
    { slug: 'other' },
    { slug: 'alpha' },
    { slug: 'alpha--feature' },
  ];

  assert.equal(module.chooseProjectAfterRemoval(projects, 'alpha--feature'), 'alpha');
});

test('removal ignores Mate projects and uses Home only when no regular project remains', async function () {
  var module = await import(pathToFileURL(targetPath).href);
  var projects = [
    { slug: 'alpha' },
    { slug: 'mate-one', isMate: true },
  ];

  assert.equal(module.chooseProjectAfterRemoval(projects, 'alpha'), null);
});

test('a project-list race falls back to the first remaining regular project', async function () {
  var module = await import(pathToFileURL(targetPath).href);
  var projects = [
    { slug: 'alpha' },
    { slug: 'bravo' },
  ];

  assert.equal(module.chooseProjectAfterRemoval(projects, 'already-removed'), 'alpha');
});

test('active project removal closes settings before navigating', function () {
  var source = fs.readFileSync(projectsPath, 'utf8');
  var handlerStart = source.indexOf('export function handleRemoveProjectResult');
  var handlerEnd = source.indexOf('// --- Add project modal ---', handlerStart);
  var handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /var targetSlug = chooseProjectAfterRemoval\(cachedProjects, msg\.slug\);/);
  assert.match(handler, /closeProjectSettings\(\);/);
  assert.match(handler, /if \(targetSlug\) \{\s*switchProject\(targetSlug\);\s*\} else \{[\s\S]*wsPath: "\/ws"[\s\S]*showProjectsHub\(\);\s*connect\(\);/);
  assert.ok(handler.indexOf('closeProjectSettings();') < handler.indexOf('switchProject(targetSlug);'));
});
