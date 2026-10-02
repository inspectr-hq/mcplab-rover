# Provider-Scoped Rover Queue and Recent History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show each browser tab only the active provider's MCPLab queue work and up to five recent completed evaluations for that provider.

**Architecture:** Keep one background Rover worker and one MCPLab WebSocket connection. Extend the shared session queue state with provider-keyed recent history, archive completed items when managed assignments are replaced, and expose the active tab provider to each injected panel for rendering. MCPLab-managed queues remain read-only in Rover, while local Rover queues retain their editing controls.

**Tech Stack:** TypeScript, Chrome Manifest V3 APIs, Vitest, Vite.

---

### Task 1: Extend queue state with provider history

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/queue/state.ts`
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/queue-state.test.ts`

**Step 1: Write the failing tests**

Add tests for archiving completed items under a provider, retaining only five entries, and leaving running items out of history.

**Step 2: Run the tests to verify they fail**

Run: `npm test -- --run tests/queue-state.test.ts`

Expected: FAIL because provider history and archive behavior do not exist.

**Step 3: Implement the minimal state helpers**

Add a provider-keyed history field to `RoverQueueState` and a pure helper that archives completed queue items into the provider bucket, newest first, capped at five. Keep the helper backward-compatible when history is absent.

**Step 4: Run the tests to verify they pass**

Run: `npm test -- --run tests/queue-state.test.ts`

Expected: PASS.

### Task 2: Expose the active provider to injected panels

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/contracts.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/background/messages.ts`
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/background-provider.test.ts`

**Step 1: Write the failing test**

Test that a `ROVER_GET_ACTIVE_PROVIDER` request detects the active tab provider and returns an unavailable result when there is no supported active page.

**Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/background-provider.test.ts`

Expected: FAIL because the message type and handler are missing.

**Step 3: Implement the message contract and handler**

Add the message type and return `{ provider, tabId, url }` using the existing `activeTab` and `detectProvider` functions. Do not create another socket or mutate queue state from this request.

**Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/background-provider.test.ts`

Expected: PASS.

### Task 3: Archive completed MCPLab assignments on replacement

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/background/socket.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/queue/state.ts`
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/queue-state.test.ts`

**Step 1: Write the failing test**

Add a state-level regression test showing that replacing a completed Claude assignment preserves it in Claude history while creating a new Copilot assignment.

**Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/queue-state.test.ts`

Expected: FAIL because assignment replacement currently discards the previous queue.

**Step 3: Implement assignment archiving**

Before creating the new assignment queue, read the existing queue, archive only completed items under its provider, and carry the resulting history into the new queue. Preserve current assignment items, tab binding, and MCPLab evaluation run identifiers. Do not archive running or waiting items.

**Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/queue-state.test.ts`

Expected: PASS.

### Task 4: Build provider-specific queue projections

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/popup/view-model.ts`
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/popup-view-model.test.ts`

**Step 1: Write the failing tests**

Test that a projection for Claude excludes Copilot history and excludes an active queue assigned to another provider. Test the empty-state projection and the five-item history limit.

**Step 2: Run the tests to verify they fail**

Run: `npm test -- --run tests/popup-view-model.test.ts`

Expected: FAIL because the view model only splits active and completed items from one queue.

**Step 3: Implement the projection helper**

Add a pure `projectQueueForProvider` helper that accepts queue state and active provider, returns matching active items, matching recent history, managed status, and whether the current assignment belongs to the provider. Keep local queue behavior unchanged.

**Step 4: Run the tests to verify they pass**

Run: `npm test -- --run tests/popup-view-model.test.ts`

Expected: PASS.

### Task 5: Update panel rendering and tab synchronization

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/popup/main.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/popup/style.css`
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/popup-view-model.test.ts`

**Step 1: Write the failing tests**

Add view-model coverage for provider headings and read-only MCPLab queue state.

**Step 2: Run the tests to verify they fail**

Run: `npm test -- --run tests/popup-view-model.test.ts`

Expected: FAIL because the renderer has no active-provider projection or provider heading.

**Step 3: Implement the UI behavior**

On panel initialization and tab changes, request the active provider from the background worker. Render `Queue` for matching active items and `Recent {provider} evaluations` for matching history. Show a clear empty state when no provider-specific jobs exist. Hide add, reorder, delete, new-conversation, and local run controls for MCPLab-managed queues. Keep stop, retry where applicable, status, and result links.

Preserve local queue editing and completed-item grouping. Avoid adding a second WebSocket or per-tab queue store.

**Step 4: Run the tests and build**

Run: `npm test -- --run`

Expected: all Rover tests pass.

Run: `npm run typecheck && npm run build && git diff --check`

Expected: typecheck, production build, and whitespace validation pass.

### Task 6: Verify lifecycle and compatibility behavior

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/queue-state.test.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/popup-view-model.test.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/store.test.ts`

**Step 1: Add regression coverage**

Cover absent history on older persisted queue state, switching Claude to Copilot, popup close and reopen, completed failure outcomes, MCPLab restart reconciliation, and keeping a running item bound to its original tab.

**Step 2: Run the focused regression suite**

Run: `npm test -- --run tests/queue-state.test.ts tests/popup-view-model.test.ts tests/store.test.ts tests/background-provider.test.ts`

Expected: PASS.

**Step 3: Run the complete Rover verification**

Run: `npm test -- --run && npm run typecheck && npm run build && git diff --check`

Expected: all tests, typechecks, build, and whitespace checks pass.

Suggested checkpoints:

- `feat: retain recent Rover history by provider`
- `feat: render provider-scoped Rover queue`
- `test: cover provider-scoped Rover history`

