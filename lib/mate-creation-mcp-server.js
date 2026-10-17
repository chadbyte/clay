// Query-bound proposal tool for Clay-led Mate creation interviews.

var z;
try { z = require("zod"); } catch (e) { z = null; }

function schema() {
  if (!z) return {};
  return {
    name: z.string().describe("The proposed Mate name"),
    bio: z.string().describe("A concise public description of how this Mate helps"),
    relationship: z.string().describe("The working relationship this Mate should have with the user"),
    activities: z.string().describe("JSON array of the Mate's main activities or contexts"),
    communicationStyle: z.string().describe("JSON array of communication preferences"),
    autonomy: z.string().describe("A concise description of autonomy, boundaries, and escalation behavior"),
    identityMarkdown: z.string().describe("The complete first-person Mate identity in Markdown"),
    scheduleIntent: z.string().optional().describe("Optional JSON schedule intent to bind only after the Mate is created"),
  };
}

function parseArray(value, field) {
  var parsed;
  try { parsed = JSON.parse(value || "[]"); } catch (e) { throw new Error(field + " must be a JSON array."); }
  if (!Array.isArray(parsed)) throw new Error(field + " must be a JSON array.");
  return parsed;
}

function getToolDefs(onPropose) {
  return [{
    name: "propose_mate",
    description: "Present the completed Mate identity for explicit user approval. This does not create the Mate until the user approves the inline proposal.",
    inputSchema: schema(),
    handler: function (args) {
      var proposal;
      try {
        proposal = {
          name: args.name,
          bio: args.bio,
          relationship: args.relationship,
          activities: parseArray(args.activities, "activities"),
          communicationStyle: parseArray(args.communicationStyle, "communicationStyle"),
          autonomy: args.autonomy,
          identityMarkdown: args.identityMarkdown,
          scheduleIntent: args.scheduleIntent || null,
        };
      } catch (error) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: " + error.message }], isError: true });
      }
      return onPropose(proposal).then(function (result) {
        if (result && result.action === "create") return { content: [{ type: "text", text: "Mate created: " + proposal.name }] };
        if (result && result.action === "error") return { content: [{ type: "text", text: "Error: " + (result.error || "The Mate could not be created.") }], isError: true };
        return { content: [{ type: "text", text: "Mate proposal was cancelled by the user." }] };
      });
    },
  }];
}

module.exports = { getToolDefs: getToolDefs };
