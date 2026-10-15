var fs = require("fs"), path = require("path");
function cleanupSdkWarmupSessions(REAL_HOME) {
  var sessionHygiene = require("./claude-transcript-hygiene");
  var projectsRoot = path.join(REAL_HOME, ".claude", "projects");
  var projectDirs;
  try { projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true }); }
  catch (e) { return; }

  var deleted = 0;
  var nowMs = Date.now();
  var MAX_BYTES = 64 * 1024;
  var MIN_AGE_MS = 60 * 1000;

  for (var di = 0; di < projectDirs.length; di++) {
    if (!projectDirs[di].isDirectory()) continue;
    var projDir = path.join(projectsRoot, projectDirs[di].name);
    var files;
    try { files = fs.readdirSync(projDir); } catch (e) { continue; }

    for (var fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      if (!f.endsWith(".jsonl")) continue;
      var fp = path.join(projDir, f);

      var st;
      try { st = fs.statSync(fp); } catch (e) { continue; }
      if (st.size >= MAX_BYTES) continue;
      if (nowMs - st.mtimeMs < MIN_AGE_MS) continue;

      var raw;
      try { raw = fs.readFileSync(fp, "utf8"); } catch (e) { continue; }
      var lines = raw.split("\n");
      var events = [];
      var parseOk = true;
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        if (!line) continue;
        var ev;
        try { ev = JSON.parse(line); } catch (e) { parseOk = false; break; }
        if (!ev || typeof ev !== "object") continue;
        events.push(ev);
      }
      if (!parseOk) continue;
      if (!sessionHygiene.isClaudeWarmupTranscript(events)) continue;

      try { fs.unlinkSync(fp); deleted++; } catch (e) {}
    }
  }

  if (deleted > 0) {
    console.log("[daemon] Removed " + deleted + " stale SDK warmup session file(s)");
  }
}

module.exports = { cleanup: cleanupSdkWarmupSessions };
