var userInput = require('./yoke/user-input');
var TYPES = ['linear', 'issue', 'pr'];
var GUIDANCE = ' Primary work choices belong to the user. Linking and refreshing never replace a saved primary. Only when the user explicitly requests a primary change, call the link tool with primary:true; Clay presents the exact change for human confirmation. Never request a primary change proactively. Unlinking a saved primary is refused; ask the user to choose a replacement first.';
function kind(link) { return link.provider === 'linear' ? 'linear' : link.kind; }
function selected(session, type) { return (session.workPrimary || {})[type] || ''; }
function find(session, url) {
  return (session.githubLinks || []).concat(session.linearLinks || []).find(function (link) { return link.url.toLowerCase() === String(url).toLowerCase(); });
}
function guardUnlink(session, url) {
  if (TYPES.some(function (type) { return selected(session, type).toLowerCase() === url.toLowerCase(); })) throw new Error('This is a user-selected primary. Choose a replacement before unlinking it.');
}
function setPrimary(sm, session, url) {
  var link = find(session, url);
  if (!link || TYPES.indexOf(kind(link)) < 0) throw new Error('Choose an item already linked to this session.');
  var previous = session.workPrimary;
  session.workPrimary = Object.assign({}, previous);
  session.workPrimary[kind(link)] = link.url;
  try { if (sm.saveSessionFile(session) === false) throw new Error('Could not save primary work item.'); }
  catch (error) { session.workPrimary = previous; throw error; }
  sm.broadcastSessionList();
  return session.workPrimary;
}
async function requestPrimary(ctx, session, url, authorize) {
  var link = find(session, url);
  if (!link) throw new Error('Link the work item before choosing it as primary.');
  var type = kind(link), previous = selected(session, type), owner = session.ownerId;
  if (previous.toLowerCase() === link.url.toLowerCase()) return;
  var result = await userInput.dispatchUserInput(ctx.userInput && ctx.userInput(session), { questions: [{
    id: 'primary', header: 'Primary work', question: 'Set ' + link.url + ' as the primary ' + (type === 'linear' ? 'Linear issue' : type === 'pr' ? 'GitHub PR' : 'GitHub issue') + ' for this conversation?',
    options: [{ label: 'Set primary' }, { label: 'Keep current' }], allowOther: false,
  }] }, { source: 'work-primary', signal: session.abortController && session.abortController.signal });
  if (result.status !== 'submitted' || !result.answers.primary || result.answers.primary[0] !== 'Set primary') throw new Error('Primary selection was not changed.');
  authorize(session);
  if (session.taskStopRequested) throw new Error('Primary selection was not changed after Stop.');
  if (owner !== session.ownerId || selected(session, type) !== previous) throw new Error('The owner or primary selection changed. Please retry.');
  setPrimary(ctx.sm, session, url);
}
function handleMessage(ctx, ws, msg, authorize) {
  if (msg.type !== 'session_work_primary_set') return false;
  var response = { type: 'session_work_primary_result', requestId: msg.requestId, projectSlug: ctx.projectSlug, sessionId: msg.sessionId };
  try {
    var session = ctx.sm.sessions.get(msg.sessionId);
    if (!ctx.canAccess(ws) || !session || !ctx.canRefresh(ws, session)) throw new Error('Only the session owner can choose primary work.');
    authorize(session);
    response.workPrimary = setPrimary(ctx.sm, session, msg.url);
  } catch (error) { response.error = error.message; }
  ctx.sendTo(ws, response);
  return true;
}
module.exports = { GUIDANCE: GUIDANCE, guardUnlink: guardUnlink, requestPrimary: requestPrimary, handleMessage: handleMessage, setPrimary: setPrimary };
