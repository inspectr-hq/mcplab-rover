# Learned Provider Evidence Implementation Plan

**Goal:** Make Learn retain and validate the observations it uses to build a profile, then make runtime use those observations without claiming unsupported completion or conversation changes.

**Architecture:** Keep schema version 1 readable for existing saved profiles. Add optional evidence and strategy fields for newly learned profiles. Replay uses retained semantic selections and ordered transitions when available; legacy traces retain their existing validation path. Runtime tracks a request-local assistant turn and resets completion stability on activity or turn changes. New-conversation confirmation uses meaningful context changes when configured, with legacy behavior preserved only for old profiles.

**Tech Stack:** TypeScript, Vitest, jsdom, Chrome extension content script.

---

### Task 1: Retain selected semantic evidence

**Files:** `src/contracts.ts`, `src/providers/provider-discovery.ts`, `tests/provider-discovery.test.ts`, `tests/discovery-replay.test.ts`

1. Write a failing Copilot-style test where the selected `[data-testid="markdown-reply"]` is absent from compact snapshots but exists as first-class selected evidence.
2. Run focused tests to verify the failure.
3. Record selected composer, submit, assistant, generating, and idle elements with locator, attributes, phase, and order, without response text.
4. Make replay validate locators against those selected elements and ordered phase transitions, retaining a compatibility path for old traces.
5. Run focused tests and typecheck.

### Task 2: Make runtime completion activity-aware

**Files:** `src/runtime/response-tracker.ts`, `src/runtime/ask.ts`, `src/runtime/candidate-selection.ts`, `src/providers/mcplab.ts`, `tests/response-completion.test.ts`, `tests/providers.test.ts`

1. Add failing tests for generation resumption, assistant-turn replacement, and a tool/busy pause not completing from text stability.
2. Run focused tests to verify failures.
3. Reset stability on activity and turn changes; use stable DOM identity where available and stop using text length as a key.
4. Run focused tests and typecheck.

### Task 3: Make new-conversation confirmation meaningful

**Files:** `src/mcplab/types.ts`, `src/providers/mcplab.ts`, `src/providers/provider-discovery.ts`, `tests/providers.test.ts`, `tests/provider-discovery.test.ts`

1. Add failing tests for unrelated body mutation and actual conversation-context change.
2. Run focused tests to verify failures.
3. Generate an optional confirmation rule from observed evidence. For new profiles, reject ambiguous click outcomes rather than treating mutation settlement as proof. Keep persisted old profiles readable.
4. Run focused tests and typecheck.

### Task 4: End-to-end fixtures and verification

**Files:** `tests/provider-discovery.test.ts`, `tests/ask.test.ts`, any fixture helpers needed.

1. Add a Learn then execute second-request fixture for Copilot-like markup and a known-good custom provider.
2. Run focused tests, full `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
3. Review the changed diff against the working tag and report any remaining evidence gaps honestly.

No commits or worktrees are created. Suggested Conventional Commit messages are provided after each stage for the user's review.

## Implementation checkpoint

Completed in the current working tree:

- First-class selected-element evidence, including selector alternatives, match-quality counts, candidate score, and post-submission change evidence.
- Strict semantic replay for new traces, with a compatibility path for persisted legacy traces. Replay checks selected elements and activity ordering rather than relying only on compact snapshots.
- Incremental Learning drafts, so a response seen before generation can be updated when later lifecycle evidence arrives.
- Activity-aware runtime stability, stable provider-supplied turn IDs, conservative handling of anonymous turns, and actual use of the learned stability window.
- Assistant-scoped `aria-busy` Learning and runtime support. A no-Stop profile can pass when a busy-to-ready transition is observed.
- Copilot-style Learn-to-second-request and long-tool-pause execution fixtures.

Still open before the full goal is met:

- Learning records a same-page New Chat click followed by a URL change or reduced assistant count. Click-based profiles are not saveable until that evidence is observed. Runtime chooses a visible, semantically labelled control and uses the same context-change confirmation. Same-URL transitions with unchanged assistant counts fail conservatively. Navigation-based New Chat is not yet observed end-to-end.
- Tool work outside the selected assistant subtree is not observed unless a `workingLocator` is supplied separately.
- Anonymous response DOM replacement without a stable turn ID remains ambiguous. Runtime now refuses same-count anonymous changes instead of claiming a new turn, which can cause a deliberate false negative for UIs that reuse one container.
- Added custom assistant-class and article-role Learn-to-second-request fixtures, plus long streaming, disappearing busy indicator, hidden Stop control, and toolbar deactivation races. The fixture matrix is not comprehensive for every custom provider and SPA shape. Live verification against Copilot and the known-working provider is still needed.
- MCPLab core and CLI now retain the optional profile fields through validation, YAML persistence, and the sanitized Judge trace. Both MCPLab package suites pass. These changes are in the sibling `mcp-evaluation` working tree and must be deployed with Rover.
- Toolbar shutdown now cancels an active browser request, stops and releases its managed queue, then closes the socket. Delayed queue-item errors are checked against current queue state before they can overwrite a stopped queue.
