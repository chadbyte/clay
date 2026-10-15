var z = require('zod');
var text = z.string(), revision = z.number().int().positive();
var issueFields = { title: text.optional(), summary: text.optional(), body: text.optional(), resolutionSummary: text.optional(), type: z.enum(['bug', 'feature', 'plan']).optional(), priority: z.enum(['normal', 'important', 'urgent']).optional(), status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(), closeReason: z.enum(['declined', 'duplicate', 'non_code_decision']).optional() };
var logFields = { title: text.optional(), summary: text.optional(), body: text.optional(), kind: text.optional(), priority: z.enum(['normal', 'important', 'urgent']).optional(), tags: text.optional() };
var page = { limit: z.number().int().positive().max(200).optional(), cursor: text.optional() };
var filters = Object.assign({}, page, { query: text.optional(), kind: text.optional(), priority: text.optional(), tag: text.optional(), contextMode: z.enum(['current', 'project', 'all']).optional() });
var issueFilter = Object.assign({}, page, { query: text.optional(), status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(), type: text.optional(), priority: text.optional() });
var READS = {}, WRITES = {};
function operation(area, action, method, fields, writes) {
  (writes ? WRITES : READS)[area + ':' + action] = method;
  return z.object(Object.assign({ area: z.literal(area), action: z.literal(action) }, fields)).strict();
}
var readSchema = z.union([
  operation('issues', 'list', 'listIssues', issueFilter), operation('issues', 'search', 'searchIssues', issueFilter),
  operation('issues', 'read', 'readIssue', { ref: text }), operation('issues', 'history', 'issueHistory', { ref: text }),
  operation('issues', 'revision', 'readIssueRevision', { ref: text, revision: revision }), operation('issues', 'feedback', 'listIssueFeedback', page),
  operation('logs', 'list', 'listLogs', filters), operation('logs', 'search', 'searchLogs', filters),
  operation('logs', 'read', 'readLog', { ref: text }), operation('logs', 'history', 'logHistory', Object.assign({ ref: text }, page)),
  operation('logs', 'revision', 'readLogRevision', { ref: text, revision: revision }), operation('logs', 'feedback', 'listLogFeedback', filters),
]);
var review = { ref: text, expectedRevision: revision, commentId: text, reviewAction: z.enum(['incorporate', 'clarify', 'decline']), response: text.optional() };
var writeSchema = z.union([
  operation('issues', 'create', 'createIssue', Object.assign({}, issueFields, { title: text, commitSha: text.optional() }), true),
  operation('issues', 'update', 'updateIssue', Object.assign({}, issueFields, { ref: text, expectedRevision: revision, commitSha: text.optional() }), true),
  operation('issues', 'review', 'reviewIssueComment', Object.assign({}, issueFields, review), true),
  operation('issues', 'comment', 'commentIssue', { ref: text, expectedRevision: revision, body: text }, true),
  operation('issues', 'delete', 'removeIssue', { ref: text, expectedRevision: revision }, true),
  operation('logs', 'create', 'createLog', Object.assign({}, logFields, { title: text, kind: text, summary: text }), true),
  operation('logs', 'update', 'updateLog', Object.assign({}, logFields, { ref: text, expectedRevision: revision }), true),
  operation('logs', 'review', 'reviewLogComment', Object.assign({}, logFields, review), true),
  operation('logs', 'comment', 'commentLog', { ref: text, expectedRevision: revision, body: text }, true),
  operation('logs', 'revert', 'revertLog', { ref: text, expectedRevision: revision, revision: revision, reason: text }, true),
  operation('logs', 'link', 'linkLog', { ref: text, expectedRevision: revision, links: text }, true),
  operation('logs', 'delete', 'removeLog', { ref: text, expectedRevision: revision }, true),
]);
function parameters(op) {
  var out = Object.assign({}, op); delete out.area; delete out.action;
  if (op.area === 'logs') {
    ['tags', 'links'].forEach(function (key) { if (out[key] !== undefined) { out[key] = JSON.parse(out[key]); if (!Array.isArray(out[key])) throw new Error(key + ' must encode a JSON array.'); } });
  }
  if (op.action === 'review') { out.action = out.reviewAction; delete out.reviewAction; }
  return out;
}
module.exports = { readSchema: readSchema, writeSchema: writeSchema, READS: READS, WRITES: WRITES, parameters: parameters };
