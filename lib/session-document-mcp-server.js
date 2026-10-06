// Live Markdown presentation tool for project sessions.

var buildShape = require("./session-spawn-mcp-server").buildShape;

function getToolDefs(handlers) {
  return [{
    name: "present_markdown_edit",
    description: "Call once per targeted document, immediately before its first Edit or Write, when the user's primary request is to create or revise Markdown. Pass the resolved .md or .mdx path. Do not call for incidental documentation changes made as part of coding, maintenance, tests, or refactoring. This prepares Clay's rendered document view so the user can watch every change.",
    inputSchema: buildShape({
      path: { type: "string", description: "Project-relative or absolute path to the Markdown document that will be edited." },
    }, ["path"]),
    handler: function (args) { return handlers.present(args || {}); },
  }, {
    name: "present_wireframe",
    description: "Open or update the temporary clay-sketch viewer in the right panel when the user wants to revise or discuss a wireframe. Supports nested layouts and common UI controls, not general UML or preprocessor directives. Supply complete Salt diagram source, a stable id reused across revisions, and a short title. This displays only; it never saves or edits files. Include the same source in a fenced clay-sketch response so the diagram remains in chat history.",
    inputSchema: buildShape({
      source: { type: "string", description: "Complete @startsalt/@endsalt source, or @startuml with a salt body (100 KB maximum)." },
      id: { type: "string", description: "Stable design id, using letters, digits, hyphens or underscores (80 characters maximum)." },
      title: { type: "string", description: "Short title for the viewer." },
    }, ["source", "id"]),
    handler: function (args) { return handlers.presentWireframe(args || {}); },
  }];
}

module.exports = { getToolDefs: getToolDefs };
