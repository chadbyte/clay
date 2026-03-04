#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")

echo "=== Dual publish v$VERSION ==="
echo ""

# 1) Publish clay-server (primary package)
echo "[1/2] Publishing clay-server@$VERSION ..."
npm publish
echo "  ✓ clay-server@$VERSION"
echo ""

# 2) Publish claude-relay (thin alias → installs clay-server)
echo "[2/2] Publishing claude-relay@$VERSION ..."
ALIAS_DIR=$(mktemp -d)
cat > "$ALIAS_DIR/package.json" <<PJSON
{
  "name": "claude-relay",
  "version": "$VERSION",
  "description": "Alias for clay-server — Web UI for Claude Code.",
  "bin": { "claude-relay": "./bin/cli.js" },
  "dependencies": { "clay-server": "$VERSION" },
  "keywords": ["claude","claude-code","cli","mobile","remote","relay","web-ui","tailscale"],
  "repository": { "type": "git", "url": "git+https://github.com/chadbyte/claude-relay.git" },
  "homepage": "https://github.com/chadbyte/claude-relay#readme",
  "author": "Chad",
  "license": "MIT"
}
PJSON
mkdir -p "$ALIAS_DIR/bin"
cat > "$ALIAS_DIR/bin/cli.js" <<'SHIM'
#!/usr/bin/env node
require("clay-server/bin/cli.js");
SHIM
chmod +x "$ALIAS_DIR/bin/cli.js"
(cd "$ALIAS_DIR" && npm publish)
rm -rf "$ALIAS_DIR"
echo "  ✓ claude-relay@$VERSION → clay-server@$VERSION"

echo ""
echo "=== Done: clay-server@$VERSION + claude-relay@$VERSION ==="
