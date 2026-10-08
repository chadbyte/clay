var test = require("node:test");
var assert = require("node:assert");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var modulePromise = import(pathToFileURL(path.join(__dirname, "../lib/public/modules/session-date-groups.js")).href);

function unit(key, activity, created, item) {
  return { key: key, lastActivity: activity, createdAt: created, item: item || { type: "session", data: { id: key } } };
}

function labels(groups) {
  return groups.map(function (group) { return group.label; });
}

function keys(groups) {
  return groups.map(function (group) { return group.units.map(function (entry) { return entry.key; }); });
}

test("date buckets use disjoint local calendar boundaries with Monday week start", async function () {
  var api = await modulePromise;
  var now = new Date(2026, 2, 18, 15, 30);
  var boundaries = api.localDateBoundaries(now);
  assert.equal(new Date(boundaries.today).getHours(), 0, "today begins at local midnight");
  assert.equal(new Date(boundaries.week).getDay(), 1, "week begins on Monday");
  assert.equal(api.dateBucket(new Date(2026, 2, 18, 1).getTime(), boundaries), "Today");
  assert.equal(api.dateBucket(new Date(2026, 2, 17, 23).getTime(), boundaries), "Yesterday");
  assert.equal(api.dateBucket(new Date(2026, 2, 16, 9).getTime(), boundaries), "This week");
  assert.equal(api.dateBucket(new Date(2026, 2, 8, 9).getTime(), boundaries), "Earlier this month");
  assert.equal(api.dateBucket(new Date(2026, 1, 28, 9).getTime(), boundaries), "Older");
});

test("yesterday and current week take precedence across month rollover", async function () {
  var api = await modulePromise;
  var boundaries = api.localDateBoundaries(new Date(2026, 3, 1, 12));
  assert.equal(api.dateBucket(new Date(2026, 2, 31, 8).getTime(), boundaries), "Yesterday");
  assert.equal(api.dateBucket(new Date(2026, 2, 30, 8).getTime(), boundaries), "This week");
  assert.equal(api.dateBucket(new Date(2026, 2, 29, 8).getTime(), boundaries), "Older");
});

test("calendar construction stays at local midnight across DST-adjacent dates", async function () {
  var api = await modulePromise;
  var before = api.localDateBoundaries(new Date(2026, 8, 27, 12));
  var after = api.localDateBoundaries(new Date(2026, 8, 28, 12));
  assert.equal(new Date(before.today).getHours(), 0);
  assert.equal(new Date(after.yesterday).getDate(), 27, "calendar subtraction reaches the prior local date");
  assert.equal(api.dateBucket(new Date(2026, 8, 27, 20).getTime(), after), "Yesterday");
});

test("selected timestamp controls grouping and sorting; oldest reverses groups and items", async function () {
  var api = await modulePromise;
  var now = new Date(2026, 2, 18, 12);
  var todayEarly = new Date(2026, 2, 18, 8).getTime();
  var todayLate = new Date(2026, 2, 18, 10).getTime();
  var yesterday = new Date(2026, 2, 17, 9).getTime();
  var older = new Date(2026, 0, 1, 9).getTime();
  var units = [unit(1, todayEarly, older), unit(2, todayLate, yesterday), unit(3, yesterday, todayLate), unit(4, 0, 0)];
  var recent = api.groupUnitsByDate(units, "activity", "desc", now);
  assert.deepStrictEqual(labels(recent), ["Today", "Yesterday", "Older"]);
  assert.deepStrictEqual(keys(recent), [[2, 1], [3], [4]]);
  var oldest = api.groupUnitsByDate(units, "activity", "asc", now);
  assert.deepStrictEqual(labels(oldest), ["Older", "Yesterday", "Today"]);
  assert.deepStrictEqual(keys(oldest), [[4], [3], [1, 2]]);
  var created = api.groupUnitsByDate(units, "created", "desc", now);
  assert.deepStrictEqual(keys(created), [[3], [2], [1, 4]], "creation timestamps produce a different grouping and order");
  assert.equal(api.groupUnitsByDate(units, "title", "asc", now), null);
  assert.equal(api.groupUnitsByDate(units, "manual", "desc", now), null);
});

test("group deletion IDs are root scoped and do not split a Driver hierarchy", async function () {
  var api = await modulePromise;
  var driver = unit(3, 1, 1, { type: "driver-hierarchy", root: { driver: { id: 3 }, workers: [{ id: 4 }, { id: 5 }] } });
  var plain = unit(1, 1, 1);
  assert.deepStrictEqual(api.groupRootSessionIds([driver, plain, plain]), [3, 1]);
});
