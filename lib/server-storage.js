var scanStorage = require('./storage-usage').scanStorage;

function attachStorage(ctx) {
  var pending = null;
  var cached = null;
  var progress = null;
  var expires = 0;
  var failed = false;
  function reply(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function authorized(req, res) {
    if (!ctx.isRequestAuthed(req)) { reply(res, 401, { error: 'Authentication required.' }); return false; }
    var user = ctx.getMultiUserFromReq(req);
    if (ctx.users.isMultiUser() && (!user || user.role !== 'admin')) {
      reply(res, 403, { error: 'Only server administrators can view disk usage.' }); return false;
    }
    return true;
  }
  function handleRequest(req, res, url) {
    if (url !== '/api/server/storage') return false;
    if (!authorized(req, res)) return true;
    if (req.method !== 'GET') { reply(res, 405, { error: 'Method not allowed.' }); return true; }
    if (failed && Date.now() < expires) { reply(res, 500, { error: 'Disk usage could not be measured. Try again in a few seconds.' }); return true; }
    if (cached && Date.now() < expires) { reply(res, 200, cached); return true; }
    if (!pending) {
      progress = null; failed = false;
      var users = ctx.users.getAllUsers();
      var projects = ctx.getProjects ? ctx.getProjects() : [];
      if (!ctx.users.isMultiUser() && users.length <= 1) {
        if (!users.length) users = [{ id: 'local', username: 'Local user' }];
        projects = projects.map(function (project) { return Object.assign({}, project, { projectOwnerId: project.projectOwnerId || users[0].id }); });
      }
      pending = (ctx.scanStorage || scanStorage)({ configDir: ctx.configDir, platform: process.platform,
        attribution: ctx.osUsers && ctx.users.isMultiUser() && process.platform === 'linux' ? 'filesystem' : 'project',
        users: users, projects: projects, onProgress: function (data) { progress = data; },
        projectPaths: ctx.getProjectPaths ? ctx.getProjectPaths() : [] }).then(function (result) {
        cached = result; expires = Date.now() + 30000; return result;
      }).catch(function (error) { failed = true; expires = Date.now() + 5000; throw error; }).finally(function () { pending = null; });
    }
    var timer;
    Promise.race([pending, new Promise(function (resolve) {
      timer = setTimeout(function () { resolve(progress || { scanning: true }); }, 750);
    })]).then(function (result) {
      clearTimeout(timer);
      if (!res.destroyed && authorized(req, res)) reply(res, result.scanning ? 202 : 200, result);
    }).catch(function () {
      clearTimeout(timer);
      if (!res.destroyed) reply(res, 500, { error: 'Disk usage could not be measured. Try refreshing.' });
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachStorage: attachStorage };
