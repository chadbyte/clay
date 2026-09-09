// Read the Worker's own session metadata, never the active Driver's settings.
export function workerRuntimeLabels(session) {
  var model = session && typeof session.model === "string" ? session.model : "";
  var effort = session && typeof session.effort === "string" ? session.effort : "";
  var level = effort === "xhigh" ? "X-High" : (effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : "Default");
  return { model: model || "Default model", thinking: "Thinking: " + level };
}

export function appendWorkerRuntime(header, session) {
  var labels = workerRuntimeLabels(session);
  var runtime = document.createElement("div");
  runtime.className = "split-worker-runtime";
  var model = document.createElement("span");
  model.className = "split-worker-runtime-model";
  model.textContent = labels.model;
  model.title = "Model: " + labels.model;
  var thinking = document.createElement("span");
  thinking.className = "split-worker-runtime-thinking";
  thinking.textContent = labels.thinking;
  runtime.appendChild(model);
  runtime.appendChild(thinking);
  header.classList.add("has-worker-runtime");
  header.appendChild(runtime);
}
