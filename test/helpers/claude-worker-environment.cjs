var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var EventEmitter = require("node:events");
var createRequire = require("node:module").createRequire;

// Run the real mapped-worker option assembly against the installed SDK, with
// only the subprocess transport replaced. No OS account or provider is used.
async function capture(sdk, options, workerEnv, root) {
  var filename = path.resolve(__dirname, "../../lib/yoke/adapters/claude-worker.js");
  var localRequire = createRequire(filename);
  var socket = new EventEmitter();
  var messages = [];
  var spawned;
  socket.write = function(line) { messages.push(JSON.parse(line)); };
  var context = vm.createContext({
    require: function(name) {
      if (name === "net") return { connect: function() { return socket; } };
      if (name === "fs") return { writeSync: function() {}, existsSync: function() { return false; } };
      if (name === "child_process") return {
        execSync: function() { throw new Error("No provider discovery in fixture"); },
        spawn: function(command, args, spawnOptions) {
          spawned = spawnOptions;
          throw new Error("FIXTURE_WORKER_SPAWN_BOUNDARY");
        },
      };
      return localRequire(name);
    },
    __dirname: path.dirname(filename),
    process: { env: workerEnv, argv: ["node", filename, path.join(root, "fixture.sock")], pid: 1, on: function() {} },
    console: { log: function() {}, error: function() {} },
    AbortController: AbortController,
    setInterval: function() {}, clearInterval: function() {}, setTimeout: setTimeout,
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename: filename });
  context.sdkModule = Promise.resolve(sdk);
  await context.handleQueryStart({ options: options, singleTurn: true, prompt: "No provider request" });
  if (!messages.some(function(message) { return message.type === "query_error" && /FIXTURE_WORKER_SPAWN_BOUNDARY/.test(message.error); })) {
    throw new Error("Worker did not reach the trapped SDK subprocess boundary");
  }
  if (!spawned) throw new Error("Worker spawned no captured SDK subprocess");
  return spawned;
}
module.exports = { capture: capture };
