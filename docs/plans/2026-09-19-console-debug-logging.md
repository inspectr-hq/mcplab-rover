# Console Debug Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persistent popup setting that enables or disables Rover's verbose `[Rover debug]` console logging, defaulting to disabled.

**Architecture:** Store the preference in `chrome.storage.local` under `rover.debugLogging`. A shared cached logger will be initialized and updated from the storage change event, so hot logging paths remain synchronous and cheap. The popup connection settings will read and update the preference directly, while operational `[Rover]` warnings and errors remain visible regardless of the setting. No new runtime message is needed.

**Tech Stack:** TypeScript, Chrome Extension APIs, Vitest, Vite.

---

### Task 1: Add storage and logger tests

**Files:**
- Create: `tests/debug-logging.test.ts`
- Test: `tests/store.test.ts`

**Step 1: Write the failing tests**

Cover these behaviors:

- The debug preference defaults to `false` when storage has no value.
- A stored boolean preference is returned unchanged.
- Updating the preference writes `{ 'rover.debugLogging': enabled }` to local storage.
- The debug logger does not call `console.info` while disabled.
- The debug logger calls `console.info` with the `[Rover debug]` prefix while enabled.

**Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run tests/debug-logging.test.ts tests/store.test.ts`

Expected: FAIL because the preference and shared logger APIs do not exist yet.

**Step 3: Commit checkpoint**

Suggested commit message: `test: define console debug logging behavior`

### Task 2: Implement the shared debug preference and logger

**Files:**
- Create: `src/debug-logging.ts`
- Modify: `src/background.ts`
- Modify: `src/background/socket.ts`
- Modify: `src/background/queue-runner.ts`
- Modify: `src/background/messages.ts`
- Modify: `src/background/queue-message-handler.ts`
- Modify: `src/runtime/ask.ts`
- Modify: `src/content.ts`

**Step 1: Add storage helpers**

Define `DEBUG_LOGGING_KEY`, `getDebugLogging()`, and `setDebugLogging(enabled)` in the shared debug logging module. Treat only an explicit `true` as enabled, making missing or malformed values default to `false`.

**Step 2: Add the cached logger**

Create a shared module with:

- `initializeDebugLogging()` to load the stored preference.
- `setDebugLoggingEnabled(enabled)` to update the in-memory value.
- `debugLog(event, details?)` to call `console.info` only when enabled.
- A `chrome.storage.onChanged` listener that keeps the cache synchronized in every extension context.

Use the existing message format, `[Rover debug] ${event}`, so current development workflows remain readable.

**Step 3: Initialize the background logger and replace direct debug calls**

Initialize the logger during background startup. Replace only verbose `[Rover debug]` calls with the helper. Leave `[Rover]` warnings and errors unchanged.

**Step 4: Run the focused tests**

Run: `npx vitest run tests/debug-logging.test.ts tests/store.test.ts`

Expected: PASS.

**Step 5: Commit checkpoint**

Suggested commit message: `feat: gate verbose logs behind debug setting`

### Task 3: Add the popup setting

**Files:**
- Modify: `rover.html`
- Modify: `src/popup/main.ts`
- Modify: `src/popup/style.css`
- Modify: `tests/popup-view-model.test.ts` or create a focused popup settings test if a pure helper is extracted

**Step 1: Add the setting markup**

Add a labeled checkbox inside the existing connection settings controls with accessible text `Console debug logging`.

**Step 2: Load and persist the setting**

Read the stored preference when the popup initializes and set the checkbox state from the result. On change, write the boolean directly to `chrome.storage.local`. The shared logger's storage change listener will apply the new value immediately in the background and content contexts.

**Step 3: Style the checkbox consistently**

Reuse the existing checkbox row styling where possible. Keep the control compact and visible only with the existing connection settings controls.

**Step 4: Run popup and full tests**

Run: `npm test`

Expected: all tests pass.

**Step 5: Commit checkpoint**

Suggested commit message: `feat: add popup control for debug logging`

### Task 4: Verify the complete change

**Files:**
- No source changes expected.

**Step 1: Run typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: both commands pass.

**Step 2: Check formatting and repository state**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors. Existing unrelated untracked files under `docs/plans/` remain untouched.

**Step 3: Manual smoke check**

Reload the extension, open Rover, expand MCPLab connection settings, confirm the checkbox is off by default, enable it, trigger a toolbar or connection event, and confirm `[Rover debug]` logs appear. Disable it and confirm subsequent verbose logs stop. Confirm warnings and errors still appear when applicable.

**Step 4: Commit checkpoint**

Suggested commit message: `chore: verify debug logging preference`
