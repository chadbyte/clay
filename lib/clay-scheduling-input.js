var z = require('zod');
var str = z.string();
var runtime = z.object({ vendor: str, model: str, effort: str.nullable().optional() }).strict();
var rule = z.object({ version: z.literal(1), timezone: z.literal('server-local'), anchorDate: str, time: str,
  recurrence: z.object({ every: z.number().int(), unit: z.enum(['day', 'week', 'month', 'year']), weekdays: z.array(z.number().int()).optional() }).strict().nullable().optional(),
  recurrenceEnd: z.object({ type: z.enum(['until', 'after']), date: str.optional(), count: z.number().int().optional() }).strict().nullable().optional(),
  interval: z.object({ every: z.number().int(), unit: z.enum(['minute', 'hour']), end: z.object({ type: z.enum(['until', 'after']), time: str.optional(), count: z.number().int().optional() }).strict().nullable().optional() }).strict().nullable().optional(),
}).strict();
var mateFields = { message: str.optional(), date: str.optional(), time: str.optional(), scheduleRule: rule.optional() };
var taskFields = { name: str.optional(), instructions: str.optional(), date: str.optional(), time: str.optional(), cron: str.nullable().optional(), scheduleRule: rule.nullable().optional(), execution: z.object({ driver: runtime, worker: runtime }).strict().optional(), skipIfRunning: z.boolean().optional() };
var target = z.union([z.object({ kind: z.literal('mate'), mateId: str, sessionRef: str }).strict(), z.object({ kind: z.literal('project'), projectSlug: str, sessionRef: str }).strict()]);
var read = z.object({ target: target, operation: z.union([z.object({ action: z.literal('list') }).strict(), z.object({ action: z.literal('receipt'), requestId: str }).strict(), z.object({ action: z.literal('read'), id: str }).strict()]) }).strict();
var operation = z.union([
  z.object({ action: z.literal('create_mate'), data: z.object(Object.assign({}, mateFields, { message: str })).strict() }).strict(),
  z.object({ action: z.literal('update_mate'), id: str, revision: str, data: z.object(mateFields).strict() }).strict(),
  z.object({ action: z.literal('cancel_mate'), id: str, revision: str }).strict(),
  z.object({ action: z.literal('propose'), data: z.object(Object.assign({}, taskFields, { name: str, instructions: str })).strict() }).strict(),
  z.object({ action: z.literal('update'), id: str, revision: z.number().int().positive(), data: z.object(taskFields).strict() }).strict(),
  z.object({ action: z.enum(['cancel', 'pause', 'resume', 'run']), id: str, revision: z.number().int().positive() }).strict(),
]);
module.exports = { readSchema: read, inspectSchema: z.object({ target: target, operation: operation }).strict(), targetSchema: target };
