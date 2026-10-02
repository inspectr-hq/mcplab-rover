# Rover Evaluation Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Rover Queue mode that runs ordered evaluations one by one in Claude or TrendMiner, captures each response, optionally starts a fresh conversation between items, and persists every result through MCPLab.

**Architecture:** Rover owns one persisted queue in `chrome.storage.session`. Each item creates an MCPLab Live Test session just before execution, then advances after `passed`, `failed`, or `incomplete` results. Browser and API failures pause the queue for retry, skip, or stop. The existing Manual mode remains unchanged.

**Tech Stack:** TypeScript, Chrome Manifest V3, content scripts, Shadow DOM injected UI, `chrome.storage.session`, MCPLab Live Test API, Vitest.

---

## Product decisions

- Queue mode is available only on supported Claude and TrendMiner pages. Manual mode remains available everywhere.
- A queue-level toggle starts a fresh conversation before every item after the first.
- Evaluation outcomes (`passed`, `failed`, `incomplete`) are recorded and advance automatically.
- Browser, navigation, capture, and MCPLab transport errors pause the queue with Retry, Skip, and Stop actions.
- Queue items support duplicates, explicit ordering, move up, move down, and removal.
- One queue and one locked browser tab are supported at a time.
- MCPLab-side queue creation is deferred to a later phase.

## Implementation tasks

### Task 1: Queue contracts and state machine

- Add queue and queue-item types, statuses, failure stages, and message contracts.
- Add a pure queue reducer/coordinator model for add, duplicate, reorder, remove, start, advance, pause, retry, skip, stop, and completion.
- Persist queue state in `chrome.storage.session` and preserve completed item results.
- Add tests before implementation for ordering, duplicates, terminal outcomes, stale item IDs, and pause actions.

### Task 2: Provider conversation lifecycle

- Extend provider capabilities with readiness and new-conversation support.
- Implement TrendMiner new-chat handling using its existing `New chat` control and composer readiness.
- Implement Claude same-tab new-conversation navigation and content-script reinjection readiness.
- Add tests for provider detection, new-chat actions, readiness, navigation interruption, and unsupported pages.

### Task 3: Background queue coordinator

- Add queue message handlers in the service worker.
- Lock the active tab and detected provider when queue execution starts.
- Create MCPLab sessions just in time for each item.
- Execute, capture, complete, persist, and advance one item at a time.
- Continue after evaluated failures and incomplete outcomes.
- Pause on browser or API failures and implement Retry, Skip, and Stop.
- Include queue ID, item ID, request ID, and session ID in all messages and reject stale responses.
- Reinject Rover after Claude navigation and restore queue state.

### Task 4: Queue panel UI

- Add Manual and Queue modes to the expanded injected Rover panel.
- Add catalog search, queue Add action, ordered queue list, duplicate support, move controls, remove controls, and the new-conversation toggle.
- Add queue progress, per-item statuses, outcome counts, result links, and Retry, Skip, Stop, and Run actions.
- Keep the compact notch visible and reflect connected, running, paused, and error states.
- Keep MCPLab settings and the existing Manual flow intact.

### Task 5: Verification and regression coverage

- Add queue reducer, provider lifecycle, background coordinator, stale-response, recovery, and UI tests.
- Verify manual execution remains unchanged.
- Run Claude and TrendMiner end-to-end queues with and without new conversations.
- Verify evaluated failures continue, browser failures pause, and retry does not duplicate results.
- Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` in Rover.

Suggested checkpoints:

```text
feat: add Rover queue state machine
feat: support new conversations in Rover queues
feat: run evaluation queues from Rover
test: cover Rover queue lifecycle
```

