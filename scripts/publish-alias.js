#!/usr/bin/env node

var fs = require("fs")
var path = require("path")
var os = require("os")
var { execSync } = require("child_process")

var version = process.argv[2]
if (!version) {
  console.error("Usage: node publish-alias.js <version>")
  process.exit(1)
}

var aliasDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-relay-"))

var pkg = {
  name: "claude-relay",
  version: version,
  description: "Alias for clay-server — Web UI for Claude Code.",
  bin: { "claude-relay": "./bin/cli.js" },
  dependencies: { "clay-server": version },
  keywords: ["claude", "claude-code", "cli", "mobile", "remote", "relay", "web-ui", "tailscale"],
  repository: { type: "git", url: "git+https://github.com/chadbyte/claude-relay.git" },
  homepage: "https://github.com/chadbyte/claude-relay#readme",
  author: "Chad",
  license: "MIT"
}

fs.writeFileSync(path.join(aliasDir, "package.json"), JSON.stringify(pkg, null, 2))

var binDir = path.join(aliasDir, "bin")
fs.mkdirSync(binDir, { recursive: true })
fs.writeFileSync(path.join(binDir, "cli.js"), '#!/usr/bin/env node\nrequire("clay-server/bin/cli.js");\n')
fs.chmodSync(path.join(binDir, "cli.js"), "755")

var readmeSrc = path.join(__dirname, "..", "README.md")
if (fs.existsSync(readmeSrc)) {
  fs.copyFileSync(readmeSrc, path.join(aliasDir, "README.md"))
}

var tag = version.includes("-") ? version.split("-")[1].split(".")[0] : "latest"

console.log("[alias] Publishing claude-relay@" + version + " (tag: " + tag + ") ...")
execSync("npm publish --tag " + tag, { cwd: aliasDir, stdio: "inherit" })
console.log("[alias] ✓ claude-relay@" + version + " → clay-server@" + version)

fs.rmSync(aliasDir, { recursive: true, force: true })
