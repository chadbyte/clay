// Human-driven GitHub filing. Persist an attempt before POST so uncertain retries
// cannot publish duplicates, even after a daemon restart.
var github = require('./session-github');
var crypto = require('crypto');
var schema = require('./issues-schema');

function repository(value) {
  var parsed = github.parseReference('https://github.com/' + value + '/issues/1');
  return parsed.repository;
}
function marker(entry) { return 'clay-issue-' + entry.ref.slice(6); }
function reference(data) {
  var ref = github.parseReference(data.html_url || data.url);
  if (ref.kind !== 'issue' || data.pull_request) throw new Error('Use a GitHub issue, not a pull request.');
  return Object.assign(ref, { title: String(data.title || '').slice(0, 200),
    state: String(data.state || '').toLowerCase() === 'closed' ? 'closed' : 'open', checkedAt: Date.now() });
}
function attachIssueGithub(ctx) {
  var run = ctx.run || github.runGh;
  ctx.assessments = ctx.assessments || new Map();
  function owner(before) { return JSON.stringify([before.knowledgeId, before.path, before.userId, before.osIdentity]); }

  async function repo(before) {
    var data = await run(before.path, ['repo', 'view', '--json', 'nameWithOwner'], before.osIdentity);
    return repository(data.nameWithOwner);
  }
  function check(before, args) {
    var entry = ctx.read(before, args.ref);
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== entry.revision) throw new Error('Issue changed. Refresh before connecting GitHub.');
    return entry;
  }
  async function exclusive(args, work) {
    var before = ctx.begin();
    var key = before.knowledgeId + ':' + args.ref;
    if (ctx.locks.has(key)) throw new Error('A GitHub operation is already running for this issue.');
    ctx.locks.set(key, true);
    try { return await work(before); } finally { ctx.locks.delete(key); }
  }
  return {
    search: function (args) {
      return exclusive(args, async function (before) {
        var entry = check(before, args);
        if (entry.github && entry.github.url) return { linked: entry };
        var target = entry.github && entry.github.repository || await repo(before);
        if (entry.github && entry.github.attempt) {
          var recovery = await run(before.path, ['issue', 'list', '--repo', target, '--state', 'all', '--limit', '20', '--search', marker(entry) + ' in:body', '--json', 'url,title,state'], before.osIdentity);
          check(before, args);
          return { repository: target, pending: true, candidates: recovery.map(reference) };
        }
        var assessment = await require('./issues-github-match').assess({ run: run, read: ctx.read, reference: reference, analyze: ctx.analyze }, before, entry, target);
        check(before, args);
        if (assessment.decision === 'duplicate') {
          var verified = await github.readReference(before.path, assessment.candidates[0].url, before.osIdentity, run);
          check(before, args);
          return { linked: ctx.save(before, entry.ref, { github: verified }, entry.revision) };
        }
        var token = crypto.randomBytes(24).toString('hex');
        for (var pair of ctx.assessments) { if (pair[1].expires < Date.now()) ctx.assessments.delete(pair[0]); }
        if (ctx.assessments.size >= 200) ctx.assessments.delete(ctx.assessments.keys().next().value);
        ctx.assessments.set(token, { owner: owner(before), revision: entry.revision, ref: entry.ref, repository: target,
          ambiguous: assessment.decision === 'ambiguous', expires: Date.now() + 300000 });
        return Object.assign(assessment, { repository: target, assessment: token, preview: assessment.decision === 'none',
          draft: { title: entry.title, body: [entry.summary, entry.body].filter(Boolean).join('\n\n') } });
      });
    },
    link: function (args) {
      return exclusive(args, async function (before) {
        var entry = check(before, args);
        var ref = github.parseReference(args.url);
        if (ref.kind !== 'issue') throw new Error('Use a GitHub issue URL.');
        var verified = await github.readReference(before.path, ref.url, before.osIdentity, run);
        check(before, args);
        return ctx.save(before, entry.ref, { github: verified }, entry.revision);
      });
    },
    create: function (args) {
      return exclusive(args, async function (before) {
        var entry = check(before, args);
        if (entry.github) throw new Error(entry.github.url ? 'This issue is already connected to GitHub.' : 'A previous creation may have succeeded. Search GitHub or link its URL; another issue will not be created.');
        if (args.confirm !== true) throw new Error('Review the GitHub issue before creating it.');
        var title = schema.text(args.title, 'GitHub title', 200, true);
        var body = schema.text(args.body, 'GitHub body', 21000, true);
        var target = await repo(before);
        if (target !== args.repository) throw new Error('The target repository changed. Search again before creating.');
        check(before, args);
        var assessment = ctx.assessments.get(args.assessment);
        if (!assessment || assessment.owner !== owner(before) || assessment.ref !== entry.ref || assessment.revision !== entry.revision ||
            assessment.repository !== target || assessment.expires < Date.now()) throw new Error('Check for duplicates again before creating a GitHub issue.');
        if (assessment.ambiguous && args.rejectCandidates !== true) throw new Error('Review the possible duplicates before creating an issue.');
        ctx.assessments.delete(args.assessment);
        var attempt = crypto.randomBytes(16).toString('hex');
        ctx.save(before, entry.ref, { github: { repository: target, attempt: attempt } }, entry.revision);
        var data;
        try {
          ctx.read(before, entry.ref);
          data = await run(before.path, ['api', '--method', 'POST', 'repos/' + target + '/issues', '--input', '-'], before.osIdentity,
            JSON.stringify({ title: title, body: body + '\n\n<!-- ' + marker(entry) + ' -->' }));
        } catch (error) {
          if (error.status >= 400 && error.status < 500 && error.status !== 408) {
            var rejected = ctx.read(before, entry.ref);
            ctx.save(before, entry.ref, { github: null }, rejected.revision);
            throw new Error('GitHub rejected creation. Check authentication, repository permissions, and issue settings before trying again.');
          }
          throw new Error('Creation could not be confirmed. Refresh and search GitHub before retrying; Clay will not create a duplicate.');
        }
        var linked = reference(data);
        if (linked.repository.toLowerCase() !== target.toLowerCase()) throw new Error('GitHub returned a different repository. Refresh and link the created issue.');
        try {
          var latest = ctx.read(before, entry.ref);
          if (!latest.github || latest.github.attempt !== attempt) throw new Error('GitHub association changed.');
          return ctx.save(before, entry.ref, { github: linked }, latest.revision);
        } catch (error) { throw new Error('GitHub issue created at ' + linked.url + '. Refresh and link this URL to finish.'); }
      });
    },
  };
}
module.exports = { attachIssueGithub: attachIssueGithub };
