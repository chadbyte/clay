# Responses, plans, and task progress

A response can contain prose, tool activity, a plan, questions, and task progress. Read each according to what it proves. A plan describes intended work; a tool result records an attempted action; neither alone establishes that the whole request is complete.

## Review a response

1. Read the outcome stated by the agent.
2. Expand relevant tool activity for the action or command.
3. Check actual output, failures, and exit results.
4. Inspect changed files or the external destination where appropriate.
5. Compare the result with your requested acceptance criteria.

For example, “I will run the tests” is a plan. A completed command with a successful exit is test evidence. A passing narrow check may still leave browser behavior unverified.

Tool cards can be collapsed to keep a long transcript readable. Expand the cards that substantiate a claim rather than inferring success from an icon or an agent's summary.

## Plans and todos

Providers can expose plans or todo updates in the conversation. These help explain sequencing and progress. Availability and rendering depend on the runtime.

Read an unchecked item as remaining work. A checked item reflects the agent's reported task state; inspect the supporting result for important actions. Ask for a revised plan if the scope changes substantially.

There is no separate universal Calendar or Todo workbench implied by these transcript features. Use [Scheduled Tasks](/docs/scheduled-tasks) for timed project execution and [Issues](/docs/issues) for actionable project backlog.

## Questions and reviews

A structured question asks you for missing information. Answer in the card, including a free-text clarification where needed. A permission/review card asks about a specific action and target. Read it before approving.

If work appears idle, look for an unanswered question, pending permission, rate-limit notice, or paused queue. Sending another ordinary message may only add pending work.

## Preserve useful results

Keep maintained reference material in [Knowledge](/docs/knowledge-documents), durable task outcomes in [Project Logs](/docs/project-logs), and reminders in [Notes](/docs/notes). A transcript remains evidence of the exchange, but it is not automatically a maintained manual.

For incomplete or uncertain execution, ask the agent to state what actually happened and what remains. See [Stop and recovery](/docs/stop-recovery) and [Usage and context](/docs/usage-and-context).
