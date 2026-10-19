var MAX_NAME_LENGTH = 80;

function mode(view) {
  if (view && (view.nameMode === "automatic" || view.nameMode === "custom")) return view.nameMode;
  return view && view.name === "Split view" ? "automatic" : "custom";
}

function truncate(name) {
  var chars = Array.from(name);
  return chars.length <= MAX_NAME_LENGTH ? name : chars.slice(0, MAX_NAME_LENGTH - 1).join("") + "…";
}

function automaticName(sessions) {
  var titles = (sessions || []).map(function (session) {
    return session && typeof session.title === "string" && session.title.trim() || "Session";
  });
  return truncate(titles.length ? titles.join(" + ") : "Split view");
}

function project(view, sessions) {
  var nameMode = mode(view), fullName = (sessions || []).map(function (session) {
    return session && typeof session.title === "string" && session.title.trim() || "Session";
  }).join(" + ");
  return { id: view.id, name: nameMode === "automatic" ? truncate(fullName || "Split view") : view.name,
    fullName: nameMode === "automatic" ? fullName || "Split view" : view.name, nameMode: nameMode,
    folderId: view.folderId || null, favorite: view.favorite === true,
    revision: view.revision, layout: view.layout, activeSessionOriginId: view.activeSessionOriginId,
    tree: view.tree, sessions: sessions };
}

function stableOrder(existingRefs, refs, sessions, requiredOrigins) {
  if (!Array.isArray(existingRefs) || !Array.isArray(refs) || !Array.isArray(sessions) || refs.length !== sessions.length) return null;
  var priorOrigins = existingRefs.map(function (ref) { return ref && ref.originId; });
  if (priorOrigins.some(function (origin, index) { return !origin || priorOrigins.indexOf(origin) !== index; })) return null;
  var requested = refs.map(function (ref, index) {
    var session = sessions[index];
    return ref && session && ref.originId === session.sessionOriginId ? ref.originId : null;
  });
  if (requested.some(function (origin, index) { return !origin || requested.indexOf(origin) !== index; })) return null;
  if (requiredOrigins && (requested.length !== requiredOrigins.length || requiredOrigins.some(function (origin) { return requested.indexOf(origin) === -1; }))) return null;
  var origins = existingRefs.map(function (ref) { return ref && ref.originId; }).filter(function (origin) { return requested.indexOf(origin) !== -1; });
  requested.forEach(function (origin) { if (origins.indexOf(origin) === -1) origins.push(origin); });
  if (origins.length !== requested.length) return null;
  return { refs: origins.map(function (id) { return refs.find(function (ref) { return ref.originId === id; }); }),
    sessions: origins.map(function (id) { return sessions.find(function (session) { return session.sessionOriginId === id; }); }) };
}

function append(view, refs, sessions, origin) {
  if (!view || !Array.isArray(view.sessionRefs) || view.sessionRefs.some(function (ref) { return !ref || ref.originId === origin; })) return null;
  var required = view.sessionRefs.map(function (ref) { return ref.originId; });
  required.push(origin);
  return stableOrder(view.sessionRefs, refs, sessions, required);
}

function update(view, refs, sessions) { return view ? stableOrder(view.sessionRefs, refs, sessions) : null; }

function targetFirst(refs, sessions, targetOrigin, movedOrigin) {
  if (!targetOrigin || !movedOrigin || targetOrigin === movedOrigin) return null;
  var ordered = stableOrder([], refs, sessions, [targetOrigin, movedOrigin]);
  if (!ordered || ordered.refs.length !== 2) return null;
  var target = ordered.refs.find(function (ref) { return ref.originId === targetOrigin; });
  var moved = ordered.refs.find(function (ref) { return ref.originId === movedOrigin; });
  return target && moved ? { refs: [target, moved], sessions: [ordered.sessions.find(function (session) { return session.sessionOriginId === targetOrigin; }),
    ordered.sessions.find(function (session) { return session.sessionOriginId === movedOrigin; })] } : null;
}

module.exports = { mode: mode, truncate: truncate, automaticName: automaticName, project: project, append: append, update: update, targetFirst: targetFirst };
