// Narrow pre-router for Home and Capsule protocol responses kept out of the legacy router.

import { processMessage as processAppMessage } from './app-messages.js';
import { handleHomeMateModelsState, handleHomeMateModelResult } from './home-mate-settings.js';
import { handleHomeMateSessionIdentity, handleHomeDebateTranscript, handleHomeWorkspaceAssignment } from './home-mate-chat.js';
import { handleToolLlmConfigState } from './tool-llm-status.js';
import { handleToolSourceState, handleToolMateAccessState } from './home-tools.js';
import { handleHomeDebatesState } from './home-debates-archive.js';
import { renderProjectWorkspaceAssignment, showProjectWorkspaceAssignmentError } from './project-workspace-assignment.js';
import { isHomeWorkspaceAssignmentMessage } from './workspace-assignment-routing.js';
import { handleSearchClayMessage } from './search-clay-chat.js';
import { handleClaySessionTarget } from './command-palette.js';

export function handleHomeProtocolMessage(msg) {
  if (handleClaySessionTarget(msg)) return true;
  if (isHomeWorkspaceAssignmentMessage(msg)) {
    handleHomeWorkspaceAssignment(msg);
    return true;
  }
  if (msg.type === "project_assignment_proposal" || msg.type === "project_assignment_status") {
    renderProjectWorkspaceAssignment(msg);
    return true;
  }
  if (msg.type === "project_assignment_error") {
    showProjectWorkspaceAssignmentError(msg);
    return true;
  }
  if (msg.type === "home_debates_state") {
    handleHomeDebatesState(msg);
    return true;
  }
  if (msg.type === "home_mate_models_state") {
    handleHomeMateModelsState(msg);
    return true;
  }
  if (msg.type === "home_mate_model_result") {
    handleHomeMateModelResult(msg);
    return true;
  }
  if (msg.type === "home_mate_session_identity") {
    handleHomeMateSessionIdentity(msg);
    return true;
  }
  if (msg.type === "home_debate_proposal") {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "home_debate_proposal_resolved") {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "home_debate_question" || msg.type === "home_debate_question_resolved" || msg.type === "home_debate_event") {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "home_mate_creation_question" || msg.type === "home_mate_creation_question_resolved" || msg.type === "home_mate_creation_proposal" || msg.type === "home_mate_creation_proposal_resolved") {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "home_mate_error" && /^question_/.test(msg.code || "")) {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "tool_llm_config_state") {
    handleToolLlmConfigState(msg);
    return true;
  }
  if (msg.type === "tool_source_state") {
    handleToolSourceState(msg);
    return true;
  }
  if (msg.type === "tool_mate_access_state") {
    handleToolMateAccessState(msg);
    return true;
  }
  return false;
}

export function processMessage(msg) {
  var searchHandled = handleSearchClayMessage(msg);
  if (searchHandled && (msg.type === "home_clay_activity" || msg.type === "home_mate_stopping" || msg.type.indexOf("home_mate_permission_") === 0)) return;
  if (handleHomeProtocolMessage(msg)) return;
  processAppMessage(msg);
}
