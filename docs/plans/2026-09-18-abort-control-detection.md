# Abort Control Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Recognize provider controls such as `Abort` as the active generation control for learning, runtime completion, and cancellation.

**Architecture:** Add one shared control-label predicate for stop-like controls, then use it in provider discovery and learned-provider runtime detection. Preserve the existing Submit-to-idle lifecycle and verify it with focused tests for custom labels.

**Tech Stack:** TypeScript, Vitest, Chrome extension content scripts.

---

### Task 1: Add failing tests

**Files:**
- Test: `tests/provider-discovery.test.ts`
- Test: `tests/providers.test.ts`

Add tests proving that a visible button labelled `Abort` is recorded as the generating control and that the learned adapter reports it as generating and can click it for cancellation.

Run the focused tests and confirm they fail before implementation.

### Task 2: Add the shared stop-like control matcher

**Files:**
- Create or modify: `src/providers/control-labels.ts`

Add a small predicate covering `stop`, `cancel`, and `abort`, case-insensitively, against aria-label, title, and visible text. Keep the matcher word-boundary based so unrelated labels such as `Abortable settings` do not match.

### Task 3: Integrate learning and runtime detection

**Files:**
- Modify: `src/providers/provider-discovery.ts`
- Modify: `src/providers/mcplab.ts`

Replace duplicated stop/cancel regular expressions with the shared matcher. Ensure discovery records the Abort control as the generating locator and records Submit as the idle control after the control returns to its enabled state.

### Task 4: Integrate cancellation and verify

**Files:**
- Modify provider cancellation code only if the shared matcher is needed there.
- Tests: `tests/provider-discovery.test.ts`, `tests/providers.test.ts`

Run the focused tests, then the complete test suite, typecheck, build, and `git diff --check`.

Suggested commit:

```text
fix: detect abort controls during provider learning
```
