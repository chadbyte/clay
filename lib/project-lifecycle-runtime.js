// Retain failed shutdown handles so an explicitly reviewed recovery can retry them.
var crypto = require('crypto');
var witnesses = require('./project-lifecycle-process-witness');
function attachLifecycleRuntime(ctx) {
  var epoch = crypto.randomUUID(), retired = new Map();
  function target(slug, project) {
    var status = project.getStatus();
    return { slug: slug, path: status.path, projectKnowledgeId: status.projectKnowledgeId || null, epoch: epoch };
  }
  function key(item) { return JSON.stringify([item.slug, item.path, item.projectKnowledgeId]); }
  function matches(item, project) { return key(item) === key(target(item.slug, project)); }
  function targets(slug) {
    var out = [], witness = witnesses.capture();
    ctx.projects.forEach(function (project, candidate) {
      if (candidate === slug || candidate.indexOf(slug + '--') === 0) out.push(Object.assign(target(candidate, project), { witness: witness }));
    });
    return out;
  }
  function stop(item, project) {
    var id = key(item), previous = retired.get(id);
    if (previous && previous.project !== project) {
      if (!previous.closed) throw new Error('An earlier runtime with this identity has not confirmed closure.');
      previous = null;
    }
    if (previous && previous.running) return previous.running;
    if (previous && previous.closed) return Promise.resolve(true);
    var state = previous || { project: project, target: item, closed: false };
    retired.set(id, state);
    state.running = Promise.resolve().then(function () { return state.project.destroy(); }).then(function (result) {
      if (result !== true) throw new Error('Project runtime closure was not acknowledged: ' + item.slug);
      state.closed = true; return true;
    }).finally(function () { state.running = null; });
    return state.running;
  }
  async function close(items, proof) {
    for (var item of items) {
      var live = ctx.projects.get(item.slug), previous = retired.get(key(item));
      if (live) {
        if (!matches(item, live)) throw new Error('A replacement runtime occupies this registration.');
        ctx.projects.delete(item.slug);
        await stop(item, live);
      } else if (previous) await stop(item, previous.project);
      else if (!proof && !witnesses.confirmsExit(item.witness)) throw new Error('Runtime closure evidence is unavailable on this host. Keep the operation pending until its original host confirms closure.');
    }
    return true;
  }
  function shutdown() { return Promise.all(Array.from(retired.values()).filter(function (item) { return !item.closed; }).map(function (item) { return stop(item.target, item.project); })); }
  return { targets: targets, close: close, shutdown: shutdown };
}
module.exports = { attachLifecycleRuntime: attachLifecycleRuntime };
