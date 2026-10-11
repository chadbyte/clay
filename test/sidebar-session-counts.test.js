var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var url = require('node:url');

var modulePromise = import(url.pathToFileURL(path.join(__dirname, '../lib/public/modules/sidebar-session-counts.js')).href);
var dateGroupsPromise = import(url.pathToFileURL(path.join(__dirname, '../lib/public/modules/session-date-groups.js')).href);

test('sidebar headline counts unique roots while Worker detail includes visible retained generations', async function () {
  var counts = await modulePromise;
  var driver = { id: 1, sessionRole: 'driver' };
  var workerOne = { id: 2, sessionRole: 'worker' };
  var workerTwo = { id: 3, sessionRole: 'worker' };
  var items = [
    { type: 'driver-hierarchy', root: { driver: driver, workers: [workerOne, workerTwo] } },
    { type: 'session', data: { id: 4 } },
    { type: 'orphan-workers', workers: [{ id: 5, sessionRole: 'worker' }] },
    { type: 'split-group', members: [{ id: 6 }, workerOne] },
    { type: 'loop', children: [{ id: 7 }, { id: 7 }] },
  ];
  assert.deepEqual(counts.summarizeSidebarItems(items, null), { roots: 4, workers: 3 });
  assert.equal(counts.sidebarCountLabel({ roots: 4, workers: 3 }, true), '4 Drivers · 3 Split Workers');
});

test('hierarchy search counts the contextual Driver once and only rendered Worker matches', async function () {
  var counts = await modulePromise;
  var item = { type: 'driver-hierarchy', root: {
    driver: { id: 10, sessionRole: 'driver' },
    workers: [{ id: 11, sessionRole: 'worker' }, { id: 12, sessionRole: 'worker' }],
  } };
  assert.deepEqual(counts.summarizeSidebarItems([item], new Set([11])), { roots: 1, workers: 1 });
  assert.deepEqual(counts.summarizeSidebarItems([item], new Set([10])), { roots: 1, workers: 2 });
  assert.deepEqual(counts.summarizeSidebarUnits([{ item: item }, { item: item }], null), { roots: 1, workers: 2 });
});

test('display counts stay semantic while date Clear keeps its independent session-id scope', async function () {
  var counts = await modulePromise;
  var dateGroups = await dateGroupsPromise;
  var units = [{ item: {
    type: 'orphan-workers',
    workers: [{ id: 20, sessionRole: 'worker' }, { id: 21, sessionRole: 'worker' }],
  } }, { item: {
    type: 'split-group',
    members: [{ id: 22, sessionRole: 'driver' }, { id: 23, sessionRole: 'worker' }],
  } }, { item: {
    type: 'loop',
    children: [{ id: 24, sessionRole: 'driver' }, { id: 25, sessionRole: 'driver' }],
  } }];
  assert.deepEqual(counts.summarizeSidebarUnits(units, null), { roots: 3, workers: 3 });
  assert.deepEqual(dateGroups.groupRootSessionIds(units), [20, 21, 22, 23, 24, 25]);
});
