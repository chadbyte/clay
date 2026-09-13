// Append-only comment and review projection for Project Issues.

var STATUS_PENDING = "pending";
var STATUS_CLARIFICATION = "clarification-needed";
var STATUS_INCORPORATED = "incorporated";
var STATUS_DECLINED = "declined";
var ACTIONS = ["incorporate", "clarify", "decline"];
var ACTION_STATUS = { incorporate: STATUS_INCORPORATED, clarify: STATUS_CLARIFICATION, decline: STATUS_DECLINED };

function comments(chain, maxComments) {
  var byId = {};
  var out = [];
  var limit = maxComments || 200;
  for (var i = 0; i < chain.length; i++) {
    var record = chain[i];
    if (record.op !== "comment" || out.length >= limit) continue;
    var comment = { id: record.id, body: record.body || "", at: record.at || 0, author: record.author || null,
      status: STATUS_PENDING, review: null };
    byId[record.id] = comment;
    out.push(comment);
  }
  for (var j = 0; j < chain.length; j++) {
    var review = chain[j];
    var incorporated = review.op === "revision" && review.review ? review.review : review;
    if ((review.op !== "review" && review.op !== "incorporate" && !review.review) || !byId[incorporated.commentId] || !ACTION_STATUS[incorporated.action]) continue;
    if (byId[incorporated.commentId].review) continue;
    byId[incorporated.commentId].status = ACTION_STATUS[incorporated.action];
    byId[incorporated.commentId].review = { action: incorporated.action, response: incorporated.response || "", at: review.at || 0,
      reviewer: review.author || null, revision: incorporated.revision || null };
  }
  return out;
}

function pending(list) {
  return (list || []).filter(function (item) { return item.status === STATUS_PENDING; });
}

module.exports = { STATUS_PENDING: STATUS_PENDING, STATUS_CLARIFICATION: STATUS_CLARIFICATION,
  STATUS_INCORPORATED: STATUS_INCORPORATED, STATUS_DECLINED: STATUS_DECLINED,
  ACTIONS: ACTIONS, comments: comments, pending: pending };
