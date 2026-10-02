# Learning Evidence and Proposal UI Implementation Plan

**Goal:** Make the learning view clearly distinguish Rover's captured evidence from MCPLab proposal feedback and save blockers.

**Architecture:** Keep the existing discovery and replay data flow. Add a proposal comparison model in the popup, render captured capabilities separately from proposal diagnostics, and reserve save readiness for a dedicated blocker summary.

**Tech Stack:** TypeScript, vanilla HTML, CSS, Vitest.

### Task 1: Add proposal comparison data

**Files:**
- Modify: `src/popup/main.ts`
- Test: `tests/popup-learning.test.ts` (if popup helpers are extracted)

Compare the captured draft profile with the proposed profile for composer, submit, assistant response, completion, and new conversation. Report kept, changed, added, or missing states without changing save validation.

### Task 2: Separate learning markup and styles

**Files:**
- Modify: `rover.html`
- Modify: `src/popup/style.css`

Create distinct sections for captured evidence, MCPLab proposal feedback, and save readiness. Use separate visual tokens and accessible text labels.

### Task 3: Render and verify the proposal state

**Files:**
- Modify: `src/popup/main.ts`

Render proposal differences and validation reasons in the proposal section. Keep errors in the save-readiness section and preserve existing button behavior.

### Task 4: Verify

Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
