# Responses, plans, and task progress

A response combines the agent's explanation with its work: tool activity, plans, questions, and progress. Start with the summary, then open the details relevant to your task.

## Review a response

1. Read the outcome stated by the agent.
2. Expand relevant tool activity for the action or command.
3. Check actual output, failures, and exit results.
4. Inspect changed files or the external destination where appropriate.
5. Compare the result with your requested acceptance criteria.

For example, “I will run the tests” is a plan. A completed command with a successful exit is test evidence. A passing narrow check may still leave browser behavior unverified.

Tool cards can be collapsed to keep the transcript readable. Expand a command card to see its output or understand a failure.

[![Expanded Bash activity showing npm test and the sample application's test output.](/images/manual/tool-output.webp)](/images/manual/tool-output.webp)

*Opening the command card reveals what ran and its output. Here the sample tests check creating a note and rejecting an empty title.*

## Explore options inside an answer

When changing alternatives, priorities or assumptions would usefully change a result or explanation, agents are instructed to favour an interactive exploration in the answer. The choice still depends on the agent and the information available. You do not need to request a special format. For example, a rollout comparison might let you switch between a pilot and an all-at-once release, with the recommendation and tradeoffs changing together. Simple answers still work well as ordinary text.

Read the summary, then try the available choices, tabs or sliders. Each answer can use a different layout suited to the question. The controls use information already supplied in that answer; changing them does not send a message, call a model or fetch updated facts. To continue with a particular choice, tell the agent in the composer. Selecting an option does not approve an action or answer a pending question card.

The response stays in conversation history. Your exploratory selections are temporary and reset to the original defaults when you reopen it. **Response source** reveals the underlying response data. If the interactive view cannot load, the summary and source remain available. If your sign-in has expired, sign in again and reload the conversation before retrying the view. You can also ask the agent to explain the alternatives in plain text.

## Plans and todos

Providers can expose plans or todo updates in the conversation. These help explain sequencing and progress. Availability and rendering depend on the runtime.

Read an unchecked item as remaining work. A checked item reflects the agent's reported task state; inspect the supporting result for important actions. Ask for a revised plan if the scope changes substantially.

Use [Scheduled Tasks](/docs/scheduled-tasks) to run project work at a particular time, or [Issues](/docs/issues) to track work beyond this conversation.

## Questions and reviews

A structured question asks you for missing information. Answer in the card, including a free-text clarification where needed. A permission/review card asks about a specific action and target. Read it before approving.

If work appears idle, look for an unanswered question, pending permission, rate-limit notice, or paused queue. Sending another ordinary message may only add pending work.

## Preserve useful results

Keep project reference material in repository documents, durable task outcomes in [Project Logs](/docs/project-logs), and reminders in [Notes](/docs/notes). A Mate can keep its reference documents in [Knowledge](/docs/knowledge-documents).

For incomplete or uncertain execution, ask the agent to state what actually happened and what remains. See [Stop and recovery](/docs/stop-recovery) and [Usage and context](/docs/usage-and-context).
