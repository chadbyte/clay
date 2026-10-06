var MAX_SOURCE_BYTES = 100000;
var MAX_SVG_BYTES = 8 * 1024 * 1024;

function failure(message, status) {
  var error = new Error(message);
  error.status = status || 422;
  return error;
}

function isPlantUmlFile(file) {
  return /\.(puml|plantuml|pu|uml|salt)$/i.test(String(file || ""));
}

function prepareSource(source, file) {
  source = String(source || "").replace(/^\uFEFF/, "");
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw failure("Diagram is too large to preview (100 KB maximum).", 413);
  if (!source.trim()) throw failure("This diagram is empty.");
  if (/\.salt$/i.test(file) && !/@start\w+/i.test(source)) source = "@startsalt\n" + source + "\n@endsalt";
  if (!/^\s*@start\w+\b/im.test(source)) throw failure("Add @startsalt / @endsalt or @startuml / @enduml around the diagram.");
  if ((source.match(/^\s*@start\w+\b/gim) || []).length > 1) throw failure("Preview supports one diagram per file. Split these diagrams into separate files.");
  return source;
}

function renderPlantUml(source, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    setImmediate(async function () {
      try {
        if (options.signal && options.signal.aborted) throw failure("Diagram rendering cancelled.", 499);
        source = prepareSource(source, "diagram.puml");
        var tree = require("./salt-parser").parseSalt(source);
        await require('./salt-images').resolveImages(tree, options);
        if (options.signal && options.signal.aborted) throw failure("Diagram rendering cancelled.", 499);
        var svg = require("./salt-svg").renderSaltSvg(tree);
        if (Buffer.byteLength(svg) > MAX_SVG_BYTES) throw failure("Rendered wireframe is too large.", 413);
        resolve(svg);
      } catch (error) { reject(error); }
    });
  });
}

module.exports = { renderPlantUml: renderPlantUml, prepareSource: prepareSource,
  isPlantUmlFile: isPlantUmlFile, MAX_SOURCE_BYTES: MAX_SOURCE_BYTES };
