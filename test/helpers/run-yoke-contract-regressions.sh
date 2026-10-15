#!/bin/sh
# Guarded production-path regression set; never launch providers or fixture commits.
set -eu
cd "$(dirname "$0")/../.."
TASK_TEST_ROOT=$(mktemp -d /tmp/clay-yoke-regressions.XXXXXX)
trap 'rm -rf "$TASK_TEST_ROOT"' EXIT HUP INT TERM
export HOME="$TASK_TEST_ROOT" CLAY_HOME="$TASK_TEST_ROOT/.clay" CODEX_HOME="$TASK_TEST_ROOT/.codex"
/Users/chad/.nvm/versions/node/v22.22.1/bin/node \
  --require ./test/helpers/yoke-no-provider-processes.cjs \
  --test --test-force-exit --test-skip-pattern='runtime dependency' \
  test/codex-image-generation.test.js \
  test/yoke-muse-adapter.test.js \
  test/yoke-muse-skills.test.js \
  test/yoke-muse-queue.test.js \
  test/message-delivery.test.js \
  test/project-pending-message-queue.test.js \
  test/project-pending-message-queue-lifecycle.test.js \
  test/vendor-installation-state.test.js \
  test/yoke-query-contract.test.js \
  test/yoke-runtime-services.test.js \
  test/yoke-executable-discovery.test.js \
  test/antigravity-adapter.test.js \
  test/codex-app-server-routing.test.js \
  test/yoke-settings-controller.test.js \
  test/sdk-bridge-delivery.test.js \
  test/sdk-bridge-permission-policy.test.js \
  test/yoke-user-input.test.js \
  test/yoke-vendor-registry.test.js \
  test/claude-transport-lifecycle.test.js \
  test/session-permission-mode.test.js \
  test/yoke-adapter-contract.test.js \
  test/yoke-complete-once.test.js \
  test/yoke-title-query.test.js \
  test/yoke-skill-discovery.test.js \
  test/session-skill-catalog.test.js \
  test/clay-final-integration.test.js \
  test/clay-product-control.test.js \
  test/mate-scheduling.test.js \
  test/mcp-catalog-invariants.test.js \
  test/project-tool-control-mcp.test.js \
  test/tool-control-mcp-server.test.js \
  test/pair-lifecycle.test.js \
  test/ask-user-mcp-server.test.js \
  test/claude-permission-controls.test.js \
  test/codex-dynamic-tools.test.js \
  test/codex-idle-recovery.test.js \
  test/codex-recovery-admission.test.js \
  test/sdk-response-recovery.test.js \
  test/clay-runtime-controls.test.js \
  test/clay-mate-chat.test.js \
  test/issues-launch-hardening.test.js \
  test/scheduled-task-refinements.test.js \
  test/vendor-login-flow.test.js \
  test/vendor-login-browser.test.js \
  test/mcp-source-policy.test.js \
  test/mcp-source-discovery.test.js \
  test/rate-limit-vendor.test.js \
  test/context-view-preferences.test.js \
  test/codex-rate-limits.test.js \
  test/permission-mode-ui.test.js \
  test/mcp-permission-mode-ui.test.js \
  test/claude-sdk-options.test.js \
  test/tool-llm.test.js \
  test/project-tool-llm-runtime.test.js \
  test/session-hygiene.test.js \
  test/os-user-diagnostics.test.js \
  test/os-users-compatibility.test.js \
  test/codex-os-user-isolation.test.js \
  test/antigravity-usage-baseline.test.js \
  test/default-ai-runtime.test.js \
  test/session-handoff-discovery.test.js \
  test/kiro-adapter-query.test.js \
  test/kiro-adapter-init.test.js \
  test/kiro-acp-routing.test.js \
  test/acp-adapter.test.js \
  test/vendor-cancellation.test.js \
  test/clay-skill-storage.test.js \
  test/worker-response-schema.test.js \
  test/mcp-connections.test.js \
  test/plan-feedback-user-message.test.js \
  test/home-notification-suppression.test.js \
  test/session-spawn.test.js
