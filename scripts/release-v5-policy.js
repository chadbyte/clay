// Release majors are a deliberate product decision while Clay stays on v5.
function verifyRelease(config, context) {
  var version = context.nextRelease && context.nextRelease.version;
  if (!/^5\./.test(version || '')) {
    throw new Error('Clay releases must stay on v5. Refusing ' + version + '. An existing v6 prerelease requires release-history recovery before beta publishing can resume.');
  }
}
module.exports = { verifyRelease: verifyRelease };
