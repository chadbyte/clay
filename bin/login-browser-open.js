#!/usr/bin/env node
// Capture the CLI's exact OAuth URL without opening a browser on the host desktop.
var fs = require("fs");
var file = process.env.CLAY_LOGIN_URL_FILE;
var url = process.argv[2];
if (!file || !url || url.length > 16384) process.exit(1);
fs.writeFileSync(file, url, { mode: 0o600 });
