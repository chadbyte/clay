// Shared, presentation-only session creation controls for desktop and mobile.

import { iconHtml } from './icons.js';

var SESSION_VENDOR_LABELS = {
  claude: "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  kimi: "Kimi",
  grok: "Grok",
  copilot: "Copilot",
  qwen: "Qwen",
  junie: "Junie",
  kiro: "Kiro",
};

export function renderSessionCreationCta(options) {
  var row = document.createElement("div");
  row.className = options.rowClass + " session-create-cta";

  var createButton = document.createElement("button");
  createButton.className = options.createClass + " session-create-primary";
  createButton.type = "button";
  var vendorLabel = SESSION_VENDOR_LABELS[options.vendorKey] || options.vendorName;
  createButton.innerHTML = '<img src="' + options.vendorAvatar +
    '" class="' + options.iconClass + ' session-create-provider-icon" alt="">' +
    '<span>Create new ' + vendorLabel + ' session</span>';
  createButton.title = options.createTitle;
  createButton.setAttribute("aria-label", options.createTitle);
  createButton.addEventListener("click", options.onCreate);
  row.appendChild(createButton);

  var providerButton = document.createElement("button");
  providerButton.className = options.providerClass + " session-create-provider";
  providerButton.type = "button";
  providerButton.title = options.providerTitle;
  providerButton.setAttribute("aria-label", "Switch AI provider (current: " + options.vendorName + ")");
  providerButton.setAttribute("aria-expanded", "false");
  providerButton.setAttribute("aria-controls", options.menuId);
  providerButton.innerHTML = iconHtml("chevron-down", "session-create-provider-chevron");
  providerButton.addEventListener("click", options.onProvider);
  row.appendChild(providerButton);

  return { element: row, createButton: createButton, providerButton: providerButton };
}
