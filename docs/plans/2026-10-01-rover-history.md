# Rover History Implementation Plan

> Execute in the existing branch. Do not stage or commit.

**Goal:** Remove individual recent Rover evaluations and display passed outcomes as a green check.

**Architecture:** Existing queue domain owns dismissal and rearchive filtering. An extension message uses the serialized queue operation and existing storage. The popup sends the provider and item identifier and refreshes from the persisted state.

**Tech Stack:** TypeScript, Chrome extension messaging/storage, DOM/CSS, Vitest and jsdom.

### 1. Regression tests
Modify tests/queue-state.test.ts and tests/queue-message-handler.test.ts; create tests/popup-history.test.ts. Cover dismissal without outcome changes, provider isolation, no resurrection, unfinished job protection, reruns, popup check/accessibility, click behavior and failures. Run npm test -- tests/queue-state.test.ts tests/queue-message-handler.test.ts tests/popup-history.test.ts and verify failures.

### 2. Domain and message
Modify src/queue/state.ts to add optional hiddenFromHistory and dismissQueueHistoryItem, filter archiving, reset on reruns. Add ROVER_QUEUE_DISMISS_HISTORY to src/contracts.ts and routing in src/background/messages.ts. Handle it with serializeQueueOperation and saveQueue in src/background/queue-message-handler.ts. Filter hidden entries in src/popup/view-model.ts for legacy unarchived queues.

### 3. Popup
Modify src/popup/main.ts and style.css. Add accessible remove buttons only to the Recent group and render green ✓ for passed with an accessible Passed label. Surface failures and enable retry.

### 4. Verify
Run the focused tests, npm test, npm run typecheck, npm run build and git diff --check. Review diff and suggest feat: add Rover history controls. Do not commit.
