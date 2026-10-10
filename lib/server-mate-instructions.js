// Owner-scoped identity editing; generated instruction sections stay intact.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

function revision(content) { return crypto.createHash('sha256').update(content).digest('hex'); }
function handleMateInstructions(mates, ws, msg, userId) {
  if (msg.type !== 'mate_instructions_get' && msg.type !== 'mate_instructions_set') return false;
  var reply = {type: 'mate_instructions_result', mateId: msg.mateId, requestId: msg.requestId, operation: msg.type === 'mate_instructions_set' ? 'save' : 'read', ok: false};
  try {
    var ctx = mates.buildMateCtx(userId);
    if (typeof msg.mateId !== 'string' || !mates.isMateIdFormat(msg.mateId) || !mates.getMate(ctx, msg.mateId)) throw new Error('Mate not found.');
    var directory = mates.getMateDir(ctx, msg.mateId);
    var file = path.join(directory, 'CLAUDE.md');
    if (!fs.lstatSync(file).isFile()) throw new Error('Mate instructions are unavailable.');
    var content = fs.readFileSync(file, 'utf8');
    var identity = mates.extractIdentity(content);
    if (msg.type === 'mate_instructions_set') {
      if (msg.revision !== revision(identity)) {
        reply.conflict = true;
        throw new Error('The prompt changed elsewhere. Reload the saved prompt before applying your edits.');
      }
      if (typeof msg.content !== 'string' || msg.content.trim().length < 50 || Buffer.byteLength(msg.content, 'utf8') > 131072) throw new Error('Use a prompt between 50 characters and 128 KB.');
      var next = msg.content.trimEnd();
      if (mates.extractIdentity(next) !== next) throw new Error('System-managed instruction sections cannot be included in the editable prompt.');
      var temporary = file + '.settings-' + crypto.randomBytes(8).toString('hex');
      try {
        fs.writeFileSync(temporary, next + content.slice(identity.length), {encoding: 'utf8', mode: fs.statSync(file).mode & 511, flag: 'wx'});
        fs.renameSync(temporary, file);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      // The canonical save succeeds independently of best-effort audit copies.
      try { mates.backupIdentity(directory, next); mates.logIdentityChange(directory, 'user_settings', next, identity); } catch (error) {}
      identity = next;
    }
    reply.ok = true;
    reply.content = identity;
    reply.revision = revision(identity);
  } catch (error) {
    reply.error = error.code === 'ENOENT' ? 'Mate instructions are unavailable.' : error.message;
  }
  ws.send(JSON.stringify(reply));
  return true;
}
module.exports = {handleMateInstructions: handleMateInstructions};
