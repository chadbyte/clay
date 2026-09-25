function attachProposalRunner(ctx) {
  function resumeDriver(session, text) {
    var sdk = ctx.getSdk();
    if (!sdk) return Promise.reject(new Error("SDK bridge is not ready"));
    ctx.sm.sendAndRecord(session, { type: "user_message", text: text, _internal: true });
    session.sentToolResults = {};
    if (!session.isProcessing) {
      session.isProcessing = true;
      ctx.onProcessingChanged();
      ctx.sm.sendToSession(session, { type: "status", status: "processing" });
    }
    if (sdk.pushMessage(session, text)) return Promise.resolve();
    return Promise.resolve(sdk.startQuery(session, text, undefined, ctx.getLinuxUserForSession(session)));
  }

  function parseResult(result) {
    if (!result || result.isError || !result.content || !result.content[0]) {
      return { status: "error", error: "Split Worker execution failed." };
    }
    try { return JSON.parse(result.content[0].text); }
    catch (error) { return { status: "error", error: result.content[0].text || "Split Worker execution failed." }; }
  }

  async function runWorker(session, proposal) {
    var result = parseResult(await ctx.sendToPartner({ message: proposal.message, wait: true,
      timeoutSeconds: 900, workerId: proposal.workerId }, session));
    ctx.updateProposal(session, proposal, { status: result.status === "complete" ? "completed" : result.status || "error",
      resultPreview: result.response ? result.response.slice(0, 1200) : "", error: result.error || null });
    var followup;
    if (result.status === "complete") {
      followup = "[Split Worker execution completed]\nReview and verify the Split Worker's result. The Split Worker session remains available: if the implementation needs corrections or additional edits, send a follow-up with send_to_partner instead of taking over the Split Worker-owned files yourself. If that Split Worker is no longer available, keep the work in the visible Split Worker flow and use send_to_partner again after the stale pair is removed; never substitute a background Sub-agent.\n\n" + (result.response || "The Split Worker completed without a text summary.");
    } else if (result.status === "interrupted") {
      followup = "[Split Worker execution interrupted]\nThe Split Worker stopped mid-turn. Its work is PARTIAL and unverified — do not treat it as finished. Check partner_status before deciding next steps; this result alone does not identify who interrupted it. If the human stopped it, do not retry until a new human Driver message. Otherwise continue within the user's authorized task.";
    } else if (result.status === "running") {
      followup = "[Split Worker execution is still running]\nUse read_partner to inspect progress before completing the task.";
    } else {
      followup = "[Split Worker execution failed]\nThe existing Split Worker may still be reusable. Inspect partner_status and send a narrower follow-up with send_to_partner when the Worker and pair still exist; do not replace it merely because its task or transport failed. Retry replacement only when the replacement transaction reports that no new Worker was created and the failure is explicitly safe to retry.\n\n" + (result.error || result.response || "Unknown Split Worker error.");
    }
    followup += "\n\nWorker handle for this execution: workerId=" + proposal.workerId +
      ". Use this workerId for follow-up operations while it remains configured. Call partner_status without workerId to discover current Worker handles after replacement or reconnect.";
    await resumeDriver(session, followup);
  }

  return { resumeDriver: resumeDriver, runWorker: runWorker };
}

module.exports = { attachProposalRunner: attachProposalRunner };
