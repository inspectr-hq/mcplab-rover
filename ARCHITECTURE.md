# MCPLab Rover architecture

## Central matching with one explicit lease

This document is the canonical architecture reference for MCPLab and Rover queue execution. Read it before changing the queue WebSocket protocol, scheduler, or managed-assignment lifecycle.

The core rule is:

> MCPLab decides which queued job should run. Rover executes only the one job it has explicitly leased.

Rover is a browser worker, not a second scheduler. The Rover popup is a view of worker state, not a source of truth for MCPLab jobs.

## Ownership

MCPLab owns durable job and scenario existence, global queue ordering, provider matching, aggregate run status, lease records and expiry, stop commands, and durable results.

Rover background owns one WebSocket worker connection, provider registration, one execution lease, the selected browser tab, browser interaction, response capture, cancellation, and a recoverable execution mirror in `chrome.storage.session`.

The popup and injected panel render the execution mirror and manage local/manual queues. They must not infer that an MCPLab job disappeared because the current tab has another provider.

## Two queue concepts

1. **MCPLab assignment queue:** all jobs waiting to be matched or executed. This is durable and authoritative.
2. **Rover execution mirror:** at most one leased assignment, including its scenarios and browser state. This is recoverable session state.

When no matching provider is registered, the job stays in MCPLab's queue. Rover may show `Waiting for MCPLab to match a queued job to this provider tab`, but must not mark the job failed or fabricate a local assignment.

## Lifecycle

```text
MCPLab job: queued -> offered -> accepted -> running -> completed|error|stopped
                         |                       |
                         +-- reject/expiry ------+
```

An offer has a unique `leaseId` and expiry. Receiving an assignment is not ownership. Rover persists and validates the offer, then sends `assignment_accept`. A rejected or expired offer returns to `queued` without deleting completed scenario results.

Rover and MCPLab must enforce these invariants:

- one worker has zero or one active lease;
- one job has zero or one active lease;
- stale lease IDs cannot renew, complete, stop, or release another lease;
- a second offer cannot overwrite a non-terminal Rover mirror;
- terminal completion releases the lease exactly once;
- late results cannot mutate a newer queue item, request, session, or lease.

## Central matching

MCPLab runs matching when a job is queued, a Rover registers or changes provider, or a lease is rejected, released, or expires.

For each idle worker, inspect queued jobs in order and skip jobs whose provider or provider revision does not match. Offer the oldest compatible job. This prevents a ChatGPT job from blocking Claude or Copilot, while scenarios within one assignment remain sequential.

Provider changes are availability updates, not cancellation requests. A running lease remains bound to its original tab and provider. The new provider is eligible for the next match after the current lease is released.

## WebSocket protocol

Keep `protocolVersion: 2`. Add lease fields and advertise the `assignment_lease` capability alongside `scenario_control`.

Registration:

```json
{
  "type": "register",
  "protocolVersion": 2,
  "capabilities": ["scenario_control", "assignment_lease"],
  "provider": "chatgpt-com",
  "pageUrl": "https://chatgpt.com/",
  "extensionVersion": "..."
}
```

Assignment keeps its existing message type and adds optional `leaseId` and `leaseExpiresAt`:

```json
{
  "type": "assignment",
  "jobId": "run-...",
  "leaseId": "lease-...",
  "leaseExpiresAt": "2026-09-15T12:00:30.000Z",
  "agent": { "provider": "chatgpt-com", "providerRevision": "..." },
  "scenarios": [...],
  "newConversationBetweenScenarios": true
}
```

Lease messages:

```json
{ "type": "assignment_accept", "jobId": "...", "leaseId": "...", "tabId": 123 }
{ "type": "assignment_reject", "jobId": "...", "leaseId": "...", "reason": "provider_unavailable|provider_mismatch|stale_provider|busy|invalid_assignment|expired_assignment", "retryable": true }
{ "type": "lease_renew", "jobId": "...", "leaseId": "...", "leaseExpiresAt": "..." }
{ "type": "lease_release", "jobId": "...", "leaseId": "...", "reason": "completed|error|stopped|connection_lost|provider_unavailable|provider_mismatch|stale_provider|bound_tab_unavailable|terminal_error" }
{ "type": "lease_action_ack", "jobId": "...", "leaseId": "...", "action": "complete|release" }
{ "type": "lease_unknown", "jobId": "...", "leaseId": "...", "reason": "unknown_lease" }
```

