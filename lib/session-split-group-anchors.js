function value(input) {
  return typeof input === "string" && input ? input : null;
}

function pairFor(session, previousCli, previousOrigin) {
  return {
    cli: value(session && session.cliSessionId) || value(previousCli),
    origin: value(session && session.sessionOriginId) || value(previousOrigin),
  };
}

function memberAnchors(group, sessions) {
  var previousCli = Array.isArray(group.memberCliIds) ? group.memberCliIds : [null, null];
  var previousOrigin = Array.isArray(group.memberOriginIds) ? group.memberOriginIds : [null, null];
  var left = pairFor(sessions.get(group.members[0]), previousCli[0], previousOrigin[0]);
  var right = pairFor(sessions.get(group.members[1]), previousCli[1], previousOrigin[1]);
  return { cli: [left.cli, right.cli], origin: [left.origin, right.origin] };
}

function pairAnchors(group, sessions) {
  if (!group.pair) return null;
  var previousCli = Array.isArray(group.pairCliIds) ? group.pairCliIds : [null, null];
  var previousOrigin = Array.isArray(group.pairOriginIds) ? group.pairOriginIds : [null, null];
  var driver = pairFor(sessions.get(group.pair.driverId), previousCli[0], previousOrigin[0]);
  var worker = pairFor(sessions.get(group.pair.workerId), previousCli[1], previousOrigin[1]);
  return { cli: [driver.cli, worker.cli], origin: [driver.origin, worker.origin] };
}

function findSession(sessions, cliId, originId) {
  var cli = value(cliId);
  var origin = value(originId);
  if (!cli && !origin) return null;
  var found = null;
  var ambiguous = false;
  sessions.forEach(function (session) {
    if (cli && session.cliSessionId !== cli) return;
    if (origin && session.sessionOriginId !== origin) return;
    if (found && found !== session) ambiguous = true;
    else found = session;
  });
  return ambiguous ? null : found;
}

module.exports = { findSession: findSession, memberAnchors: memberAnchors, pairAnchors: pairAnchors };
