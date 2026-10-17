function create(ctx) {
  var state = ctx.state, assertLive = ctx.assertLive, selectModel = ctx.selectModel, validateEffort = ctx.validateEffort;
  return {
    setModel: async function(model) {
      assertLive();
      if (typeof model !== "string" || !model) throw new Error("Muse model selection requires a model id");
      if (!state.session) {
        state.model = model;
        return;
      }
      var selection = await selectModel(model);
      await ctx.runtime().waitRequest(state.connection.command("session/setModel", {
        sessionId: state.sessionId,
        model: selection
      }));
      state.model = model;
    },
    setEffort: async function(effort) {
      assertLive();
      if (state.session && !effort && state.effort) throw new Error("Muse cannot reset session effort without an explicit supported level");
      if (effort) validateEffort(effort);
      if (state.session && effort) await ctx.runtime().waitRequest(state.connection.command("session/setReasoningEffort", {
        sessionId: state.sessionId,
        reasoningEffort: effort
      }));
      assertLive();
      state.effort = effort || null;
    },
    listTasks: async function() {
      assertLive();
      if (!state.session) throw new Error("Muse tasks require an opened session");
      return ctx.runtime().waitRequest(state.connection.request("task/list", { sessionId: state.sessionId }));
    },
    compact: async function() {
      assertLive();
      if (!state.session) throw new Error("Muse compaction requires an opened session");
      return ctx.runtime().waitRequest(state.connection.command("session/compact", { sessionId: state.sessionId }));
    },
    listSkills: function() { return ctx.skills.listNative(); },
    invokeSkill: async function(selector, args) {
      assertLive();
      var catalog = await ctx.handle.listSkills();
      assertLive();
      if (!(catalog.skills || []).some(function(skill) { return skill.selector === selector; })) throw new Error("Muse skill is not in the live session catalog");
      return ctx.handle.pushMessage("", [], { selector: selector, arguments: String(args || "") });
    },
    rollback: function() { return Promise.reject(new Error("Muse SDK 1.4.7 has no rollback method")); },
  };
}
module.exports = { create: create };
