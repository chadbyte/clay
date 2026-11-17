// Only the daemon's local IPC operator can issue these approvals. HTTP can review them.
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
function attachRecoveryApprovals(ctx) {
  var tickets = new Map();
  function now() { return ctx.now ? ctx.now() : Date.now(); }
  function hash(code) { return crypto.createHash('sha256').update(code).digest('hex'); }
  function prune() { tickets.forEach(function (ticket, key) { if (ticket.expiresAt <= now()) tickets.delete(key); }); }
  function issue(slug, username) {
    try {
      prune();
      var check = ctx.inspect(slug);
      if (!check.operatorApprovalAvailable || ctx.getConfig().osUsers) throw new Error('Local operator approval is unavailable. Repair the verified system identity mapping when OS isolation is enabled.');
      var account = ctx.getAccounts().find(function (entry) { return entry.username === username; });
      if (!account) throw new Error('Choose an existing account by its exact username.');
      var project = ctx.getConfig().projects.find(function (entry) { return entry.slug === slug; });
      if (!fs.lstatSync(project.path).isDirectory() || fs.realpathSync(project.path) !== path.resolve(project.path)) throw new Error('Restore the real project directory before approving recovery.');
      if (tickets.size >= 100) throw new Error('Too many outstanding approvals. Wait for an approval to expire.');
      var code = crypto.randomBytes(24).toString('hex');
      var ticket = { slug: slug, revision: check.revision, owner: { id: account.id, name: account.displayName || account.username }, expiresAt: now() + 600000, actorId: null };
      tickets.set(hash(code), ticket);
      return { ok: true, slug: slug, owner: ticket.owner, approvalCode: code, expiresAt: ticket.expiresAt };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  function review(slug, code, actorId) {
    prune();
    var ticket = typeof code === 'string' && tickets.get(hash(code));
    if (!actorId || !ticket || ticket.slug !== slug || (ticket.actorId && ticket.actorId !== actorId)) throw new Error('Approval is invalid, expired or already used. Ask the server operator for a new approval.');
    var check = ctx.inspect(slug);
    if (!check.operatorApprovalAvailable || check.revision !== ticket.revision || ctx.getConfig().osUsers) throw new Error('The project or accounts changed. Ask the server operator to approve the current state.');
    ticket.actorId = actorId;
    return Object.assign({}, check, { status: 'ready', code: 'operator_approved', owner: ticket.owner, expiresAt: ticket.expiresAt, message: 'The server operator approved this recovery owner. Review the exact project and account before applying.' });
  }
  function consume(code) { tickets.delete(hash(code)); }
  return { issue: issue, review: review, consume: consume };
}
module.exports = { attachRecoveryApprovals: attachRecoveryApprovals };
