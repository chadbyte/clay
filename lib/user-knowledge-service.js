// Owner-private user knowledge. Only canonical Clay sessions curate records.
var crypto = require('crypto');
var canUsePersonalConnections = require('./mcp-session-access').canUsePersonalConnections;
var createRecordStore = require('./knowledge-record-store').createRecordStore;

function attachUserKnowledgeService(deps) {
  var stores = new Map();
  function owner(id) {
    if (deps.isMultiUser() && (!id || !deps.findUser(id))) throw new Error('User knowledge requires an authenticated owner.');
    return deps.isMultiUser() ? id : 'default';
  }
  function storage(id) {
    var key = crypto.createHash('sha256').update(owner(id)).digest('hex');
    if (!stores.has(key)) stores.set(key, createRecordStore({scopeId:'user/' + key + '/you',baseDir:deps.baseDir}));
    return stores.get(key);
  }
  function snapshot(id) {
    var result = {entries:{},reports:{},activity:[],seen:{},version:0};
    storage(id).all().forEach(function (record) {
      if (record.kind !== 'user-knowledge') return;
      result.version++;
      if (record.seen) result.seen[record.seen.ref] = Math.max(result.seen[record.seen.ref] || 0, record.seen.revision);
      if (record.entry) result.entries[record.entry.ref] = record.entry;
      if (record.report) result.reports[record.report.ref] = record.report;
      if (record.activity) result.activity.push(record.activity);
    });
    return result;
  }
  function text(value, max, required) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid or oversized knowledge text.');
    return value.trim();
  }
  function page(items, args) {
    args = args || {};
    var offset = Math.max(0, Number(args.offset) || 0);
    offset = Number.isFinite(offset) ? Math.floor(offset) : 0;
    var limit = Math.min(50, Math.max(1, Number(args.limit) || 30));
    return {items:items.slice(offset,offset+limit),total:items.length,nextOffset:offset+limit < items.length ? offset+limit:null};
  }
  function unread(entry,state) { return !entry.archived && entry.revisions > (state.seen[entry.ref] || 0); }
  function attention(id) {
    var state = snapshot(id);
    return { unread: Object.values(state.entries).filter(function (entry) { return unread(entry,state); }).length, version: state.version };
  }
  function acknowledge(id,args) {
    var state = snapshot(id);
    var entry = state.entries[args.ref];
    if (!entry || entry.archived) throw new Error('User knowledge not found.');
    if (!Number.isInteger(args.revision) || args.revision < 1 || args.revision > entry.revisions) throw new Error('Invalid memory revision.');
    if ((state.seen[args.ref] || 0) < args.revision) {
      storage(id).append({kind:'user-knowledge',seen:{ref:args.ref,revision:args.revision,at:Date.now()}});
      try { deps.onChange(owner(id),{seen:true}); } catch (error) { /* Acknowledgement survives notification failures. */ }
    }
    return attention(id);
  }
  function list(id,args) {
    var state = snapshot(id);
    args = args || {};
    var query = String(args.query || '').toLowerCase().slice(0,300);
    var entries = Object.values(state.entries).filter(function (entry) {
      return !entry.archived && (!args.category || entry.category === args.category) &&
        (!query || (entry.title+' '+entry.summary+' '+entry.body).toLowerCase().indexOf(query)!==-1);
    }).map(function(entry){return Object.assign({},entry,{unread:unread(entry,state)});}).sort(function (a,b) {return Number(b.unread)-Number(a.unread) || b.updatedAt-a.updatedAt;});
    return Object.assign(page(entries,args),{categories:Array.from(new Set(Object.values(state.entries).filter(function (e) {return !e.archived;}).map(function(e){return e.category;}))).sort(),pending:Object.values(state.reports).filter(function(r){return r.status==='pending';}).length});
  }
  function read(id,ref) {
    var entry = snapshot(id).entries[ref];
    if (!entry || entry.archived) throw new Error('User knowledge not found.');
    var comments = Object.values(snapshot(id).reports).filter(function (item) { return item.commentEntryRef === ref; }).map(function (item) {
      return { id: item.ref, body: item.observation, at: item.createdAt, author: { type: 'user', displayName: 'You' },
        status: item.status === 'accepted' ? 'incorporated' : item.status,
        review: item.reviewedAt ? { response: item.reason, at: item.reviewedAt, author: { displayName: 'Clay' } } : null };
    });
    return Object.assign({}, entry, { comments: comments, commentCount: comments.length });
  }
  function comment(id,args,source) {
    var entry = read(id,args.ref);
    return report(id,{observation:args.body,evidence:'Comment on '+entry.ref+': '+args.body,evidenceType:'explicit'},source,entry.ref);
  }
  function report(id,args,source,commentEntryRef) {
    var state = snapshot(id);
    var observation = text(args.observation,4000,true);
    var evidence = text(args.evidence,4000,true);
    var evidenceType = args.evidenceType || 'explicit';
    if (['explicit','inferred'].indexOf(evidenceType)===-1) throw new Error('Invalid evidence type.');
    var existing = Object.values(state.reports).find(function (r) {return r.observation===observation && r.evidence===evidence && r.source.session===source.session && r.source.project===source.project && r.status==='pending';});
    if (existing) return existing;
    if (Object.values(state.reports).filter(function (r) {return r.status==='pending';}).length>=200) throw new Error('Clay has 200 pending observations. Review those before reporting more.');
    var record = {ref:'observation:'+crypto.randomBytes(12).toString('hex'),observation:observation,evidence:evidence,evidenceType:evidenceType,source:source,commentEntryRef:commentEntryRef || null,status:'pending',createdAt:Date.now()};
    storage(id).append({kind:'user-knowledge',report:record});
    try {deps.onReport(owner(id));} catch (error) { /* Durable pending report remains available for retry. */ }
    return record;
  }
  function bind(binding) {
    var originalOwner = binding.session && binding.session.ownerId;
    function principal() {
      var project = deps.getProject(binding.projectSlug);
      var session = binding.session;
      if (!project || !session || project.sm.sessions.get(session.localId)!==session || session.destroying) throw new Error('A live owner-bound session is required.');
      if (session.ownerId !== originalOwner) throw new Error('Session ownership changed.');
      if (deps.isMultiUser() && session.sessionVisibility === 'shared') throw new Error('Private User Knowledge is unavailable in shared conversations.');
      if (deps.isMultiUser() && !canUsePersonalConnections(session, project.sm.sessions)) throw new Error('User Knowledge requires an owner-only conversation and Driver.');
      var id = owner(session.ownerId);
      var status = project.getStatus();
      if (deps.isMultiUser() && !deps.canAccess(id,binding.projectSlug)) throw new Error('Project access was revoked.');
      var mate = status.isMate && deps.resolveMate(id,status.mateId);
      var clay = !!(mate && mate.builtinKey==='clay' && (!deps.isMultiUser() || mate.createdBy===id));
      return {id:id,clay:clay,source:{project:binding.projectSlug,session:session.cliSessionId || 'local:'+session.localId,mateId:status.mateId || null}};
    }
    function protect(p) {
      if (!deps.isMultiUser()) return;
      var session = binding.session;
      var manager = deps.getProject(binding.projectSlug).sm;
      function mark(target) {
        if (target.userKnowledgeOwnerId === p.id) return;
        var previous = target.userKnowledgeOwnerId;
        target.userKnowledgeOwnerId = p.id;
        try { manager.saveSessionFile(target); } catch (error) { target.userKnowledgeOwnerId = previous; throw error; }
      }
      var provenance = session.sessionProvenance;
      if (provenance && provenance.kind === 'worker') manager.sessions.forEach(function (parent) {
        if (parent.sessionOriginId === provenance.parentSessionOriginId) mark(parent);
      });
      mark(session);
    }
    function curator() {var p=principal();if(!p.clay) throw new Error('Only your canonical Clay can curate User Knowledge.');return p;}
    return {
      isClay:function () {return principal().clay;},
      list:function(args){var p=principal();var result=list(p.id,args);if(result.items.length)protect(p);return result;},
      read:function(args){var p=principal();var result=read(p.id,args.ref);protect(p);return result;},
      report:function(args){var p=principal();return report(p.id,args,p.source);},
      pending:function(args){var p=curator();return page(Object.values(snapshot(p.id).reports).filter(function(r){return r.status==='pending';}),args);},
      curate:function(args) {
        var p=curator();
        var state=snapshot(p.id);
        var observation=state.reports[args.reportRef];
        if (!observation) throw new Error('Observation not found.');
        if (observation.status!=='pending') return {report:observation,entry:observation.entryRef ? state.entries[observation.entryRef]:null};
        var action=args.action;
        if (['save','decline','archive'].indexOf(action)===-1) throw new Error('Invalid curation action.');
        var reason=text(args.reason,2000,true);
        var previous=args.ref ? state.entries[args.ref]:null;
        if (args.ref && !previous) throw new Error('User knowledge not found.');
        if (previous && args.expectedRevision!==previous.revisions) throw new Error('Knowledge changed. Read it again before updating.');
        var entry=null;
        var now=Date.now();
        if (action!=='decline') {
          if(action==='archive' && !previous) throw new Error('Choose an existing entry to archive.');
          var category=action==='archive' ? previous.category:text(args.category,32,true);
          if(!/^[a-z][a-z0-9-]*$/.test(category)) throw new Error('Use a lowercase category.');
          entry=Object.assign({},previous || {},{ref:previous ? previous.ref:'you:'+crypto.randomBytes(12).toString('hex'),category:category,kind:category,
            title:action==='archive' ? previous.title:text(args.title,160,true),summary:action==='archive' ? previous.summary:text(args.summary,600,true),
            body:action==='archive' ? previous.body:text(args.body,8000,true),archived:action==='archive',
            createdAt:previous ? previous.createdAt:now,updatedAt:now,revisions:previous ? previous.revisions+1:1,
            updatedBy:{type:'system',displayName:'Clay'},source:observation.source,evidence:observation.evidence,evidenceType:observation.evidenceType,reason:reason});
        }
        var reviewed=Object.assign({},observation,{status:action==='decline'?'declined':'accepted',reviewedAt:now,reason:reason,entryRef:entry && entry.ref});
        var activity=entry ? {id:crypto.randomBytes(12).toString('hex'),ref:entry.ref,title:entry.title,summary:entry.summary,at:now,action:action==='archive'?'archive':(previous?'update':'create'),revision:entry.revisions}:null;
        storage(p.id).append({kind:'user-knowledge',entry:entry,report:reviewed,activity:activity});
        if(activity) {try {deps.onChange(p.id,activity);} catch(error) { /* Saved record survives notification failures. */ }}
        return {entry:entry,report:reviewed};
      }
    };
  }
  return {bind:bind,list:list,read:read,report:report,comment:comment,attention:attention,acknowledge:acknowledge,activity:function(id,args){return page(snapshot(id).activity.slice().reverse(),args);},pendingCount:function(id){return Object.values(snapshot(id).reports).filter(function(r){return r.status==='pending';}).length;}};
}
module.exports={attachUserKnowledgeService:attachUserKnowledgeService};
