// Pure date subsection projection for units inside a real folder. Calendar
// boundaries are local-time Date constructors, so midnight and week/month
// transitions remain correct across DST changes.

var LABELS = ["Today", "Yesterday", "This week", "Earlier this month", "Older"];

export function unitTimestamp(unit, sort) {
  var value = sort === "created" ? unit.createdAt : unit.lastActivity;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  var parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function localDateBoundaries(nowValue) {
  var now = nowValue instanceof Date ? nowValue : new Date(nowValue === undefined ? Date.now() : nowValue);
  var year = now.getFullYear();
  var month = now.getMonth();
  var day = now.getDate();
  var today = new Date(year, month, day).getTime();
  var yesterday = new Date(year, month, day - 1).getTime();
  var mondayOffset = (now.getDay() + 6) % 7;
  var week = new Date(year, month, day - mondayOffset).getTime();
  var monthStart = new Date(year, month, 1).getTime();
  return { today: today, yesterday: yesterday, week: week, month: monthStart };
}

export function dateBucket(timestamp, boundaries) {
  if (timestamp >= boundaries.today) return "Today";
  if (timestamp >= boundaries.yesterday) return "Yesterday";
  if (timestamp >= boundaries.week) return "This week";
  if (timestamp >= boundaries.month) return "Earlier this month";
  return "Older";
}

export function groupUnitsByDate(units, sort, direction, nowValue) {
  if (sort !== "activity" && sort !== "created") return null;
  var source = Array.isArray(units) ? units : [];
  var decorated = source.map(function (unit, index) {
    return { unit: unit, index: index, timestamp: unitTimestamp(unit, sort) };
  });
  var sign = direction === "asc" ? 1 : -1;
  decorated.sort(function (a, b) {
    var delta = (a.timestamp - b.timestamp) * sign;
    return delta || a.index - b.index;
  });
  var boundaries = localDateBoundaries(nowValue);
  var byLabel = {};
  for (var i = 0; i < decorated.length; i++) {
    var label = dateBucket(decorated[i].timestamp, boundaries);
    if (!byLabel[label]) byLabel[label] = [];
    byLabel[label].push(decorated[i].unit);
  }
  var order = direction === "asc" ? LABELS.slice().reverse() : LABELS;
  var groups = [];
  for (var j = 0; j < order.length; j++) {
    if (byLabel[order[j]]) groups.push({ label: order[j], units: byLabel[order[j]] });
  }
  return groups;
}

export function unitRootSessionIds(unit) {
  var item = unit && unit.item;
  if (!item) return [];
  if (item.type === "session" && item.data && typeof item.data.id === "number") return [item.data.id];
  if (item.type === "driver-hierarchy" && item.root && item.root.driver && typeof item.root.driver.id === "number") return [item.root.driver.id];
  if (item.type === "orphan-workers" && Array.isArray(item.workers)) return item.workers.map(function (session) { return session.id; });
  if (item.type === "split-group" && Array.isArray(item.members)) return item.members.map(function (session) { return session.id; });
  if (item.type === "loop" && Array.isArray(item.children)) return item.children.map(function (session) { return session.id; });
  return [];
}

export function groupRootSessionIds(units) {
  var result = [];
  var seen = {};
  for (var i = 0; i < units.length; i++) {
    var ids = unitRootSessionIds(units[i]);
    for (var j = 0; j < ids.length; j++) {
      if (typeof ids[j] !== "number" || seen[ids[j]]) continue;
      seen[ids[j]] = true;
      result.push(ids[j]);
    }
  }
  return result;
}
