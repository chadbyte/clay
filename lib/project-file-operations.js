// Shared file-viewer effects. Authority and scope are derived by each caller.
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var resolve = require('./project-file-path').resolveFilePath;
function hash(content) { return crypto.createHash('sha256').update(content).digest('hex'); }
function attachFileOperations(ctx) {
  function list(scope, requested) {
    var dir = resolve(ctx.cwd, requested || '.', scope);
    var items = scope.identity ? ctx.fsAsUser('list', { dir: dir }, scope.identity) : fs.readdirSync(dir, { withFileTypes: true }).map(function (item) { return { name: item.name, isDir: item.isDirectory() }; });
    return items.filter(function (item) { return !item.isDir || !ctx.IGNORED_DIRS.has(item.name); }).map(function (item) { return { name: item.name, type: item.isDir ? 'dir' : 'file', path: path.relative(ctx.cwd, path.join(dir, item.name)).split(path.sep).join('/') }; });
  }
  function read(scope, requested) {
    var file = resolve(ctx.cwd, requested, scope), identity = scope.identity;
    var stat = identity ? ctx.fsAsUser('stat', { file: file }, identity) : fs.statSync(file);
    if (stat.size > ctx.FS_MAX_SIZE) return { binary: true, size: stat.size, error: 'File too large (' + (stat.size / 1024 / 1024).toFixed(1) + ' MB)' };
    var ext = path.extname(file).toLowerCase();
    if (ctx.BINARY_EXTS.has(ext)) {
      var binary = { binary: true, size: stat.size };
      if (ctx.IMAGE_EXTS.has(ext)) binary.imageUrl = 'api/file?path=' + encodeURIComponent(requested);
      return binary;
    }
    return { content: identity ? ctx.fsAsUser('read', { file: file, readContent: true }, identity).content : fs.readFileSync(file, 'utf8'), size: stat.size };
  }
  function snapshot(scope, requested) {
    var file = resolve(ctx.cwd, requested, scope), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) throw new Error('Select a regular, singly linked text file of at most 64 KB.');
    var result = read(scope, requested);
    if (result.binary || typeof result.content !== 'string' || result.content.indexOf('\0') >= 0) throw new Error('Binary files are unavailable for canonical editing.');
    return { dev: stat.dev, ino: stat.ino, mode: stat.mode, uid: stat.uid, gid: stat.gid, size: stat.size, mtime: stat.mtimeMs, hash: hash(result.content) };
  }
  function write(scope, requested, content, control) {
    var file = resolve(ctx.cwd, requested, scope), attempted = false;
    if (!control) {
      if (scope.identity) ctx.fsAsUser('write', { file: file, content: content }, scope.identity);
      else fs.writeFileSync(file, content, 'utf8');
      return { ok: true };
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('Canonical editing requires no-follow file descriptors on this platform.');
    control.revalidate();
    if (JSON.stringify(snapshot(scope, requested)) !== JSON.stringify(control.expected)) throw new Error('The exact file revision changed.');
    try {
      attempted = true;
      if (scope.identity) ctx.fsAsUser('write_exact', { file: file, content: content, expected: control.expected, root: fs.realpathSync(ctx.cwd) }, scope.identity);
      else {
        var fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
        try {
          var stat = fs.fstatSync(fd), expected = control.expected;
          if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== expected.dev || stat.ino !== expected.ino || stat.mode !== expected.mode || stat.uid !== expected.uid || stat.gid !== expected.gid || stat.size !== expected.size || stat.mtimeMs !== expected.mtime || hash(fs.readFileSync(fd, 'utf8')) !== expected.hash) throw new Error('The open file revision changed.');
          control.revalidate();
          fs.ftruncateSync(fd, 0);
          var bytes = Buffer.from(content, 'utf8'), offset = 0;
          while (offset < bytes.length) { var written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset); if (!written) throw new Error('File write made no progress.'); offset += written; }
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
      }
      control.revalidate();
      return { status: 'completed', persisted: true, path: requested };
    } catch (error) { error.productControlResult = { persisted: attempted ? 'unknown' : false, retrySafe: false, error: error.message }; throw error; }
  }
  return { list: list, read: read, write: write, snapshot: snapshot };
}
module.exports = { attachFileOperations: attachFileOperations };
