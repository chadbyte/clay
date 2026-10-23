# Choose models and providers

A provider runtime is the coding-agent application Clay Studio launches, such as Claude Code or Codex. The model is the AI you select inside that application. Installing a provider does not make every model available, and choosing a model does not change provider accounts.

## Choose a model

1. Select **New session** in the intended folder.
2. Choose an installed provider and select **Create**.
3. Open the session's model control.
4. Wait for the model catalog.
5. Select an offered model and wait for confirmation.
6. Choose reasoning effort if that model exposes it.

Use **Settings → Personal → AI providers → Coding agents** to inspect installation status for all registered providers, review supported Claude Code or Codex installation, and open supported sign-in. Installation, authentication and a tested request are separate states. The provider picker reflects discovery in the server environment. If a runtime is installed but cannot authenticate, follow [Provider authentication](/docs/provider-auth).

The model picker distinguishes **Loading models…**, **Couldn’t load models**, and **No models available**. Use **Retry** to request the catalog again. If selection fails, read the error and check which model remains selected before submitting a large task.

## Reasoning effort

Reasoning effort controls how much effort a supported model spends working through a request. Models may offer low, medium, high, or additional levels. Use the actual options for the selected model rather than copying another provider's setting. Higher effort can affect latency and usage; it does not guarantee correctness.

A runtime without an effort control can still perform work. Clay Studio does not invent an equivalent option. [Scheduled Tasks](/docs/scheduled-tasks) require explicit model choices for both members of their execution pair.

## Continue with another provider

Changing a model and handing off to another provider are different operations. A handoff needs the goal, current changes, verification, unresolved questions, and next action. Hidden reasoning and every provider-native feature do not automatically transfer.

Example: “Review the current three-file diff for error handling. The relevant check passed. Do not edit or commit.”

## Resolve failures

An empty catalog can indicate startup or authentication problems. A catalog that loads followed by a failed request can indicate model entitlement, exhausted usage, or a runtime error. Read the actual failure before retrying. Repeated selection cannot fix expired authentication.

Permission mode is independent of model and effort. Check [Permissions](/docs/permissions), [Usage and context](/docs/usage-and-context), and [Provider capabilities](/docs/provider-capabilities) before a long task.
