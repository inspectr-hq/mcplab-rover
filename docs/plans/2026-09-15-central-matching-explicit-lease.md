# Central matching with one explicit Rover lease

## Goal

Keep MCPLab authoritative for queued assignments and aggregate run status, while Rover acts as a single execution worker. MCPLab must dispatch only one provider-matching assignment to a Rover connection at a time. The assignment is protected by an explicit lease, so an assignment is never considered owned by Rover merely because it was offered over WebSocket.

This requires coordinated changes in MCPLab and Rover. A Rover-only change cannot implement central matching, because only MCPLab can see all queued jobs and choose the next matching provider.

## Confirmed decisions

- MCPLab queue state is cleared on MCPLab restart. Rover must clear persisted managed assignment and lease metadata when reconnect reconciliation reports no active assignment.
- Offer expiry is 30 seconds, renewal runs every 15 seconds, and disconnect grace is 30 seconds.
- A disconnect after acceptance requeues the non-terminal job after the grace period.
- Provider revisions require an exact match when both sides provide a revision. Missing revisions remain compatible for legacy clients.
- An offered assignment is shown as `starting`.
- Stopping an offered or accepted job marks it `stopped`; it is never requeued.
- Rover shows queued evaluations waiting for MCPLab matching, including provider information to encourage switching providers.
- Lease support is enabled automatically when both sides advertise `assignment_lease`. MCPLab may retain an emergency kill switch, enabled by default.

## Non-goals

- Do not dispatch every queued job into Rover. Rover has one execution slot and one managed queue mirror.
- Do not make Rover authoritative for assignment existence, aggregate run status, or retry ordering.
- Do not cancel a queued MCPLab job when its provider tab is absent.
- Do not change the existing Manual mode.
- Do not change `newConversationBetweenScenarios` semantics.

## Worker and assignment model

MCPLab owns the job lifecycle:

```text
queued -> offered -> accepted -> running -> completed|error|stopped
             |                       |
             +-- reject/expiry ------+
```

An offered assignment has a unique `leaseId` and an expiry time. It remains queued for scheduling purposes until Rover accepts it. A rejected or expired offer returns to the queue without changing scenario outcomes. Once accepted, the job is reserved for that Rover connection and provider tab until it reaches a terminal aggregate state or the lease is explicitly released.

Rover persists the execution mirror in `chrome.storage.session`:

- `queueId` / `evaluationRunId`
- provider and provider revision
- bound `tabId`
- `leaseId`, `leaseExpiresAt`, and lease state (`offered`, `accepted`, `running`)
- scenario statuses, active item, session IDs, request IDs, cancellation timestamps, and errors

Only one leased assignment may exist for a Rover connection. A new offer received while a lease is active must be rejected as `busy`, and must never overwrite the existing mirror.

## WebSocket contract

All new fields are optional so protocol v1 clients continue to work.

### Registration

Rover keeps `protocolVersion: 1` and advertises:

```json
{
  "type": "register",
  "protocolVersion": 1,
  "capabilities": ["scenario_control", "assignment_lease"],
  "provider": "chatgpt-com",
  "pageUrl": "https://chatgpt.com/",
  "extensionVersion": "..."
}
```

The `registered` response should include the server's effective capabilities when available. Rover stores whether `assignment_lease` was negotiated. If the response has no capabilities, Rover uses the legacy v1 behavior and never sends lease-only messages.

### Assignment offer

Keep the existing message type and add optional lease metadata:

```json
{
  "type": "assignment",
  "jobId": "run-...",
  "leaseId": "lease-...",
  "leaseExpiresAt": "2026-09-15T12:00:30.000Z",
  "agent": { "provider": "chatgpt-com", "providerRevision": "..." },
  "scenarios": [...],
  "newConversationBeforeStart": true,
  "newConversationBetweenScenarios": true
}
```

When lease metadata is present and negotiated, Rover must validate that the registered provider and revision match before accepting. It must persist the offer before acknowledging it.

