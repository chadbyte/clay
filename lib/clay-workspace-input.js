var z = require('zod');
var file = z.string().min(1).max(300);
var domain = z.enum(['files', 'git', 'terminal']);
var readSchema = z.discriminatedUnion('domain', [
  z.object({ domain: z.literal('files'), action: z.enum(['list', 'read']), path: file }).strict(),
  z.object({ domain: z.literal('git'), action: z.enum(['status', 'diff']), path: file.optional() }).strict(),
  z.object({ domain: z.literal('terminal'), action: z.enum(['list', 'read']), id: z.number().int().positive().optional() }).strict(),
]);
var writeSchema = z.union([
  z.object({ domain: z.literal('files'), action: z.literal('write'), path: file, content: z.string().max(1100) }).strict(),
  z.object({ domain: z.literal('git'), action: z.enum(['stage', 'unstage']), paths: z.array(file).min(1).max(30) }).strict(),
  z.object({ domain: z.literal('terminal'), action: z.literal('create'), cols: z.number().int().min(20).max(240), rows: z.number().int().min(5).max(100) }).strict(),
  z.object({ domain: z.literal('terminal'), action: z.literal('rename'), id: z.number().int().positive(), title: z.string().trim().min(1).max(50).regex(/^[^\u0000-\u001f\u007f]+$/) }).strict(),
  z.object({ domain: z.literal('terminal'), action: z.literal('resize'), id: z.number().int().positive(), cols: z.number().int().min(20).max(240), rows: z.number().int().min(5).max(100) }).strict(),
  z.object({ domain: z.literal('terminal'), action: z.literal('close'), id: z.number().int().positive() }).strict(),
]);
module.exports = { domain: domain, readSchema: readSchema, writeSchema: writeSchema };
