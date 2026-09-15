var MODEL_ALIASES = ["fast", "standard", "deep"];

function validateArgs(args) {
  args = args || {};
  if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("LLM prompt is required.");
  if (args.system !== undefined && typeof args.system !== "string") throw new Error("LLM system prompt must be a string.");
  var alias = args.model || "fast";
  if (MODEL_ALIASES.indexOf(alias) === -1) {
    throw new Error("LLM model must be a capability alias: fast, standard, or deep. Vendor model names are not allowed.");
  }
  return { system: args.system || "", prompt: args.prompt, model: alias };
}

async function complete(opts) {
  var args = validateArgs(opts.args);
  var adapters = opts.adapters || {};
  var selection = opts.selection || {};
  var vendor = selection.vendor;
  var model = selection.model;
  if (!vendor || !model || typeof model !== "string") {
    throw new Error(selection.error || "No configured model is available. Configure a provider and retry.");
  }
  var adapter = adapters[vendor];
  if (!adapter) throw new Error("The configured " + vendor + " model provider is unavailable.");
  var yoke = require("./yoke");
  var result = await yoke.completeOnce(adapter, {
    cwd: opts.cwd,
    model: model,
    systemPrompt: args.system || undefined,
    prompt: args.prompt,
    timeoutMs: opts.timeoutMs || 60000,
    query: {
      cwd: opts.cwd,
      linuxUser: opts.linuxUser || undefined,
      effort: selection.effort || undefined,
      skipProjectInstructions: true,
      skipSkills: true,
      canUseTool: function () { return Promise.resolve({ behavior: "deny", message: "Capsule LLM calls cannot use tools." }); },
      adapterOptions: { CLAUDE: { linuxUser: opts.linuxUser || undefined, settingSources: ["user"] } },
    },
  });
  return result.text;
}

module.exports = {
  MODEL_ALIASES: MODEL_ALIASES,
  validateArgs: validateArgs,
  complete: complete,
};
