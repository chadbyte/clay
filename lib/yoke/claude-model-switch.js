function attach(options, notify) {
  if (typeof notify !== "function") return;
  var hooks = Object.assign({}, options.hooks || {});
  hooks.PostModelSwitch = (hooks.PostModelSwitch || []).concat([{
    hooks: [async function(input) {
      if (input.from_model && input.to_model && input.from_model !== input.to_model) {
        notify({ fromModel: input.from_model, toModel: input.to_model, source: input.source || "unknown" });
      }
      return {};
    }],
  }]);
  options.hooks = hooks;
}

module.exports = { attach: attach };
