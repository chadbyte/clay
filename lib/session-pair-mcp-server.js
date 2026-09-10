// Partner-control tools for sessions that belong to a split group.

var buildShape = require("./session-spawn-mcp-server").buildShape;
var z;
try { z = require("zod"); } catch (e) { z = null; }
var evaluationSchema = z ? z.union([
  z.string(),
  z.object({ outcome: z.string(), note: z.string().optional() }),
]) : null;

// `options.lifecycle` adds the autonomous management tools. They are omitted
// for a plain side-by-side split, which has no Driver role to exercise them.
function getToolDefs(handlers, options) {
  var lifecycle = !!(options && options.lifecycle);
  var defs = [
    {
      name: "send_to_partner",
      description: "Delegate one concrete follow-up task to the existing visible Split Worker. This tool is exposed only after the user has configured and accepted an exact pair. A completed turn does not end the Split Worker session: reuse the same Split Worker for follow-up implementation and corrections instead of taking over its work. Detached completions are pushed back automatically. A delegated turn cannot delegate back, so keep orchestration one hop deep.",
      inputSchema: buildShape({
        message: { type: "string", description: "The complete task or question for the partner." },
        wait: { type: "boolean", description: "Wait for the partner's turn to finish. Defaults to true." },
        timeoutSeconds: { type: "number", description: "Maximum wait in seconds, from 1 to 900. Defaults to 300." },
        operationId: { type: "string", description: "Optional stable id for this delegation. Reusing it within the same human turn returns the original operation instead of sending twice." },
        taskId: { type: "string", description: "Optional stable task id for generation and completion correlation." },
      }, ["message"]),
      handler: function (args) { return handlers.send(args || {}); },
    },
    {
      name: "read_partner",
      description: "Read the Split Worker's current status and recent conversation turns, plus the same bounded capacity report partner_status returns. Use this for an interim check after a non-waiting delegation or timeout; completed results are pushed automatically.",
      inputSchema: buildShape({
        lastTurns: { type: "number", description: "Number of recent user-message-delimited turns, from 0 to 5. Use 0 for status only. Defaults to 1." },
      }),
      handler: function (args) { return handlers.read(args || {}); },
    },
    {
      name: "interrupt_partner",
      description: "Interrupt the Split Worker's current task. Use this when the task is going in the wrong direction, needs to be reprioritized, or must stop before the next instruction. The Split Worker returns any partial result to you for review.",
      inputSchema: buildShape({ reason: { type: "string", description: "Why the Driver is interrupting this task." } }),
      handler: function (args) { return handlers.interrupt(args || {}); },
    },
    {
      name: "close_partner",
      description: "Close the visible Split Worker pane and dissolve the Driver/Split Worker pair while preserving both session histories. If the Split Worker is still running, Clay interrupts it before closing the pair.",
      inputSchema: buildShape({}),
      handler: function (args) { return handlers.close(args || {}); },
    },
  ];
  if (!lifecycle) return defs;
  return defs.concat([
    {
      name: "message_partner",
      description: "Queue a non-interrupting message on the active Split Worker's runtime input without creating a delegated follow-up. Returns queued or rejected with an exact request id; queued does not claim model execution.",
      inputSchema: buildShape({
        message: { type: "string", description: "Bounded correction or context for the current active Worker turn." },
        requestId: { type: "string", description: "Optional stable request id. Reuse it to deduplicate a retried delivery within this human turn." },
      }, ["message"]),
      handler: function (args) { return handlers.message(args || {}); },
    },
    {
      name: "partner_status",
      description: "Bounded capacity and continuity report for your Split Worker, for deciding reuse against replacement: context tokens used and the ratio of its window, current task and activity, vendor/model/effort, history size and idle time, whether it is safe to replace right now, and your own recorded results for earlier Worker generations. Returns no transcript. Prefer this over reading turns when you only need to decide.",
      inputSchema: buildShape({}),
      handler: function (args) { return handlers.status(args || {}); },
    },
    {
      name: "replace_partner",
      description: "Propose replacing the current Split Worker with a fresh runtime. This non-mutating call shows a user-controlled vendor, model, and effort card. Only acceptance performs the transactional replacement and delegates the supplied task once; decline keeps the existing pair and resumes the Driver. The previous Worker's conversation remains browsable. An active Worker requires interrupt true.",
      inputSchema: buildShape({
        interrupt: { type: "boolean", description: "Stop the Worker first if it is mid-turn or holding a delegated task. Required to replace an active Worker." },
        message: { type: "string", description: "Task to deliver exactly once after the user accepts the replacement." },
        workerVendor: { type: "string", description: "Optional vendor for the new Worker. Must be installed and available." },
        workerModel: { type: "string", description: "Optional model for the new Worker. Must be offered by that vendor." },
        workerEffort: { type: "string", description: "Optional reasoning effort for the new Worker." },
        recommendationRationale: { type: "string", description: "Concise Driver-authored explanation of why the recommended replacement vendor, model, and effort fit the next task." },
        evaluation: {
          schema: evaluationSchema,
          description: "Optional bounded assessment of the Worker being replaced, recorded against that exact generation.",
        },
        operationId: { type: "string", description: "Optional stable id for this replacement. Reusing it within the same human turn returns the original operation instead of replacing twice." },
        supersedeProposalId: { type: "string", description: "Exact pending replacement proposal id to supersede with this new configuration." },
      }, ["message", "recommendationRationale"]),
      handler: function (args) { return handlers.replace(args || {}); },
    },
    {
      name: "record_partner_evaluation",
      description: "Record a bounded assessment of one Split Worker generation so your later model choices can use observed outcomes instead of re-reading transcripts. Records your judgement alongside the objective signals Clay already measured (turns, errors, interruption, context used). This is scoped to your own pair and forms no global model ranking.",
      inputSchema: buildShape({
        outcome: { type: "string", description: 'One of "succeeded", "partial", "failed", "abandoned".' },
        note: { type: "string", description: "Optional short reason, up to 400 characters." },
        generation: { type: "number", description: "Optional generation number. Defaults to the current Worker." },
      }, ["outcome"]),
      handler: function (args) { return handlers.evaluate(args || {}); },
    },
  ]);
}

module.exports = { getToolDefs: getToolDefs };
