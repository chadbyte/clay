var scanStorage = require('./storage-usage').scanStorage;

function attachStorage(ctx) {
  var pending = null;
  var cached = null;
  var progress = null;
  var expires = 0;
  var failed = false;
  var scanIdentity = null;
  function projectIdentity() {
    return JSON.stringify((ctx.getProjects ? ctx.getProjects() : []).map(function (project) { return [project.slug, project.path, project.projectOwnerId, project.isMate]; }));
  }
  function targetProject(slug) {
    return (ctx.getProjects ? ctx.getProjects() : []).find(function (project) { return project.slug === slug && !project.isMate && !/^mate-/.test(slug); });
  }
  function usageReply(req, res, result, slug) {
    if (!authorized(req, res)) return;
    if (!slug) { reply(res, result.scanning ? 202 : 200, result); return; }
    if (!targetProject(slug)) { reply(res, 404, { error: 'Project is no longer registered.' }); return; }
    if (scanIdentity !== projectIdentity()) { reply(res, 409, { error: 'Project registration changed. Refresh usage.' }); return; }
    var usage = (result.projects || []).find(function (project) { return project.slug === slug; });
    reply(res, result.scanning ? 202 : 200, { slug: slug, scanning: !!result.scanning, partial: !!result.partial, checkedAt: result.checkedAt || null, usage: usage || null });
  }
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
    var pathname = url.split('?')[0];
    var match = /^\/api\/server\/storage\/project\/([^/]+)$/.exec(pathname);
    if (pathname !== '/api/server/storage' && !match) return false;
    var slug = null;
    var refresh = new URL(url, 'http://localhost').searchParams.get('refresh') === '1';
    if (!authorized(req, res)) return true;
    if (req.method !== 'GET') { reply(res, 405, { error: 'Method not allowed.' }); return true; }
    if (match) {
      try { slug = decodeURIComponent(match[1]); } catch (error) { reply(res, 400, { error: 'Invalid project.' }); return true; }
      if (!targetProject(slug)) { reply(res, 404, { error: 'Project not found.' }); return true; }
    }
    if (!pending && scanIdentity !== projectIdentity()) { cached = null; failed = false; }
    if (failed && Date.now() < expires) { reply(res, 500, { error: 'Disk usage could not be measured. Try again in a few seconds.' }); return true; }
    if (!pending && !refresh && cached && Date.now() < expires) { usageReply(req, res, cached, slug); return true; }
    if (!pending) {
      progress = null; failed = false;
      scanIdentity = projectIdentity();
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
        cached = result; expires = Date.now() + 300000; return result;
      }).catch(function (error) { failed = true; expires = Date.now() + 5000; throw error; }).finally(function () { pending = null; });
    }
    var timer;
    Promise.race([pending, new Promise(function (resolve) {
      timer = setTimeout(function () { resolve(progress || { scanning: true }); }, 750);
    })]).then(function (result) {
      clearTimeout(timer);
      if (!res.destroyed) usageReply(req, res, result, slug);
    }).catch(function () {
      clearTimeout(timer);
      if (!res.destroyed) reply(res, 500, { error: 'Disk usage could not be measured. Try refreshing.' });
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachStorage: attachStorage };
