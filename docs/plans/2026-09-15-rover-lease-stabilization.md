# Rover Lease Stabilization Implementation Plan

**Goal:** Simplify the Rover and MCPLab managed-assignment lifecycle while keeping normal MCPLab LLM-agent execution unchanged.

**Architecture:** Rover protocol v2 requires `assignment_lease`. Managed Rover assignments use a dependency-free reducer and serialized interpreter with one array-only durable outbox. MCPLab uses one Rover-only transition/finalization path for lease cleanup, requeue, terminal errors, and client closure. Manual Live Test, local Rover queues, and `executionType: "mcplab"` jobs remain outside this refactor.

**Compatibility:** Rover has not been released. Remove legacy non-leased Rover fallback and the singular `pendingLeaseAction` format. Unsupported persisted managed state is discarded on startup. Normal MCPLab agent protocol and runner behavior remain compatible.

## Protocol v2

- Make MCPLab core the canonical owner of protocol version, capabilities, wire messages, and `RoverLeaseReleaseReason`.
- Mirror only the required wire types in Rover and validate both repositories against a checked-in protocol fixture.
- Require protocol v2 and `assignment_lease` during registration.
- Add an explicit `lease_unknown` response for messages referencing a job or lease absent from MCPLab's in-memory state.
- `lease_unknown` must include the job ID and lease ID and be emitted actively after MCPLab restart or stale lease messages.
- Rover treats `lease_unknown` as authoritative lease invalidation: clear the managed assignment and outbox, stop renewal, and return to idle without retrying the action.

## Rover managed-assignment state machine

- Add a persisted v2 `ManagedAssignmentState` with phases `idle`, `offered`, `accepted`, `running`, `finalizing`, `waiting_ack`, and `terminal`.
- Keep WebSocket transport state separate from lease ownership.
- Replace terminal-path branches with one `finalizeManagedAssignment` transition that orders persistence, `complete`, `lease_release`, acknowledgement, and optional queue removal.
- Use one array-only outbox. Send only its head and remove it only after a matching acknowledgement or `lease_unknown`.
- Route registration, assignment, validation, execution, stop, clear, reconnect, renewal, acknowledgement, and reconciliation through one serialized interpreter.
- Provider loss before execution requeues through MCPLab. Bound-tab loss after acceptance is terminal with `bound_tab_unavailable`. User stop is terminal with `stopped`.
- Remove `pendingLeaseAction`, non-leased capability fallback, and legacy managed state branches.

## MCPLab Rover state machine

- Add a pure Rover transition function guarded by `executionType === "rover"`.
- Add one `finalizeRoverJob` operation owning lease/timer cleanup, active-job bookkeeping, queue membership, status, event logging, evaluation journal updates, SSE closure, and rematching.
- Use the finalizer for completion, rejection, release, stop, disconnect expiry, terminal failure, and unknown-lease handling.
- Requeue only `connection_lost`, `provider_unavailable`, `provider_mismatch`, and `stale_provider`.
- Mark `bound_tab_unavailable` and `terminal_error` as terminal errors.
- Preserve all normal non-Rover queue and LLM-agent paths unchanged.

## Verification

- Add Rover reducer/interpreter tests for every transition, outbox ordering, lost acknowledgements, stale acknowledgements, `lease_unknown`, service-worker restart, MCPLab restart, stop, clear, and bound-tab loss.
- Add MCPLab tests for matching, lease lifecycle, terminal cleanup, requeue, protocol rejection, and active `lease_unknown` responses.
- Add boundary tests proving Rover messages cannot mutate `executionType: "mcplab"` jobs.
- Run full tests, typechecks, builds, and `git diff --check` in both repositories.
- Manually validate Claude and TrendMiner, offline completion, Stop, Clear, tab closure, provider switching, service-worker restart, MCPLab restart, lost acknowledgement, and lease expiry before stable release.

Suggested checkpoints:

```text
refactor: define Rover protocol v2 contract
refactor: add Rover managed assignment state machine
refactor: centralize MCPLab Rover transitions
test: protect non-Rover agent execution
test: cover Rover lease lifecycle end to end
```
