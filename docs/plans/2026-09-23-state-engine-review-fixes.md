# State Engine Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the behavioral state engine the live response-capture path without changing persisted learned profile compatibility.

**Architecture:** Provider evaluators will produce canonical `ProviderObservation` values directly for the tracker. Because this feature is not released, there is no legacy `ResponseState` compatibility path to preserve. Provider-specific signal precedence stays in each adapter, while timeout ownership and evidence history stay in the generic engine.

**Tech Stack:** TypeScript, Vitest, Vite, Chrome extension content scripts.

---

### Task 1: Connect direct provider observations

**Files:** `src/providers/types.ts`, `src/runtime/ask.ts`, `src/runtime/response-tracker.ts`, `src/runtime/provider-signals.ts`, provider tests.

- Add a canonical observation read path to the adapter contract.
- Test that `ask()` uses `signalEvaluator` directly when available.
- Remove the unreleased `getResponseState()` path and make `ProviderObservation` the only runtime observation contract.
- Remove the response-state round trip from the direct path.

### Task 2: Make configured generation selectors authoritative

**Files:** `src/providers/mcplab.ts`, `src/runtime/provider-state-engine.ts`, provider tests.

- When a learned profile has `generatingLocator`, use that result as the generation signal.
- Do not allow heuristic stop or cancel controls to override a configured selector.
- Add a regression test for a persistent cancel control.

### Task 3: Make timeout and evidence history reachable

**Files:** `src/runtime/response-tracker.ts`, `src/runtime/provider-state-engine.ts`, response tracker tests.

- Let the engine receive the deadline observation before timeout rejection.
- Record historical generation and response evidence only on the latch transition.
- Surface historical evidence in completion details.
- Test the engine-owned timeout and one-time evidence records.

### Task 4: Remove duplicated state representations

**Files:** `src/runtime/response-tracker.ts`, `src/runtime/provider-signals.ts`, adapter tests.

- Use top-level type imports.
- Make direct observations canonical.
- Keep response observation and state interpretation separate, with no unreleased compatibility conversion.
- Remove unused helpers or make their use explicit.

### Task 5: Rename the learned adapter symbol safely

**Files:** `src/providers/mcplab.ts`, `src/providers/index.ts`, tests.

- Export `createMcplabAdapter`.
- Rename the implementation export to `createMcplabAdapter`; persisted profile terminology remains unchanged.
- Update internal imports and tests to the new name.

### Task 6: Verify the complete behavior

Run the focused provider and tracker tests, the full test suite, typecheck, production build, and `git diff --check`. Do not commit until the user reviews the complete diff.
