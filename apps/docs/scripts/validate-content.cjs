var path = require("node:path");
var content = require("../lib/content.cjs");
var catalog = require("../lib/catalog.cjs");
var validation = require("../lib/content-validation.cjs");

async function main() {
  var documents = await content.getDocuments();
  validation.validateRenderedDocuments(documents, catalog, path.join(__dirname, "../content"), path.join(__dirname, "../public"));
  process.stdout.write("Validated " + documents.length + " rendered documentation pages.\n");
}

main().catch(function (error) { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
