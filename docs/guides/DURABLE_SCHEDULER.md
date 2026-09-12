# Durable Scheduler Engine

`lib/durable-scheduler.js` is the common server-owned engine for future due-work services. It is separate from `lib/scheduler.js`, which remains the legacy per-project Loop registry.

## Contract

- A producer enqueues a one-shot job with a stable job id, unique idempotency key, type, due timestamp, payload, and explicit owner, project, and target identity.
- Enqueue, cancellation, queued-job replacement, claims, execution metadata, receipts, and terminal outcomes are atomically persisted before the corresponding state is exposed or dispatched. Atomic replacements fsync the file and sync the parent directory where the platform supports it.
- One handler may be registered for each job type. A handler may provide a side-effect-free eligibility check so busy targets stay queued before claim. Due jobs whose handler is not registered or eligible remain queued, including during startup.
- Dispatch observes global and per-owner concurrency limits and rotates owner priority between selections.
- Replayed enqueue calls with the same idempotency key return the original job. A job is never dispatched twice within one live engine instance.
- Production and development use separate `prod` and `dev` stores under the Clay config directory.
- A lock file rejects a second live writer for the same store. Fresh acquisition and stale-lock recovery share an atomic acquisition guard so neither can replace a lock created mid-recovery. A guard left by a crash fails closed instead of attempting recursively unsafe recovery. Recovery requires confirming that no scheduler acquisition is active, then removing the empty `<store>.lock.acquire` directory before restarting. Invalid or unreadable persisted data stops initialization; it is never treated as an empty queue.

## Recovery and delivery limits

Persisted jobs that were still queued recover as queued. Jobs found in `claimed` or `running` state are changed to `interrupted`, because an external side effect may already have occurred. They are not retried automatically.

This engine does not promise exactly-once external side effects. A handler should persist correlation data through `recordMetadata()` or `recordReceipt()` before performing or acknowledging downstream work. Consumers can inspect the persisted receipt with `getReceipt(jobId)` and decide how to reconcile interrupted work.

Any persistence failure makes the live engine unhealthy and stops further dispatch. Shutdown clears timers and durably marks live executions interrupted when storage remains available. Explicit server teardown and the HTTP server's `close` event share one idempotent scheduler shutdown.

## Scheduled project messages

Project chat scheduled messages use `project-scheduled-messages.js` as a producer and handler. Their stable target is the persisted provider `cliSessionId`, never the restart-local numeric id. Queue state is rehydrated from this store after history replay; historical queue events from versions before this integration are not migrated because they cannot prove whether their external prompt was already delivered.

Cancellation, replacement, and Send now mutate the same queued job. A busy session remains queued until its current query finishes. Execution rechecks the authenticated actor, current owner, project/session access, target mode, and OS-user identity before recording a dispatch receipt and calling the SDK. Project shutdown unregisters the handler but retains queued jobs for restart; session deletion cancels its queued job.

## Scope

The engine does not parse recurring schedules. Recurring services are responsible for validating their own recurrence rules and enqueueing stable occurrences. Legacy Loop actions remain in `lib/scheduler.js`; this migration covers only one-shot project chat messages.
