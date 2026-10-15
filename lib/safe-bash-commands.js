// safe-bash-commands.js
//
// Single source of truth for the Bash commands Clay auto-approves without
// prompting. BOTH auto-approval paths derive from here so they can never
// drift apart again:
//   - sdk-bridge.js `checkToolWhitelist`  -> SDK / GUI sessions (uses
//     isSafeBashSegment on each operator-split segment).
//   - claude-hook-installer.js `CLAY_MANAGED_ALLOW` -> TUI sessions, via the
//     `Bash(...)` patterns buildClayBashAllowPatterns() emits into
//     ~/.claude/settings.json `permissions.allow`.
//
// Policy:
//   - STANDALONE: read-only / inspection / navigation / text commands that
//     stay safe regardless of arguments. Auto-approved as a whole word.
//   - SUBCOMMAND: binaries that are NOT blanket-safe (git, npm, ...) but
//     whose listed read-only subcommands are. Write subcommands (git push,
//     npm install, ...) are intentionally absent so they still prompt.
//   - EXACT: full command strings safe verbatim (version probes). Language
//     runtimes (node, python, ruby, go, ...) live here as `--version` only:
//     `node script.js` executes arbitrary code, so it is NOT auto-approved.
//
// Safety note: a few STANDALONE entries (env, command, xargs, time, tee,
// find, sed, awk) can execute or write given hostile arguments
// (`env rm -rf /`, `find . -exec ...`, `tee /etc/x`). They are kept to match
// Clay's long-standing read-only-convenience posture; this is the one place
// to tighten if that tradeoff ever changes.

var STANDALONE = [
  // Navigation
  "cd", "pushd", "popd",
  // File / dir inspection
  "ls", "cat", "head", "tail", "wc", "file", "stat", "find", "tree", "du", "df",
  "readlink", "realpath", "basename", "dirname",
  // Search
  "grep", "rg", "ag", "ack", "fgrep", "egrep",
  // Lookup
  "which", "type", "whereis", "command", "hash",
  // Environment / system info
  "echo", "printf", "env", "printenv", "pwd", "whoami", "id", "groups",
  "date", "uname", "hostname", "uptime", "arch", "nproc", "free",
  "lsb_release", "sw_vers", "locale", "timedatectl",
  // Text processing (stdin / stdout)
  "jq", "yq", "sort", "uniq", "cut", "tr", "awk", "sed", "paste", "column",
  "fold", "rev", "tac", "nl", "expand", "unexpand", "fmt", "pr", "csplit",
  "comm", "join",
  // Comparison / hashing
  "diff", "cmp", "md5sum", "sha256sum", "sha1sum", "shasum", "cksum", "sum",
  "b2sum", "base64", "xxd", "od", "hexdump",
  // Misc read-only
  "test", "true", "false", "seq", "yes", "sleep", "tee", "xargs", "time",
  "man", "help", "info", "apropos", "cal", "bc", "expr", "factor",
  // ACL / attribute inspection
  "getfacl", "getfattr", "namei",
  // Process / network introspection
  "lsof", "ps", "top", "htop", "pgrep", "netstat", "ss", "ifconfig", "ip",
  "dig", "nslookup", "host", "ping", "traceroute", "curl", "wget", "http",
];

// binary -> read-only subcommands. Each generates `Bash(bin sub)` and
// `Bash(bin sub *)`. Multi-word keys (e.g. "config --get") are supported.
var SUBCOMMAND = {
  git: [
    "status", "log", "diff", "show", "branch", "tag", "remote",
    "rev-parse", "ls-files", "blame", "describe", "config --get",
  ],
  npm: ["list", "ls", "view", "outdated", "config get"],
  yarn: ["list"],
  pnpm: ["list"],
};

// Full command strings safe verbatim. `*`-suffixed args are allowed after
// them (e.g. `node --version` plus any trailing flags) but the prefix must
// match exactly so `node server.js` does not slip through.
var EXACT = [
  "node --version", "npm --version", "python --version",
  "python3 --version", "go version", "ruby --version",
];

var STANDALONE_SET = {};
for (var i = 0; i < STANDALONE.length; i++) STANDALONE_SET[STANDALONE[i]] = true;

// Strip leading env assignments (FOO=bar cmd) and an optional sudo prefix so
// the real command word is what we test. Returns the cleaned segment.
function stripLeadingNoise(seg) {
  var out = seg.replace(/^(?:\w+=\S*\s+)*/, "");
  if (/^sudo(?:\s|$)/.test(out)) {
    out = out.replace(/^sudo\s+(?:-\S+\s+)*/, "");
  }
  return out;
}

// True if a single shell segment (already split on &&, ||, ;, |) is safe to
// auto-approve. Empty segments (trailing operators) are treated as safe.
function isSafeBashSegment(seg) {
  seg = (seg || "").trim();
  if (!seg) return true;
  var cleaned = stripLeadingNoise(seg);
  var firstWord = cleaned.split(/\s+/)[0];
  if (!firstWord) return false;
  if (STANDALONE_SET[firstWord]) return true;
  if (SUBCOMMAND[firstWord]) {
    var subs = SUBCOMMAND[firstWord];
    for (var i = 0; i < subs.length; i++) {
      var prefix = firstWord + " " + subs[i];
      if (cleaned === prefix || cleaned.indexOf(prefix + " ") === 0) return true;
    }
    return false;
  }
  for (var j = 0; j < EXACT.length; j++) {
    if (cleaned === EXACT[j] || cleaned.indexOf(EXACT[j] + " ") === 0) return true;
  }
  return false;
}

// Emit the `Bash(...)` permission patterns for ~/.claude/settings.json. Each
// standalone command gets a bare form (zero-arg) and a space-wildcard form
// (claude 2.x prefix matching); subcommands and exact commands likewise.
var patternCodec = require("./yoke/claude-permission-patterns").attachPatterns({ STANDALONE: STANDALONE, SUBCOMMAND: SUBCOMMAND, EXACT: EXACT });
function buildClayBashAllowPatterns() { return patternCodec.build(); }
function isClayManagedBashPattern(pattern) { return patternCodec.isManaged(pattern); }

module.exports = {
  STANDALONE: STANDALONE,
  SUBCOMMAND: SUBCOMMAND,
  EXACT: EXACT,
  isSafeBashSegment: isSafeBashSegment,
  buildClayBashAllowPatterns: buildClayBashAllowPatterns,
  isClayManagedBashPattern: isClayManagedBashPattern,
};
