// Local operator authority: this command never runs through the browser API.
function handleRecoveryCommand(args, ctx) {
  function finish(code) { if (ctx.finish) ctx.finish(code); else process.exitCode = code; }
  var index = args.indexOf('--authorize-project-recovery');
  if (index === -1 || args.includes('--help') || args.includes('-h')) return false;
  var slug = args[index + 1], ownerIndex = args.indexOf('--owner'), owner = args[ownerIndex + 1];
  var expected = ['--authorize-project-recovery', slug, '--owner', owner];
  if (args.includes('--dev')) expected.push('--dev');
  if (!slug || !/^[a-z0-9_-]+$/.test(slug) || ownerIndex === -1 || !owner || owner.startsWith('--') || args.length !== expected.length || args.some(function (arg) { return !expected.includes(arg); })) {
    console.error('Usage: clay-server [--dev] --authorize-project-recovery <slug> --owner <existing-username>'); finish(1); return true;
  }
  ctx.send(ctx.socketPath(), { cmd: 'authorize_project_recovery', slug: slug, owner: owner }).then(function (result) {
    if (!result.ok) { console.error('Recovery approval failed: ' + result.error); finish(1); return; }
    console.log('Approved recovery of ' + result.slug + ' to ' + result.owner.name + '.');
    console.log('In Project Settings → Access → Server approval, enter this one-use code:');
    console.log(result.approvalCode);
    console.log('Expires at ' + new Date(result.expiresAt).toISOString() + '. Restarting the daemon also expires it. Ownership has not changed.');
    finish(0);
  }).catch(function (error) { console.error('Recovery approval failed: ' + error.message); finish(1); });
  return true;
}
module.exports = { handleRecoveryCommand: handleRecoveryCommand };
