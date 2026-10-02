# Provider Learning Trace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make learned-provider discovery and response capture lifecycle-aware without changing existing queue contracts or final evaluation results.

**Architecture:** Add structured, redacted lifecycle observations to provider discovery and response tracking. Learned adapters require a generation signal before accepting a stable response, while built-in adapters retain their existing completion behavior. Selector candidates are validated and replayed against the observed DOM lifecycle before a learned draft is emitted.

**Tech Stack:** TypeScript, Vitest, DOM APIs, Chrome extension content scripts.

---

### Task 1: Defensive learned response capture

- Add generation-observed metadata and completion diagnostics to `ResponseState`.
- Require a generation transition for learned adapters only.
- Return a typed incomplete-capture error when stable text appears without a generation signal.
- Preserve the existing queue message shape and built-in adapter behavior.

### Task 2: Structured provider discovery trace

- Capture redacted lifecycle snapshots before submission, after submission, during mutations, and at final selection.
- Record selector candidates, visibility, disabled state, text length, and lifecycle phase without raw response content.
- Validate generated selectors and reject invalid or behaviorally unproven drafts.

The MCPLab LLM selector-proposal endpoint is intentionally a follow-up. The trace and replay gates land first so an
LLM proposal cannot be accepted without deterministic browser validation.

### Task 3: Regression coverage

- Test generation-required capture and incomplete fallback.
- Test built-in capture compatibility.
- Test optional locator validation and selector replay.
- Test learned discovery emits only after a valid observed response lifecycle.

### Task 4: Verification

- Run Rover tests, typecheck, build, and `git diff --check`.
- Confirm queue-state and message tests remain unchanged and passing.

### Task 5: MCPLab proposal and diagnostics

- Add `POST /api/browser-providers/propose` using the configured LLM evaluation judge.
- Validate every returned profile with the existing core profile validator.
- Sanitize and persist the learning trace and proposal diagnostics in a sidecar artifact.
- Let Rover request proposals explicitly, replay them locally, and only enable saving after replay passes.

### Task 6: Debug visibility

- Expose the last learned-provider completion signal through the existing Debug checks.
- Keep response text and raw DOM content out of traces and persisted diagnostics.
