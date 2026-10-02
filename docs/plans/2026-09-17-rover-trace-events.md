# Rover Trace Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist normalized Rover lifecycle and response-state events in MCPLab's existing run trace without changing evaluation results.

**Architecture:** Rover emits structured, redacted events through the existing stage protocol. MCPLab appends them to the run journal and trace artifacts as additive records. Result assertions, outcomes, and completion ordering remain unchanged.

**Tech Stack:** TypeScript, Vitest, MCPLab execution journal, Rover WebSocket protocol.

---

### Task 1: Validate provider profile shape

**Files:**
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/providers.test.ts`

Add coverage for nested completion locators and reject misplaced profile fields. Correct the external TrendMiner/M365 YAML separately before loading it into MCPLab.

### Task 2: Define normalized Rover trace events

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/mcplab/rover-protocol.ts`
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests/rover-protocol.test.ts`

Add an additive event shape containing timestamp, job/scenario identifiers, stage, provider, and redacted state metadata. Do not include raw DOM or response text by default.

### Task 3: Emit response lifecycle events

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/runtime/ask.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/runtime/response-tracker.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/background/messages.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/background/queue-message-helpers.ts`
- Test: focused response and message tests

Emit lifecycle and response-state events while preserving the existing final text and outcome path.

### Task 4: Persist events in MCPLab artifacts

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-evaluation/packages/cli/src/app-server/run-queue-domain.ts`
- Modify: `/Users/tim.haselaars/Sites/mcp-evaluation/packages/cli/src/app-server/execution-journal.ts`
- Test: `/Users/tim.haselaars/Sites/mcp-evaluation/packages/cli/src/app-server/run-queue-domain.test.ts`

Append normalized Rover events to the existing execution journal and trace output. Verify the existing result snapshot is byte-for-byte equivalent apart from additive event records.

### Task 5: Verify

Run Rover tests, typecheck, build, and diff check. Run MCPLab CLI tests, typecheck, build, and diff check. Confirm a response-only Rover run produces the same outcome and result checks with additional trace events.
