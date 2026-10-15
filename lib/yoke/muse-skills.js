var discovery = require("./skill-discovery");
function create(queryOpts, getRuntime, push, assertLive) {
  var options = queryOpts.skillOptions;
  var delivered = false;
  var lastCatalog = "";
  var lastIndex = "";
  function available() {
    assertLive();
    var readOnly = queryOpts.adapterOptions && queryOpts.adapterOptions.MUSE && queryOpts.adapterOptions.MUSE.readOnly;
    var allowed = !queryOpts.skipSkills && !readOnly && options && !options.disable && typeof options.isAvailable === "function" && options.isAvailable() === true;
    if (!allowed && delivered) throw new Error("The skill query scope is no longer available");
    return !!allowed;
  }
  function check() {
    if (!available()) throw new Error("Skills require an authorized Clay query scope");
  }
  async function listNative() {
    check();
    var runtime = getRuntime();
    if (!runtime || !runtime.session) throw new Error("Muse skills require an opened session");
    var result = await runtime.waitRequest(runtime.connection.request("skill/list", { sessionId: runtime.session.sessionId }));
    check();
    if (!result || !Array.isArray(result.skills)) throw new Error("Muse returned an invalid native skill catalog");
    return { skills: result.skills.filter(function(skill) {
      // Clay-only names are delivered from private roots, never native installs.
      return skill && typeof skill.selector === "string" && !/(?:^|:)clay-/.test(skill.selector);
    }) };
  }
  function scopedOptions() {
    var fs = require("fs");
    return Object.assign({}, options, {
      readDir: function(dir) { check(); return options.readDir ? options.readDir(dir) : fs.readdirSync(dir, { withFileTypes: true }); },
      readFile: function(file) { check(); var content = options.readFile ? options.readFile(file) : fs.readFileSync(file, "utf8"); check(); return content; },
      realpath: function(file) { check(); return options.realpath ? options.realpath(file) : fs.realpathSync(file); },
    });
  }
  async function prepare(text, selected) {
    if (!available()) {
      if (selected) throw new Error("Skills require an authorized Clay query scope");
      return { text: text, skill: null, scoped: false };
    }
    var native = await listNative();
    var readOpts = scopedOptions();
    var shared = discovery.discoverSkills(queryOpts.cwd, readOpts).filter(function(skill) {
      return !/^clay-/.test(skill.name) || /^clay-/.test(skill.source);
    });
    check();
    var slash = typeof text === "string" && /^\/([^\s/]+)(?:[ \t]([\s\S]*))?$/.exec(text);
    var explicit = selected;
    var referenceText = text;
    if (slash) {
      if (native.skills.some(function(skill) { return skill.selector === slash[1]; })) {
        explicit = { selector: slash[1], arguments: slash[2] || "" };
        text = "";
      } else if (shared.some(function(skill) { return skill.name === slash[1]; })) {
        referenceText = "$" + slash[1] + (slash[2] ? " " + slash[2] : "");
        text = referenceText;
      } else throw new Error("Skill is not in the current Muse or shared catalog: " + slash[1]);
    }
    if (explicit && !native.skills.some(function(skill) { return skill.selector === explicit.selector; })) throw new Error("Muse skill is not in the live session catalog");
    var index = discovery.buildSkillIndex(shared);
    var content = discovery.readReferencedSkills(referenceText, shared, 32768, readOpts);
    if (discovery.findSkillReferences(referenceText, shared).length && !content) throw new Error("Shared skill instructions are unavailable");
    check();
    var commands = native.skills.map(function(skill) { return skill.selector; });
    var names = shared.map(function(skill) { return skill.name; });
    var catalog = JSON.stringify([commands, names]);
    if (catalog !== lastCatalog) {
      push({ yokeType: "commands_changed", commandNames: commands, skills: names });
      lastCatalog = catalog;
    }
    var guidance = index && index !== lastIndex ? index + "\nNative /selector commands invoke Muse skills; $name references load shared instructions. If names collide, /name is native and $name is shared." : "";
    lastIndex = index;
    delivered = true;
    return { text: [text, guidance, content].filter(Boolean).join("\n\n"), skill: explicit || null, scoped: true };
  }
  return { prepare: prepare, listNative: listNative, check: check };
}
module.exports = { create: create };
