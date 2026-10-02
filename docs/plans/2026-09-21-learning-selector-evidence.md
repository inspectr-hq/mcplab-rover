# Learning Selector Evidence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Prevent malformed object-string selectors from blocking Learning and disclose MCPLab working-locator changes in the proposal UI.

**Architecture:** Adjust selector evidence at its source in provider discovery, without changing replay or runtime semantics. Move the profile comparison projection into the popup view model so Working can be tested as data independently of DOM rendering.

**Tech Stack:** TypeScript, Vitest, jsdom, Chrome extension content script.

---

### Task 1: Prefer semantic working evidence

**Files:**
- Modify: `tests/provider-discovery.test.ts`
- Modify: `src/providers/provider-discovery.ts`

1. Add a failing Copilot-style test with `name="[object Object]"`, `role="article"`, and `aria-busy="true"`.
2. Verify the test fails because the primary working locator is the malformed name selector.
3. Ignore object-string attribute values and combine the strongest remaining semantic selector with the active busy state.
4. Verify the focused provider-discovery tests pass.

### Task 2: Show Working in proposal comparisons

**Files:**
- Modify: `tests/popup-view-model.test.ts`
- Modify: `src/popup/view-model.ts`
- Modify: `src/popup/main.ts`

1. Add a failing view-model test that compares captured and proposed working locators.
2. Verify the test fails because Working is not projected.
3. Export the profile summary from the view model, include Working, and reuse it from the popup renderer.
4. Verify the focused popup tests pass.

### Task 3: Verify the complete change

1. Run `npm test`.
2. Run `npm run build`.
3. Run `git diff --check`.
4. Review the complete uncommitted diff and report remaining live-test limitations.
