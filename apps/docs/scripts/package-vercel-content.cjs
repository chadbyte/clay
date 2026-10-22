var fs = require("node:fs");
var path = require("node:path");

if (process.env.NITRO_PRESET === "vercel") {
  var root = path.resolve(__dirname, "..");
  var output = path.join(root, ".vercel/output");
  var server = path.join(output, "functions/__server.func");
  // Fail if an adapter update changes the output contract.
  JSON.parse(fs.readFileSync(path.join(output, "config.json"), "utf8"));
  JSON.parse(fs.readFileSync(path.join(server, ".vc-config.json"), "utf8"));
  fs.cpSync(path.join(root, "content"), path.join(server, "content"), { recursive: true });
}
