var driverEligibility = require("./session-driver-eligibility");

function activeActor(users, ownerId) {
  if (!ownerId || !users || typeof users.findUserById !== "function") return null;
  var actor = users.findUserById(ownerId);
  if (!actor || actor.disabled === true || actor.active === false || actor.status === "disabled" || actor.status === "inactive") return null;
  return actor;
}

function authorize(settings, session, ownerId) {
  var users = settings.usersModule;
  if (!users || typeof users.isMultiUser !== "function") return false;
  if (!users.isMultiUser()) return !!session && !session.ownerId;
  var actor;
  try { actor = activeActor(users, ownerId); }
  catch (error) { return false; }
  if (!actor || !session || typeof settings.getProjectAccess !== "function" ||
      typeof settings.canAccessProjectSlug !== "function" || typeof users.canAccessSession !== "function") return false;
  try {
    var access = settings.getProjectAccess();
    if (!access || access.error || settings.canAccessProjectSlug(actor.id, settings.projectSlug) !== true) return false;
    return users.canAccessSession(actor.id, session, access) === true;
  } catch (error) {
    return false;
  }
}

function findOwnedSessionByOrigin(sessions, originId, ownerId) {
  if (!sessions || !originId) return null;
  var found = null;
  var ambiguous = false;
  sessions.forEach(function (session) {
    if (!session || session.sessionOriginId !== originId ||
        (session.ownerId || null) !== (ownerId || null)) return;
    if (found && found !== session) ambiguous = true;
    else found = session;
  });
  return ambiguous ? null : found;
}

function isLiveDriver(session, isMate, sessions, isDriverOperatedSession) {
  if (!session || isMate || session.isMate === true || !sessions || sessions.get(session.localId) !== session) return false;
  try {
    if (typeof isDriverOperatedSession === "function" && isDriverOperatedSession(session) === true) return false;
  } catch (error) {
    return false;
  }
  return driverEligibility.isEligibleDriverSession(session) && session.hidden !== true &&
    session.delegated !== true && !session._pairDelegation && !session._delegatedBy &&
    !session.scheduledTaskRun && !session.projectLogReview;
}

module.exports = { authorize: authorize, activeActor: activeActor,
  findOwnedSessionByOrigin: findOwnedSessionByOrigin, isLiveDriver: isLiveDriver };
