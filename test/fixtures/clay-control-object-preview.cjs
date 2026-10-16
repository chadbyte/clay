var fs = require('node:fs'), path = require('node:path');
function attach(ctx) {
  var seed, serial = 0, terminalId, knowledgeSeed, notificationSeed;
  async function driver(server, name, args) {
    var result = await ctx.target.getMcpBridgeHandler(ctx.session.localId, true, Number(ctx.session._sdkQueryGeneration || 0)).callTool(server, name, args);
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  async function prepare() {
    if (seed) return seed;
    fs.writeFileSync(path.join(ctx.target.getStatus().path, 'activity-target.txt'), 'Authoritative file view\n');
    var issue = await driver('clay-issues', 'create_issue', { title: 'Pointer fixture issue', summary: 'Visible exact revision', body: 'Isolated record' });
    var log = await driver('clay-logs', 'create_log', { title: 'Pointer fixture log', summary: 'Visible exact revision', kind: 'investigation', body: 'Isolated record' });
    seed = { issue: issue, log: log, file: 'activity-target.txt' }; return seed;
  }
  async function handle(url) {
    var kind = url.searchParams.get('kind');
    if (kind === 'ordinary_document') {
      var project; ctx.projects.forEach(function (item) { if (!project && item.getStatus().isMate && item.getStatus().mateId !== ctx.clay.id) project = item; });
      var conversation = project.getSessionManager().sessions.get(2); fs.writeFileSync(path.join(project.getStatus().path, 'ordinary.md'), '# ORDINARY_SOURCE_DOCUMENT\n');
      return project.getMcpBridgeHandler(conversation.localId, true, Number(conversation._sdkQueryGeneration || 0)).callTool('clay-documents', 'present_markdown_edit', { path: 'ordinary.md' });
    }
    if (kind === 'document_parent_seed') { fs.writeFileSync(path.join(ctx.target.getStatus().path, 'activity.md'), '# WRONG_PROJECT_CONTENT\n'); return { created: true }; }
    if (kind === 'document_update') { fs.writeFileSync(path.join(ctx.source.getStatus().path, 'activity.md'), '# SOURCE_DOCUMENT_UPDATED\n'); fs.writeFileSync(path.join(ctx.target.getStatus().path, 'activity.md'), '# WRONG_PROJECT_CONTENT\n'); return { updated: true }; }
    if (kind === 'knowledge_seed') {
      if (!knowledgeSeed) {
        var mate = ctx.mates.getAllMates(ctx.mateCtx).find(function (item) { return item.builtinKey !== 'clay' && !item.archived && !ctx.projects.has('mate-' + item.id); });
        var project = ctx.add('mate-' + mate.id, mate.name, mate), conversation = ctx.createSession(project, 'Pointer Knowledge workspace', 'Isolated owner-private Knowledge target');
        var who = { type: 'user', userId: 'owner' };
        var document = project.getKnowledgeProductOperations().mutate({ action: 'create_document', name: 'pointer.md', content: '# Authoritative pointer document' }, who);
        var databases = project.getKnowledgeDbService();
        var database = (await databases.create({ name: 'Pointer database', schema: [{ id: 'title_field', name: 'Title', type: 'title', required: true }], operationId: 'seed_' + Date.now() + '_database', actor: who })).database;
        var record = (await databases.createRecord({ databaseId: database.id, expectedDatabaseRevision: database.revision, values: { title_field: 'Pointer record' }, operationId: 'seed_' + Date.now() + '_record', actor: who })).record;
        knowledgeSeed = { mateId: mate.id, slug: 'mate-' + mate.id, sessionId: conversation.localId, document: document, database: database, record: record };
      }
      return knowledgeSeed;
    }
    if (kind === 'notification_seed') { notificationSeed = ctx.notify('user_mention', { ownerId: 'owner', targetUserId: 'owner', title: 'Pointer notification', body: 'Authoritative owner notification' }); return notificationSeed; }
    if (kind === 'seed') return prepare();
    if (kind === 'assignment') return ctx.call('propose_project_assignment', { projectSlug: 'alpha', title: 'Pointer assignment ' + (++serial), task: 'Inspect only the isolated target.' });
    var inspected, name, args;
    if (kind === 'notification') {
      if (!notificationSeed) throw new Error('Seed a real owned notification first.');
      inspected = await ctx.call('inspect_owner_screen_change', { operation: { action: 'dismiss_notifications', ids: [notificationSeed.id] } }); name = 'control_owner_screen';
    } else if (['knowledge_document', 'knowledge_database', 'knowledge_record'].indexOf(kind) >= 0) {
      if (!knowledgeSeed) throw new Error('Seed the private Knowledge workspace first.');
      var id = knowledgeSeed.mateId, operation;
      if (kind === 'knowledge_document') {
        var document = await ctx.call('read_mate_knowledge_control', { mateId: id, operation: { action: 'read_document', documentId: knowledgeSeed.document.documentId } });
        operation = { action: 'update_document', documentId: document.documentId, expectedRevision: document.revision, content: '# Reviewed pointer document' };
      } else if (kind === 'knowledge_database') {
        var database = await ctx.call('read_mate_knowledge_control', { mateId: id, operation: { action: 'read_database', databaseId: knowledgeSeed.database.id } });
        operation = { action: 'rename_database', databaseId: knowledgeSeed.database.id, expectedRevision: database.database.revision, name: 'Reviewed pointer database' };
      } else {
        var record = await ctx.call('read_mate_knowledge_control', { mateId: id, operation: { action: 'read_database_record', databaseId: knowledgeSeed.database.id, recordId: knowledgeSeed.record.id } });
        operation = { action: 'update_database_record', databaseId: knowledgeSeed.database.id, recordId: knowledgeSeed.record.id, expectedRevision: record.record.revision, values: { title_field: 'Reviewed pointer record' } };
      }
      inspected = await ctx.call('inspect_mate_knowledge_change', { mateId: id, operation: operation }); name = 'control_mate_knowledge';
    } else if (kind === 'mate_schedule') {
      if (!knowledgeSeed) throw new Error('Seed the exact private Mate session first.');
      var project = ctx.projects.get(knowledgeSeed.slug), conversation = project.getSessionManager().sessions.get(knowledgeSeed.sessionId);
      var selector = { kind: 'mate', mateId: knowledgeSeed.mateId, sessionRef: require('../../lib/workspace-query-service').sessionRef(knowledgeSeed.slug, conversation) };
      var records = await ctx.call('read_schedule_controls', { target: selector, operation: { action: 'list' } }), operation;
      if (!records.schedules.length) { await ctx.call('begin_schedule_control_interview', { target: selector }); operation = { action: 'create_mate', data: { message: 'Isolated pending Mate schedule', date: '2099-01-01', time: '09:00' } }; }
      else operation = { action: 'cancel_mate', id: records.schedules[0].id, revision: records.schedules[0].revision };
      inspected = await ctx.call('inspect_schedule_change', { target: selector, operation: operation }); name = 'control_schedules';
    } else if (kind === 'mate') {
      var mate = ctx.mates.getAllMates(ctx.mateCtx).find(function (item) { return item.builtinKey !== 'clay' && !item.archived && !ctx.projects.has('mate-' + item.id); });
      inspected = await ctx.call('inspect_mate_control', { mateId: mate.id }); name = 'control_mate_lifecycle'; args = { action: 'profile', patch: { bio: 'Reviewed fixture profile ' + (++serial) } };
    } else if (kind === 'terminal' || kind === 'terminal_create') {
      var operation = kind === 'terminal_create' ? { domain: 'terminal', action: 'create', cols: 80, rows: 24 } : { domain: 'terminal', action: 'rename', id: terminalId, title: 'Reviewed shell title' };
      inspected = await ctx.call('inspect_workspace_change', { projectSlug: 'alpha', operation: operation }); name = 'control_project_workspace';
    } else if (kind === 'git' || kind === 'git_seed' || kind === 'git_multi') {
      await prepare();
      if (!fs.existsSync(path.join(ctx.target.getStatus().path, '.git'))) require('node:child_process').execFileSync('git', ['init', '-q', ctx.target.getStatus().path]);
      if (kind === 'git_seed') { fs.writeFileSync(path.join(ctx.target.getStatus().path, 'activity-second.txt'), 'Second exact Git target\n'); return seed; }
      inspected = await ctx.call('inspect_workspace_change', { projectSlug: 'alpha', operation: { domain: 'git', action: 'stage', paths: kind === 'git_multi' ? [seed.file, 'activity-second.txt'] : [seed.file] } }); name = 'control_project_workspace';
    } else if (kind === 'file') {
      await prepare(); inspected = await ctx.call('inspect_workspace_change', { projectSlug: 'alpha', operation: { domain: 'files', action: 'write', path: seed.file, content: 'Reviewed file content ' + (++serial) } }); name = 'control_project_workspace';
    } else if (kind === 'issue' || kind === 'log') {
      await prepare(); var area = kind === 'issue' ? 'issues' : 'logs';
      var current = await ctx.call('read_project_records', { projectSlug: 'alpha', operation: { area: area, action: 'read', ref: seed[kind].ref } });
      inspected = await ctx.call('inspect_project_record_change', { projectSlug: 'alpha', operation: { area: area, action: 'update', ref: current.ref, expectedRevision: kind === 'issue' ? current.revision : current.revisions, summary: 'Reviewed pointer update ' + (++serial) } }); name = 'control_project_records';
    } else if (kind === 'schedule') {
      var target = { kind: 'project', projectSlug: 'alpha', sessionRef: require('../../lib/workspace-query-service').sessionRef('alpha', ctx.session) };
      var records = await ctx.call('read_schedule_controls', { target: target, operation: { action: 'list' } });
      var operation;
      if (!records.records.length) {
        await ctx.call('begin_schedule_control_interview', { target: target });
        operation = { action: 'propose', data: { name: 'Pointer fixture schedule', instructions: 'Inspect the isolated fixture only.', scheduleRule: { version: 1, timezone: 'server-local', anchorDate: '2099-01-01', time: '09:00', recurrence: null }, execution: { driver: { vendor: 'claude', model: 'fixture-model', effort: 'medium' }, worker: { vendor: 'claude', model: 'fixture-model', effort: 'medium' } } } };
      } else operation = { action: 'pause', id: records.records[0].id, revision: records.records[0].revision };
      inspected = await ctx.call('inspect_schedule_change', { target: target, operation: operation }); name = 'control_schedules';
    } else if (kind === 'browser') {
      var result = await ctx.source.getMcpBridgeHandler(ctx.sourceSession.localId, true, Number(ctx.sourceSession._sdkQueryGeneration || 0)).callTool('clay-shared-browser', 'shared_browser', { action: 'open', url: 'https://fixture.invalid/', intent: 'I will open the isolated browser to verify its real rendered frame.' });
      return result;
    } else if (kind === 'sketch') {
      var result = await ctx.source.getMcpBridgeHandler(ctx.sourceSession.localId, true, Number(ctx.sourceSession._sdkQueryGeneration || 0)).callTool('clay-documents', 'present_wireframe', { id: 'pointer-sketch', source: '@startsalt\n{ [Review ' + (++serial) + '] | [Keep] }\n@endsalt', title: 'Pointer sketch' });
      return JSON.parse(result.content[0].text);
    } else if (kind === 'document') {
      var root = ctx.source.getStatus().path; fs.writeFileSync(path.join(root, 'activity.md'), '# Studio activity ' + (++serial) + '\n');
      var result = await ctx.source.getMcpBridgeHandler(ctx.sourceSession.localId, true, Number(ctx.sourceSession._sdkQueryGeneration || 0)).callTool('clay-documents', 'present_markdown_edit', { path: 'activity.md' });
      return JSON.parse(result.content[0].text);
    } else return null;
    if (!inspected.targetToken) throw new Error(JSON.stringify(inspected));
    var result = await ctx.call(name, Object.assign({ targetToken: inspected.targetToken, requestId: 'object_' + Date.now() + '_' + (++serial), why: 'Verify the exact visible object through its real service' }, args));
    if (kind === 'terminal_create') terminalId = result.terminalId;
    return result;
  }
  return { handle: handle };
}
module.exports = { attach: attach };
