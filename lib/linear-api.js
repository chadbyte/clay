var FIELDS = 'id identifier title url state { name type }';
function parseReference(value) {
  var match = typeof value === 'string' && value.match(/^https:\/\/linear\.app\/([a-zA-Z0-9_-]+)\/issue\/([a-zA-Z][a-zA-Z0-9_]*-[1-9][0-9]*)(?:\/[^?#\s]*)?(?:[?#][^\s]*)?$/);
  if (!match) throw new Error('Use a Linear issue URL, such as https://linear.app/team/issue/ENG-123/title.');
  return { workspace: match[1], identifier: match[2].toUpperCase(), url: 'https://linear.app/' + match[1] + '/issue/' + match[2].toUpperCase() };
}
async function query(key, document, variables, fetcher) {
  if (!key) throw new Error('Connect Linear in Settings → Integrations first.');
  var response = await (fetcher || fetch)('https://api.linear.app/graphql', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: document, variables: variables || {} }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? 'Linear rate limit reached. Try again later.' : 'Linear is unavailable. Check your connection and issue access.');
  var reader = response.body.getReader(), chunks = [], length = 0;
  try {
    while (true) {
      var next = await reader.read(); if (next.done) break;
      length += next.value.length;
      if (length > 1024 * 1024) throw new Error('Linear response is too large.');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel(); }
  var data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || data.errors || !data.data) throw new Error('Could not read Linear data. Check your key and issue access.');
  return data.data;
}
function summary(issue) {
  if (!issue || typeof issue.title !== 'string' || !issue.id || !issue.state) throw new Error('Linear issue is unavailable.');
  var ref = parseReference(issue.url);
  if (ref.identifier !== issue.identifier) throw new Error('Linear returned a different issue.');
  return Object.assign(ref, { id: issue.id, provider: 'linear', kind: 'issue', title: issue.title.slice(0, 200),
    state: String(issue.state.type || 'unknown').slice(0, 40), stateName: String(issue.state.name || 'Unknown').slice(0, 80), checkedAt: Date.now() });
}
async function readIssue(key, url, cursor, run) {
  var ref = parseReference(url);
  var data = await (run || query)(key, 'query ClayIssue($id: String!, $after: String) { issue(id: $id) { ' + FIELDS + ' description comments(first: 30, after: $after) { nodes { id body createdAt user { name } } pageInfo { hasNextPage endCursor } } } }', { id: ref.identifier, after: cursor || null });
  var item = summary(data.issue);
  if (item.url.toLowerCase() !== ref.url.toLowerCase()) throw new Error('This issue belongs to a different Linear workspace.');
  return Object.assign(item, { description: String(data.issue.description || '').slice(0, 100000), comments: data.issue.comments.nodes.map(function (comment) {
    return { id: comment.id, body: String(comment.body || '').slice(0, 20000), createdAt: comment.createdAt, author: comment.user && comment.user.name || 'Linear user' };
  }), pageInfo: data.issue.comments.pageInfo });
}
async function readReference(key, url, run) {
  var ref = parseReference(url);
  var data = await (run || query)(key, 'query ClayIssueStatus($id: String!) { issue(id: $id) { ' + FIELDS + ' } }', { id: ref.identifier });
  var item = summary(data.issue);
  if (item.url.toLowerCase() !== ref.url.toLowerCase()) throw new Error('This issue belongs to a different Linear workspace.');
  return item;
}
async function search(key, text, run) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2048) throw new Error('Enter an issue URL, identifier or title.');
  text = text.trim();
  if (/^https:\/\//.test(text)) return [await readReference(key, text, run)];
  if (/^[a-zA-Z][a-zA-Z0-9_]*-[1-9][0-9]*$/.test(text)) {
    var exact = await (run || query)(key, 'query ClayIssueStatus($id: String!) { issue(id: $id) { ' + FIELDS + ' } }', { id: text.toUpperCase() });
    return [summary(exact.issue)];
  }
  if (text.length > 200) throw new Error('Keep title searches under 200 characters.');
  var data = await (run || query)(key, 'query ClayIssues($text: String!) { issues(first: 20, filter: { title: { containsIgnoreCase: $text } }) { nodes { ' + FIELDS + ' } } }', { text: text });
  return data.issues.nodes.map(summary);
}
module.exports = { parseReference: parseReference, query: query, summary: summary, readIssue: readIssue, readReference: readReference, search: search };
