var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var { attachFilesystem } = require("../lib/project-filesystem");

test("file browser reads text files larger than the live preview limit", function () {
  var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-large-file-"));
  var filePath = path.join(tempDir, "large.txt");
  var content = "x".repeat(768 * 1024);
  var response = null;
  fs.writeFileSync(filePath, content);

  try {
    var filesystem = attachFilesystem({
      cwd: tempDir,
      slug: "test",
      osUsers: null,
      sm: { sessions: new Map() },
      send: function () {},
      sendTo: function (ws, msg) { response = msg; },
      safePath: function (cwd, requestedPath) {
        return requestedPath === "large.txt" ? filePath : null;
      },
      safeAbsPath: function () { return null; },
      getOsUserInfoForWs: function () { return null; },
      startFileWatch: function () {},
      stopFileWatch: function () {},
      startDirWatch: function () {},
      usersModule: { getEffectivePermissions: function () { return { fileBrowser: true }; } },
      fsAsUser: function () {},
      validateEnvString: function () {},
      opts: {},
      IGNORED_DIRS: new Set(),
      BINARY_EXTS: new Set(),
      IMAGE_EXTS: new Set(),
      FS_MAX_SIZE: 5 * 1024 * 1024,
    });

    filesystem.handleFilesystemMessage({}, { type: "fs_read", path: "large.txt" });

    assert.equal(response.type, "fs_read_result");
    assert.equal(response.error, undefined);
    assert.equal(response.size, content.length);
    assert.equal(response.content, content);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("large file previews use a separate hard limit and lightweight rendering", function () {
  var projectSource = fs.readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  var browserSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");

  assert.match(projectSource, /var FS_MAX_SIZE = 512 \* 1024;/);
  assert.match(projectSource, /var FS_VIEWER_MAX_SIZE = 5 \* 1024 \* 1024;/);
  assert.match(projectSource, /FS_MAX_SIZE: FS_VIEWER_MAX_SIZE/);
  assert.match(browserSource, /var FILE_RICH_PREVIEW_MAX_BYTES = 1024 \* 1024;/);
  assert.match(browserSource, /renderLargeTextFile\(bodyEl, msg\.content, msg\.size\)/);
  assert.match(fs.readFileSync(path.join(__dirname, "../lib/public/modules/file-viewer-source.js"), "utf8"), /showing plain text for performance/);
});
