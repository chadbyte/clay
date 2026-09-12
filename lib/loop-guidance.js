var MAX_CONTEXT = 12000;

function bounded(value) {
  return typeof value === "string" ? value.substring(0, MAX_CONTEXT) : "";
}

function commonGuidance() {
  return "Begin by clarifying any missing goal, scope, constraints, or target files. Inspect the relevant project code and tests before drafting. Produce a self-contained, goal-oriented brief that names the intended outcome, boundaries, and concrete evidence-based completion checks; every check must identify an observable artifact, behavior, or test result, never vague quality language. Review the brief with the user and refine it before any Start or file write. Do not claim completion without the stated evidence.";
}

function interviewPrompt() {
  return commonGuidance() + " Use the current chat and repository context. This is the built-in interactive Loop interview: after review, call propose_loop with the bounded objective, criteria, and limits. Do not execute, arm permissions, invoke /clay-ralph, require skills, use plan mode, create PROMPT.md/JUDGE.md, or start a run; wait for the human Start action.";
}

function legacyCraftPrompt(options) {
  var opts = options || {};
  var task = bounded(opts.task);
  var directory = bounded(opts.directory);
  var filePlan = opts.simple ? "Create only PROMPT.md; this Simple Loop has no judge." : opts.userJudge ? "Create only PROMPT.md; preserve the user's JUDGE.md and do not replace or edit it." : opts.judgeOnly ? "Create only JUDGE.md for the existing PROMPT.md; do not create or modify PROMPT.md." : "Create PROMPT.md and, when this is a judged Loop, JUDGE.md.";
  return commonGuidance() + " This is legacy scheduled Loop file crafting. " +
    "The files are the durable handoff to a future fresh session: that session starts from the target directory and reads the files from disk, so make each file self-contained and do not rely on this chat's transient context. " +
    "Respect any user-provided files and the target directory; inspect existing files before writing and never overwrite a user-provided file. " + filePlan + " " +
    "A separate judge is applicable only for judged Loops; it evaluates observable evidence from the fresh execution session and must not perform the task itself. Never make an automatic commit.\n\n" +
    "## Task\n" + task + "\n\n## Loop Directory\n" + directory;
}

module.exports = { commonGuidance: commonGuidance, interviewPrompt: interviewPrompt, legacyCraftPrompt: legacyCraftPrompt };
