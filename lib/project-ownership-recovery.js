var crypto = require('crypto');
var fs = require('fs');
var ownership = require('./project-ownership');
var inspectPrivateOwner = require('./project-ownership-diagnostics').inspectPrivateOwner;
var REASONS = {
  project_path_unverified: 'The project directory is not a verified real directory. The server operator must check its canonical path.',
  project_unavailable: 'The server cannot inspect the project directory. The server operator must restore the directory or its filesystem access.',
  identity_unresolved: 'A configured system account cannot be resolved. The server operator must repair verified account provisioning.',
  mapping_unavailable: 'No verified account-to-system-user mapping is available. The server operator must verify or restore the original account mapping.',
  owner_not_verified: 'No mapped account matches both the directory owner and its real home. The server operator must verify the original ownership and mapping.',
  ambiguous_mapping: 'More than one account shares a system identity or overlapping home. The server operator must resolve the ambiguity.',
  no_administrator: 'No existing administrator is available for the public project recovery policy.',
  verified: 'The ownership checks identify one recovery owner.',
  healthy: 'This project already has a valid owner.'
};
function createRecoveryService(ctx) {
  var publicationFailures = new Map();
  function inspect(slug) {
    var config = ctx.getConfig(), accounts = ctx.getAccounts();
    var project = (config.projects || []).find(function (entry) { return entry.slug === slug; });
    if (!project || ownership.isPersonal(project) || slug.includes('--')) throw new Error('Choose an ordinary parent project for ownership recovery.');
    var owner = accounts.find(function (account) { return account.id === project.ownerId; });
    var healthy = owner && project.ownershipRecovery !== 'required';
    var evidence = { code: healthy ? 'healthy' : 'verified', ownerId: owner && owner.id, evidence: [] };
    if (!owner) {
      if ((project.visibility || (config.osUsers ? 'private' : 'public')) === 'public') {
        var admins = accounts.filter(function (account) { return account.role === 'admin'; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
        var preferred = config.ownershipRecoveryAdminId || config.singleUserMigratedUserId;
        var designated = admins.find(function (account) { return account.id === preferred; }) || admins[0];
        evidence = { code: designated ? 'verified' : 'no_administrator', ownerId: designated && designated.id, evidence: [] };
      } else evidence = inspectPrivateOwner(project, accounts, ctx.resolveIdentity);
    }
    var directoryStamp;
    try { var stat = fs.lstatSync(project.path); directoryStamp = [stat.dev, stat.ino, stat.uid, stat.mode]; } catch (error) { directoryStamp = 'unavailable'; }
    var candidate = accounts.find(function (account) { return account.id === evidence.ownerId; });
    var revision = crypto.createHash('sha256').update(JSON.stringify([project, directoryStamp, config.osUsers, config.ownershipRecoveryAdminId, config.singleUserMigratedUserId,
      accounts.map(function (account) { return [account.id, account.role, account.linuxUser, account.displayName, account.username]; }), evidence])).digest('hex');
    var failed = publicationFailures.get(slug) === revision;
    return { slug: slug, status: failed ? 'publication_failed' : healthy ? 'healthy' : candidate ? 'ready' : 'blocked', code: failed ? 'publication_failed' : evidence.code, message: failed ? 'Ownership was saved but runtime publication failed. The server operator must reload the saved configuration before further recovery.' : REASONS[evidence.code], revision: revision,
      owner: candidate ? { id: candidate.id, name: candidate.displayName || candidate.username } : null,
      checkedAt: Date.now(), sessionOwnersChanged: false };
  }
  function apply(slug, revision, authorize) {
    authorize();
    var check = inspect(slug);
    if (check.status !== 'ready' || check.revision !== revision) throw new Error('Ownership evidence changed or recovery is unavailable. Check again and review the current result.');
    authorize();
    var next = JSON.parse(JSON.stringify(ctx.getConfig()));
    var project = next.projects.find(function (entry) { return entry.slug === slug; });
    project.ownerId = check.owner.id; delete project.ownershipRecovery;
    // Persistence must complete before any runtime or account can see repaired ownership.
    ctx.persist(next);
    try { ctx.publish(next, slug, check.owner.id); }
    catch (error) { publicationFailures.set(slug, revision); return { ok: false, status: 'publication_failed', persisted: true, error: 'Ownership was saved, but runtime publication failed. Ask the server operator to reload the saved configuration; do not repeat recovery.' }; }
    return { ok: true, status: 'recovered', persisted: true, owner: check.owner, sessionOwnersChanged: false };
  }
  return { inspect: inspect, apply: apply };
}
module.exports = { createRecoveryService: createRecoveryService };