### Lease messages

Add these messages to the shared protocol types:

```json
{ "type": "assignment_accept", "jobId": "...", "leaseId": "...", "tabId": 123 }
{ "type": "assignment_reject", "jobId": "...", "leaseId": "...", "reason": "provider_unavailable|stale_provider|busy|invalid_assignment", "retryable": true }
{ "type": "lease_renew", "jobId": "...", "leaseId": "...", "leaseExpiresAt": "..." }
{ "type": "lease_release", "jobId": "...", "leaseId": "...", "reason": "completed|error|stopped|connection_lost|provider_unavailable|provider_mismatch|stale_provider|bound_tab_unavailable|terminal_error" }
```

The existing `heartbeat` may renew a lease, but an explicit `lease_renew` is easier to test and debug. Renew at half the lease duration while a leased assignment is active. Do not renew after the assignment reaches a terminal state.

Extend `progress`, `scenario_status`, and `complete` with optional `leaseId`. Existing consumers can ignore it.

## MCPLab implementation

### Scheduler

Add a central matcher next to the existing run queue and Rover WebSocket handling.

Maintain one worker record per WebSocket connection and registration generation:

- provider
- provider revision
- page URL and tab metadata
- negotiated capabilities
- current lease, if any
- last heartbeat and lease renewal time

Run matching whenever:

1. a job enters the MCPLab queue;
2. a Rover registers or sends `register_update`;
3. a lease is rejected, released, expires, or completes;
4. a worker disconnects after the lease grace period.

For each idle worker, select the oldest queued job whose agent provider matches the worker provider and whose provider revision is compatible. Skip non-matching jobs instead of applying head-of-line blocking. Reserve only that job, create an offer, and send one assignment. Never send multiple offers to the same worker.

### Lease transitions

- `assignment_accept`: verify job ID, lease ID, worker identity, and expiry. Move `offered` to `accepted`, then allow scenario execution.
- `assignment_reject`: clear the offer and return the job to `queued`. Preserve all scenario results already recorded by MCPLab. Record a retryable reason for diagnostics.
- `lease_renew`: extend only the current lease and reject stale lease IDs.
- `lease_release`: clear the worker lease. For `completed`, `error`, or `stopped`, retain the terminal MCPLab aggregate status. For `connection_lost`, requeue only if the job has not produced a terminal result, subject to the configured grace period.
- lease expiry: atomically clear the lease and requeue the job. Do not create a second lease until the old one is cleared.

The existing stop and stop-scenario commands remain MCPLab-authoritative. They should target the current lease when one exists and must be idempotent.

### Queue visibility

The MCPLab queue API and UI remain the source of truth for jobs that are waiting for a matching provider. Rover can show a concise local state such as `Waiting for MCPLab to match a queued job to this provider tab`. If the product needs the full waiting list inside Rover, add an optional `queue_waiting` event or a queue snapshot request, but do not duplicate scheduling state in Rover.

## Rover implementation

### Protocol and state

Update:

- `src/mcplab/rover-protocol.ts`: add `assignment_lease` capability, typed lease messages, optional `leaseId` fields, and capability negotiation helpers.
- `src/queue/state.ts`: add persisted lease fields. Keep queue status and scenario statuses compatible with existing stored data. Treat missing lease fields as legacy v1.
- `src/contracts.ts`: add any inbound/outbound lease message unions.

### WebSocket handling

Update `src/background/socket.ts`:

1. Store effective server capabilities on registration acknowledgement.
2. On a lease-bearing assignment, serialize handling with `serializeQueueOperation`.
3. Reject malformed, stale-provider, or busy offers without replacing the current queue.
4. Persist the assignment mirror before sending `assignment_accept`.
5. Accept only after provider and revision validation. Bind the lease to the selected tab.
6. Start execution after acceptance. Keep the bound tab for the active request; tab switches affect only future matching, not an in-flight lease.
7. Renew the lease while active and release it exactly once on terminal completion, error, or stop.
8. On reconnect, reconcile a persisted lease before resuming. If MCPLab no longer recognizes it, clear only the stale lease metadata and wait for a new assignment.
9. Keep the legacy path unchanged when `assignment_lease` was not negotiated or the assignment has no `leaseId`.

