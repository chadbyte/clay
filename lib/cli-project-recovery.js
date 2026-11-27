// Keep the former approval command as a harmless pointer to direct GUI recovery.
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
  console.log('Sign in as an administrator and open Project Settings → Access for ' + slug + '.');
  console.log('Read the proposed owner, then choose Recover ownership. No approval code or CLI command is needed.');
  console.log('Ownership has not changed. OS-isolated projects still require verified system identities.');
  finish(0);
  return true;
}
module.exports = { handleRecoveryCommand: handleRecoveryCommand };
