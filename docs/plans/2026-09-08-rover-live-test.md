# MCPLab Rover Live Test Implementation Plan

## Goal

Let Rover browse MCPLab test cases, execute one test in the active Claude or TrendMiner chat, capture the response, and persist it through MCPLab's canonical evaluation pipeline.

## Architecture

Extract shared evaluation construction and artifact persistence from the existing runner. Normal scenario turns and Rover submissions use this shared path. Inspectr telemetry is deferred to a later phase.

## Phase 1: Shared evaluation pipeline

- Add a `ScenarioObservation` input containing the final response, optional observed tool calls, timing, trace messages, and execution provenance.
- Extract evaluation, extraction, `ScenarioRunResult` construction, aggregation, trace construction, and artifact writing into reusable core functions.
- Treat absent tool telemetry differently from an observed empty tool sequence. Tool checks are `not_evaluated` when telemetry is absent.
- Add `passed`, `failed`, `incomplete`, and `error` outcomes while retaining the existing `pass` field for compatibility.
- Refactor normal runs to use the same functions as Rover.

Suggested commit: `refactor: share evaluation result persistence`

## Phase 2: Live Test API

- Add a safe test-case catalog endpoint that does not expose agents or server configuration.
- Add start, read, complete, and cancel endpoints for in-memory Live Test sessions.
- Freeze the selected test-case snapshot at session creation.
- Evaluate and persist completed responses as normal MCPLab results with Rover provenance.
- Make completion idempotent and reject conflicting duplicate completion.
- Show attachment-based tests but mark them ineligible.

Suggested commit: `feat: add Rover live test API`

## Phase 3: Rover integration

- Add a typed local MCPLab client and loopback-only origin configuration.
- Let the popup browse and filter test cases.
- Keep the background worker responsible for session state, browser execution, response submission, stale-result protection, and recovery.
- Reuse the Claude and TrendMiner adapters.
- Provide copy-prompt and paste-answer fallback for unsupported pages.
- Display check counts, the final outcome, a result link, and a run-again action.

Suggested commit: `feat: run MCPLab live tests from Rover`

## Phase 4: Verification

- Cover shared evaluation parity, incomplete outcomes, compatibility with older results, and artifact writing.
- Cover the complete API lifecycle, safe catalog projection, expiration, and idempotency.
- Cover Rover origin validation, catalog state, provider automation, manual fallback, popup recovery, and stale responses.
- Run tests, typechecks, builds, and `git diff --check` in both repositories.

Suggested commit: `test: cover Rover live test lifecycle`

## Later phase: Inspectr telemetry

Attach Inspectr observations to the Live Test session and pass tool calls, arguments, results, ordering, and durations through the same `ScenarioObservation` pipeline. Do not make Rover or MCPLab an MCP proxy.

## Assumptions

- V1 supports one Live Test at a time.
- Test cases are selected inside Rover.
- Claude and TrendMiner are the only automated providers.
- Attachments, multi-scenario conversations, remote authentication, full evaluation launching, and Inspectr capture are deferred.
- Work remains on the existing branches. No commits or worktrees are created without explicit approval.
