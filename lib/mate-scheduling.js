var crypto = require('crypto');
var userInput = require('./yoke/user-input');
var input = require('./mate-schedule-input');
var personal = require('./mcp-session-access');

function attachMateScheduling(ctx) {
  function owner(session) { return ctx.users.isMultiUser() ? session.ownerId : 'local-user'; }
  function authorize(session) {
    if (!ctx.isMate || ctx.isHostAgent || !session || ctx.sm.sessions.get(session.localId) !== session ||
        session.destroying || session.mateCreationMode || session.taskStopRequested || session._mcpForeignInput ||
        session.sessionVisibility === 'shared' || session.delegated || session._delegatedBy || session._pairDelegation) throw new Error('An active private Mate conversation is required.');
    if (ctx.users.isMultiUser() && (session.ownerId !== ctx.projectOwnerId || !personal.canUsePersonalConnections(session, ctx.sm.sessions))) throw new Error('Only the Mate owner can schedule messages.');
    if (!ctx.users.isMultiUser() && (session.ownerId || (session.history || []).some(function (event) { return event.type === 'user_message' && event.from && event.from !== 'default'; }))) throw new Error('Foreign input cannot authorize Mate schedules.');
    ctx.authorizeAccess(session, owner(session));
  }
  function persistDraft(session, draft) {
    var previous = session.mateScheduleDraft;
    session.mateScheduleDraft = draft;
    if (ctx.sm.saveSessionFile(session) !== true) {
      session.mateScheduleDraft = previous;
      throw new Error('The schedule draft could not be saved.');
    }
  }
  function result(value) { return { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
  function getToolDefs(session) {
    try { authorize(session); } catch (error) { return []; }
    var generation = Number(session._sdkQueryGeneration || 0);
    var originalOwner = owner(session);
    function current() {
      authorize(session);
      if (generation !== Number(session._sdkQueryGeneration || 0) || owner(session) !== originalOwner) throw new Error('The schedule query is stale.');
    }
    function tool(name, description, properties, required, handler) {
      return { name: name, queryBound: true, inputSchema: { type: 'object', properties: properties, required: required, additionalProperties: false },
        description: description, handler: async function (args) {
          try { current(); return result(await handler(args || {})); }
          catch (error) { return result({ status: 'rejected', reason: error.message }); }
        } };
    }
    var str = { type: 'string' };
    var fields = { message: str, date: str, time: str, scheduleRule: { type: ['object', 'null'] } };
    async function approve(draft, question, label, other) {
      persistDraft(session, draft);
      var reply = await userInput.dispatchUserInput(ctx.userInput(session), { questions: [{
        id: 'approve', header: 'Mate schedule', question: question,
        options: [{ label: label }, { label: other || 'Cancel' }], allowOther: false,
      }] }, { source: 'mate-schedule', signal: session.abortController && session.abortController.signal });
      current();
      if (!session.mateScheduleDraft || session.mateScheduleDraft.id !== draft.id || session.mateScheduleDraft.revision !== draft.revision) throw new Error('The schedule draft is stale.');
      var accepted = reply.status === 'submitted' && reply.answers.approve && reply.answers.approve.length === 1 && reply.answers.approve[0] === label;
      if (!accepted) persistDraft(session, null);
      return accepted;
    }
    async function review(args, update) {
      var previous = update ? ctx.lifecycle.read(session, args) : null;
      var value = input.normalize(args, previous);
      var draft = { id: crypto.randomUUID(), revision: crypto.randomUUID(), value: value,
        targetId: previous && previous.id, targetRevision: previous && previous.revision };
      if (!await approve(draft, (update ? 'Update this schedule?\n' : 'Create this schedule?\n') + input.review(value), update ? 'Update schedule' : 'Create schedule')) return { status: 'cancelled' };
      var record = update ? ctx.lifecycle.update(session, { id: draft.targetId, revision: draft.targetRevision }, value) : ctx.lifecycle.create(session, value, draft.id);
      persistDraft(session, null);
      return { status: update ? 'updated' : 'created', schedule: record, timezone: input.timezone() };
    }
    async function cancel(args) {
      var record = ctx.lifecycle.read(session, args);
      if (record.state === 'cancelled') return { status: 'cancelled', schedule: record };
      var draft = { id: crypto.randomUUID(), revision: crypto.randomUUID(), targetId: record.id, targetRevision: record.revision };
      if (!await approve(draft, 'Cancel this schedule?\n' + input.review({ message: record.message, rule: record.rule }), 'Cancel schedule', 'Keep schedule')) return { status: 'unchanged' };
      record = ctx.lifecycle.cancel(session, { id: draft.targetId, revision: draft.targetRevision });
      persistDraft(session, null);
      return { status: 'cancelled', schedule: record };
    }
    var begin = tool('begin_mate_schedule_interview', 'Begin scheduling for this Mate. Ask exactly one structured question at a time. Never assume repetition.', {}, [], function () {
      return { status: 'interview_started', timezone: input.timezone(), guidance: 'Collect the message, date/time, and explicitly requested repetition one question at a time. Then propose the complete schedule for the human approval card.' };
    });
    begin.structuredQuestionLimit = function () { try { current(); return 1; } catch (error) { return null; } };
    return [begin,
      tool('propose_mate_schedule', 'Review a complete message schedule in a server-owned approval card. Only authenticated human approval persists a schedule.', fields, ['message'], function (args) { return review(args, false); }),
      tool('list_mate_schedules', 'List logical schedules and their stable IDs, revisions and lifecycle states in this private conversation.', {}, [], function () { return { schedules: ctx.lifecycle.list(session) }; }),
      tool('read_mate_schedule', 'Read one logical schedule using its listed ID.', { id: str }, ['id'], function (args) { return { schedule: ctx.lifecycle.read(session, args) }; }),
      tool('update_mate_schedule', 'Propose changes to an active schedule by listed ID and revision, with a fresh human approval card.', Object.assign({ id: str, revision: str }, fields), ['id', 'revision'], function (args) { return review(args, true); }),
      tool('cancel_mate_schedule', 'Review cancellation by listed ID and revision in an authenticated human approval card. Cancellation persists across restart.', { id: str, revision: str }, ['id', 'revision'], cancel),
    ];
  }
  return { authorize: authorize, owner: owner, getToolDefs: getToolDefs, getSystemPrompt: function (session) {
    try { authorize(session); } catch (error) { return ''; }
    return 'When scheduling for this Mate, call begin_mate_schedule_interview, ask exactly one structured question at a time, and clarify the message, local date/time in ' + input.timezone() + ', and explicitly requested repetition. Use scheduleRule for recurrence and count/until limits. propose_mate_schedule and update_mate_schedule present the exact authenticated human approval card. Chat text and model flags never approve schedules. Use listed logical IDs and revisions to read, update or cancel. Scheduled output uses this private Mate runtime and tools. Project Scheduled Tasks Driver/Worker tools remain unavailable.';
  } };
}
module.exports = { attachMateScheduling: attachMateScheduling };
