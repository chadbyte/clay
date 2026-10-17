// The daemon and production UI fixtures share these exact callback adapters.
function attachLifecycleCallbacks(ctx) {
  function attempt(action) {
    try { return action(); }
    catch (error) { return Object.assign({ ok: false, status: 'failed', error: error.message, persisted: false, retrySafe: true }, error.lifecycleResult || {}); }
  }
  return {
    onAddProject: function (candidate, user) { return attempt(function () { return ctx.service.register(candidate, user); }); },
    onCreateProject: function (name, user) { return attempt(function () { return ctx.service.create(name, user); }); },
    onRemoveProject: function (slug, userId) { return ctx.service.remove(slug, userId); },
    onSetProjectTitle: function (slug, title) { return attempt(function () { return ctx.service.update(slug, 'rename', title); }); },
    onSetProjectEnv: function (slug, value) { return attempt(function () { return ctx.service.update(slug, 'environment', value); }); },
  };
}
module.exports = { attachLifecycleCallbacks: attachLifecycleCallbacks };
