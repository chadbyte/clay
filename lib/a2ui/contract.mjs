// Validate bounded, inert response data before the official schema resolver runs.
export var catalogId = 'https://clay.studio/a2ui/exploration/v1';
export var componentNames = ['Text', 'Row', 'Column', 'List', 'Card', 'Tabs', 'Divider', 'ChoicePicker', 'Slider', 'CheckBox', 'TextField'];
export var functionNames = ['lookup', 'choose', 'calculate', 'join', 'number'];
var dangerous = ['__proto__', 'prototype', 'constructor'];
function fail(message) { throw new Error(message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function validateResponse(source) {
  if (typeof source !== 'string' || source.length > 100000) fail('Exploration is too large.');
  var doc = JSON.parse(source);
  var nodes = 0;
  function walk(value, depth) {
    if (++nodes > 10000 || depth > 24) fail('Exploration is too complex.');
    if (typeof value === 'string' && value.length > 16000) fail('Text is too long.');
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value) && value.length > 200) fail('Too many entries.');
    Object.keys(value).forEach(function (key) {
      if (dangerous.indexOf(key) !== -1) fail('Unsupported data key.');
      walk(value[key], depth + 1);
    });
  }
  walk(doc, 0);
  if (!object(doc) || typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > 120 ||
      typeof doc.summary !== 'string' || !doc.summary.trim() || doc.summary.length > 2000) fail('A title and readable summary are required.');
  if (Object.keys(doc).some(function (key) { return ['title', 'summary', 'messages'].indexOf(key) === -1; })) fail('Unsupported response field.');
  if (!Array.isArray(doc.messages) || doc.messages.length !== 1) fail('Provide one complete surface.');
  var message = doc.messages[0];
  if (!object(message) || message.version !== '1.0' || Object.keys(message).length !== 2 || !object(message.createSurface)) fail('Use A2UI 1.0 createSurface.');
  var surface = message.createSurface;
  if (surface.catalogId !== catalogId || !/^[a-zA-Z0-9_-]{1,80}$/.test(surface.surfaceId || '')) fail('Unsupported catalog or surface ID.');
  if (Object.keys(surface).some(function (key) { return ['surfaceId', 'catalogId', 'components', 'dataModel'].indexOf(key) === -1; })) fail('Unsupported surface field.');
  if (!object(surface.dataModel) || !Array.isArray(surface.components) || !surface.components.length || surface.components.length > 100) fail('Provide data and 1–100 components.');
  var ids = Object.create(null);
  function expressions(value, depth) {
    if (depth > 20) fail('Expressions are too deeply nested.');
    if (!value || typeof value !== 'object') return;
    if (value.catalogId !== undefined && value.catalogId !== catalogId) fail('External catalogs are unavailable.');
    if (value['@call'] !== undefined && functionNames.indexOf(value['@call']) === -1) fail('Unknown function.');
    if (value['@path'] !== undefined) {
      var path = value['@path'];
      if (typeof path !== 'string' || path.length > 200 || !/^\/(?:[\w-]+(?:\/[\w-]+)*)?$/.test(path) ||
          path.split('/').some(function (part) { return dangerous.indexOf(part) !== -1; })) fail('Unsupported data path.');
    }
    Object.keys(value).forEach(function (key) {
      if (key[0] === '@' && ['@path', '@call'].indexOf(key) === -1) fail('Unsupported expression.');
      expressions(value[key], depth + 1);
    });
  }
  surface.components.forEach(function (component) {
    if (!object(component) || !/^[a-zA-Z0-9_-]{1,80}$/.test(component.id || '') || ids[component.id]) fail('Component IDs must be unique.');
    if (componentNames.indexOf(component.component) === -1) fail('Unknown component.');
    expressions(component, 0);
    ids[component.id] = component;
    if (component.children !== undefined && !Array.isArray(component.children)) fail('Use fixed child IDs; templates are unavailable.');
    if (component.component === 'Slider' && (typeof component.min !== 'number' || typeof component.max !== 'number' || !Number.isFinite(component.max - component.min) || component.max <= component.min)) fail('Sliders need finite increasing bounds.');
  });
  var seen = new Set();
  function visit(id, depth) {
    if (typeof id !== 'string' || !ids[id]) fail('Missing child component.');
    if (seen.has(id) || depth > 12) fail('Components must form a bounded tree.');
    seen.add(id);
    var component = ids[id];
    var children = component.children || [];
    if (component.child !== undefined) children = children.concat([component.child]);
    if (component.tabs !== undefined) {
      if (!Array.isArray(component.tabs)) fail('Tabs must be a list.');
      children = children.concat(component.tabs.map(function (tab) { return tab && tab.child; }));
    }
    children.forEach(function (child) { visit(child, depth + 1); });
  }
  visit('root', 0);
  if (seen.size !== surface.components.length) fail('Every component must belong to root.');
  // Clay permits hyphens and leading digits; the official renderer requires
  // UAX #31 identifiers. Map the validated tree, not user data or bindings.
  var rendererIds = Object.create(null);
  surface.components.forEach(function (component, index) {
    rendererIds[component.id] = component.id === 'root' ? 'root' : 'clay_component_' + index;
  });
  surface.components.forEach(function (component) {
    component.id = rendererIds[component.id];
    if (component.children) component.children = component.children.map(function (id) { return rendererIds[id]; });
    if (component.child !== undefined) component.child = rendererIds[component.child];
    if (component.tabs) component.tabs.forEach(function (tab) { tab.child = rendererIds[tab.child]; });
  });
  return doc;
}