Add optional `leaseId` to progress, stage, scenario-status, and completion messages. Renew at half the lease duration while active. Release exactly once on terminal completion, error, or stop.

## Rover execution rules

Rover persists `leaseId`, `leaseExpiresAt`, `leaseState`, `managedPhase`, provider revision, bound tab, scenario statuses, session IDs, request IDs, and cancellation timestamps. Local queues have no lease and remain editable.

For a lease-bearing assignment:

1. serialize assignment handling with the queue operation serializer;
2. reject malformed, stale-provider, not-ready, or busy offers without replacing the current mirror;
3. persist the offer before acknowledging it;
4. accept only after provider and revision validation;
5. bind accepted work to its selected tab;
6. never rebind an accepted or running lease because the active tab changed;
7. renew while active;
8. reconcile the lease after reconnect before resuming;
9. release it once at terminal aggregate completion.

Provider matching and provider readiness are separate. Matching checks provider identity and revision. Readiness checks the composer, response tracker, and required new-conversation behavior. A pre-execution readiness failure is retryable and should reject or expire the offer. An unexpected failure after execution starts is a terminal scenario error with diagnostic text.

## Scenarios and conversations

One assignment still contains all scenarios and runs them sequentially. Preserve `newConversationBetweenScenarios`:

- false continues the same provider conversation;
- true invokes the provider's new-conversation action before the next scenario.

MCPLab may also set `newConversationBeforeStart` on an assignment. Rover must invoke the
provider's new-conversation action and wait for provider readiness before starting the first
scenario in that assignment. This assignment-level setting is separate from Rover's local
queue setting and applies across separate MCPLab evaluation jobs.

Stopping an active scenario cancels its browser request and MCPLab session, marks only that scenario stopped, preserves prior results, and advances to the next queued scenario. Stopping the whole job marks active work stopped and releases the lease.

## Error handling

Retryable before execution:

- provider tab is not matched;
- provider revision is stale;
- content script is unavailable;
- Rover is busy.

These cases reject or expire the offer and leave the MCPLab job queued. They must not send aggregate `complete`.

Terminal after execution begins:

- submission fails after acceptance;
- response capture fails or is unexpectedly cancelled;
- MCPLab completion returns an evaluation error;
- provider navigation or DOM failure prevents completion.

These cases send diagnostic `scenario_status`, preserve the failed scenario, complete the aggregate job with an error outcome when appropriate, and release the lease.

## Compatibility

Rover protocol v2 requires `assignment_lease`. Registrations that do not advertise it are rejected. Rover has not been released, so there is no v1 managed-assignment compatibility path. Local queues and normal MCPLab agent execution remain unchanged.

Capability negotiation must be explicit. Do not infer lease support from a hardcoded provider or from a missing `registered.capabilities` field.

## Debug and UI states

Rover debug output should include registration provider and revision, capabilities, offer and lease IDs, acceptance or rejection reason, bound tab, expiry and renewal, scenario result and cancellation source, release reason, and reconnect reconciliation.

The UI should distinguish:

- `Waiting for a matching MCPLab job`;
- `Assignment offered, preparing provider`;
- `Running scenario 2 of 3`;
- `Paused, retry available`;
- `Completed`;
- `Stopped`.

An empty provider view must not represent a known waiting assignment.

## Guardrails

- Inspect both repositories before changing the wire contract.
- Add shared protocol types before handlers.
- Serialize assignment, registration, stop, result, and lease operations.
- Persist state before sending an acknowledgement.
- Validate job ID, lease ID, queue item ID, request ID, and session ID on asynchronous results.
- Do not complete a job for a pre-accept provider mismatch.
- Keep Manual mode and local queue editing independent from managed leases.
- Add a regression test for every lifecycle transition.

The dated implementation plan is [here](docs/plans/2026-09-15-central-matching-explicit-lease.md).