### Queue runner and result handling

Update `src/background/queue-runner.ts` and `src/background/messages.ts`:

- Distinguish retryable provider-unavailable errors from terminal execution errors.
- For a lease-bearing assignment, provider-unavailable before execution sends `assignment_reject` and leaves the MCPLab job queued. It must not send aggregate `complete`.
- Once a scenario has started, unexpected capture or evaluation errors are terminal for that scenario. Send its `scenario_status` with the diagnostic error, then send aggregate `complete` with `outcome: "error"` when no next scenario can run. Always release the lease.
- User stop and stop-scenario preserve completed scenarios, mark stopped scenarios, continue to the next queued scenario when applicable, and release the lease only when the aggregate job is terminal.
- Include `leaseId` on progress, stage, scenario status, and completion messages when present.
- Remove the obsolete in-memory cancellation Set and its tests if `cancelRequestedAt` remains the persisted guard.

### Debug and UI

Extend the debug snapshot to show:

- negotiated lease capability;
- lease ID and lease state;
- lease expiry and last renewal;
- bound tab and provider revision;
- last assignment decision (`accepted`, `rejected`, `waiting`, or `released`) and reason.

When Rover has no assignment for the current provider, show `Waiting for a matching MCPLab job`, not an empty queue. Keep local/manual queue controls unchanged.

## Backward compatibility

- Continue sending protocol version 1.
- A v1 server that does not advertise `assignment_lease` receives the current assignment/progress/complete flow.
- A v1 client never receives a lease requirement. MCPLab falls back to its existing dispatch behavior for that connection.
- Persisted queues without lease fields load normally.
- Do not require new lease messages for existing local Rover queues.

## Test plan

### MCPLab tests

- matcher skips a non-matching head job and offers the first matching queued job;
- one worker receives one offer and a second job remains queued;
- provider `register_update` dispatches the newly matching job;
- accept, reject, release, renewal, and expiry transitions are idempotent;
- rejected or expired offers are requeued without losing scenario results;
- completion releases the lease and immediately dispatches the next matching job;
- worker disconnect does not create duplicate active leases;
- legacy v1 registration uses the old assignment path.

### Rover tests

- registration advertises `assignment_lease` while retaining protocol version 1;
- effective server capabilities are parsed correctly, including a missing-capabilities fallback;
- a valid offer is persisted and accepted exactly once;
- mismatched provider or revision sends a retryable rejection and does not start a session;
- a busy Rover rejects a second offer without overwriting its active queue;
- a persisted lease is reconciled after reconnect;
- active tab switching does not rebind an in-flight lease;
- provider-unavailable errors reject/requeue, while post-start capture errors complete the MCPLab job with a diagnostic error;
- stop-scenario continues to the next scenario and releases the lease only at aggregate completion;
- all terminal paths release a lease exactly once;
- v1 fallback behavior remains unchanged;
- local queue and Manual mode behavior remains unchanged.

## Suggested implementation order

1. Add MCPLab scheduler state and tests behind a feature flag or capability check.
2. Add shared wire types and Rover capability negotiation tests.
3. Implement Rover offer validation, persistence, accept/reject, and lease renewal.
4. Fix terminal managed-assignment completion and lease release paths.
5. Add reconnect, stop, and tab-switch regression tests.
6. Enable central matching for lease-capable Rover clients, then run the existing full suites in both repositories.

Suggested Conventional Commit checkpoints:

```text
feat: add capability-aware Rover assignment leases
feat: match queued runs to one available Rover worker
fix: release Rover leases on terminal queue outcomes
test: cover central matching and lease recovery
```
