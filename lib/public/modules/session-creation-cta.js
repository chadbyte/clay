// Shared, presentation-only session creation controls for desktop and mobile.

import { iconHtml } from './icons.js';

export function renderSessionCreationCta(options) {
  var row = document.createElement("div");
  row.className = options.rowClass + " session-create-cta";

  var createButton = document.createElement("button");
  createButton.className = options.createClass + " session-create-primary";
  createButton.type = "button";
  createButton.innerHTML = iconHtml("plus", "session-create-primary-icon") + '<span>Create session</span>';
  createButton.title = options.createTitle;
  createButton.setAttribute("aria-label", options.createTitle);
  createButton.addEventListener("click", options.onCreate);
  row.appendChild(createButton);

  var providerButton = document.createElement("button");
  providerButton.className = options.providerClass + " session-create-provider";
  providerButton.type = "button";
  providerButton.title = options.providerTitle;
  providerButton.setAttribute("aria-label", "AI provider: " + options.vendorName + ". " + options.providerTitle);
  providerButton.setAttribute("aria-expanded", "false");
  providerButton.setAttribute("aria-controls", options.menuId);
  providerButton.innerHTML = '<img src="' + options.vendorAvatar +
    '" class="' + options.iconClass + ' session-create-provider-icon" alt="">';
  providerButton.addEventListener("click", options.onProvider);
  row.appendChild(providerButton);

  return { element: row, createButton: createButton, providerButton: providerButton };
}
