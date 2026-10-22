function normalized(value) { return String(value || "").toLowerCase().trim(); }

function scoreDocument(document, query) {
  var normalizedQuery = normalized(query);
  var title = normalized(document.title);
  var slug = normalized(document.slug);
  var description = normalized(document.description);
  var body = normalized(document.searchText);
  var score = 0;
  if (title === normalizedQuery) score += 10000;
  else if (title.includes(normalizedQuery)) score += 5000;
  if (slug === normalizedQuery) score += 9000;
  else if (slug.includes(normalizedQuery)) score += 4500;
  if (description.includes(normalizedQuery)) score += 100;
  if (body.includes(normalizedQuery)) score += 1;
  return score;
}

export function rankDocuments(documents, query) {
  var normalizedQuery = normalized(query);
  if (!normalizedQuery) return documents;
  return documents.map(function (document, index) { return { document: document, index: index, score: scoreDocument(document, normalizedQuery) }; })
    .filter(function (entry) { return entry.score > 0; })
    .sort(function (left, right) { return right.score - left.score || left.index - right.index; })
    .map(function (entry) { return entry.document; });
}
