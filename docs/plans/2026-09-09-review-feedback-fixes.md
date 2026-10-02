# Review Feedback Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve the reviewed queue, panel lifecycle, mode isolation, state validation, and duplicate build-source issues without changing the extension's intended user flows.

**Architecture:** Keep queue invariants in `src/queue/state.ts`, popup rendering and user feedback in `src/popup/main.ts`, and panel lifecycle ownership in `src/content.ts`. Simplify repeated background response error handling with a local helper while preserving message-specific work and response timing.

**Tech Stack:** TypeScript, Chrome extension APIs, Vitest, Vite.

---

### Task 1: Add queue invariant regression coverage

**Files:**
- Modify: `tests/queue-state.test.ts`
- Modify: `src/queue/state.ts`

**Step 1: Write failing tests**

Cover that `skipQueueItem` throws when the supplied queue item ID is missing or does not match the active item, including the paused queue state with no active item.

**Step 2: Run the focused test**

Run: `npm test -- tests/queue-state.test.ts`

Expected: the new missing-active-item assertion fails against the current implementation.

**Step 3: Implement the guard**

Require a non-empty `queueItemId` and an exact match with `queue.activeItemId` before mutating the queue.

**Step 4: Run the focused test**

Run: `npm test -- tests/queue-state.test.ts`

Expected: all queue state tests pass.

### Task 2: Fix popup queue feedback and mode isolation

**Files:**
- Modify: `src/popup/main.ts`

**Step 1: Add focused tests if the popup harness supports DOM tests**

If there is no existing popup DOM harness, keep the behavior change in the shared, directly testable view-model/state paths and validate the popup through typecheck and build.

**Step 2: Implement visible failure feedback**

Make retry, skip, and stop display `response.error` or an action-specific fallback when the background response is not successful. Use a small local helper to keep all queue action feedback consistent.

**Step 3: Enforce mode separation**

When switching to queue mode, cancel and clear any active manual session before creating or showing the queue. When switching to manual mode, stop or clear the queue state according to the existing queue lifecycle contract before showing manual controls. Gate all manual session fields, not only catalog/session containers, on manual mode.

**Step 4: Validate popup behavior statically**

Run: `npm run typecheck`

Expected: no TypeScript errors.

### Task 3: Remove content-script listener leaks

**Files:**
- Modify: `src/content.ts`

**Step 1: Implement lifecycle cleanup**

Define the panel message listener as a named closure and call `window.removeEventListener` before removing an existing panel.

**Step 2: Preserve panel behavior**

Keep message source filtering, connection state updates, panel sizing, and expanded/collapsed behavior unchanged.

**Step 3: Validate**

Run: `npm run typecheck && npm test`

Expected: typecheck and all tests pass.

### Task 4: Refactor repeated background response handling

**Files:**
- Modify: `src/background.ts`

**Step 1: Add a local response helper**

Centralize conversion of thrown errors to `{ ok: false, error }` responses and preserve the existing `return true` contract for asynchronous listeners.

**Step 2: Migrate repeated handlers**

Use the helper for catalog, queue mutations, queue controls, manual preparation/execution/completion, and other handlers where it removes exact duplication without forcing unrelated handlers into a map.

**Step 3: Recheck stale-result and queue guards**

Ensure queue skip still validates its active item through the state module and that `ROVER_RESULT` ignores stale queue/session/request IDs as before.

**Step 4: Validate**

Run: `npm test && npm run build && git diff --check`

Expected: all commands exit successfully.

### Task 5: Remove duplicate root build sources

**Files:**
- Delete: `manifest.json`
- Delete: `icons/`

**Step 1: Confirm references**

Verify Vite copies only `public/`, and confirm no active build or documented unpacked-load workflow requires the root copies.

**Step 2: Remove duplicates**

Delete only the root duplicate manifest and icon directory, leaving `public/manifest.json` and `public/icons/` as the build sources.

**Step 3: Validate final state**

Run: `npm test && npm run build && git diff --check`

Expected: all commands exit successfully and the built extension still contains `dist/manifest.json` and `dist/icons/`.

Suggested commit message: `fix: address Rover review feedback`
