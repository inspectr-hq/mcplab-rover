# MCPLab Rover Phase 1: Browser Chat Extension

## Goal

Build the smallest working Chromium extension that sends a fixed prompt to an already-open chat tab, waits for the new assistant response to finish, and captures the final response text.

Phase 1 operates through the visible chat UI. It does not call model APIs, use Playwright, create a browser profile, or depend on MCPLab's evaluation API.

## Supported providers

### Claude

- Composer: `div[contenteditable="true"].ProseMirror`, with a generic contenteditable fallback.
- Submit: enabled Send button selectors, excluding toggle controls.
- Response: visible assistant content, including Claude streaming containers.
- Completion: streaming marker is false, text is stable, and the composer is idle.

### TrendMiner custom agent

- Composer: `[data-test="ai-agent_input"]`.
- Submit: `button[aria-label="Submit"]`.
- Response: `.chat-messages__message--assistant .chat-messages__message-content`.
- Completion: submit control is enabled and response text is stable.

Provider-specific selectors remain inside provider adapters. The generic runtime does not know about ProseMirror, `data-is-streaming`, or TrendMiner classes.

## Core flow

```text
popup action
  -> background service worker
  -> content script in active tab
  -> snapshot existing assistant candidates
  -> inject fixed prompt
  -> submit chat message
  -> observe new or changed assistant candidate
  -> wait for stable, complete response
  -> return captured text
  -> popup displays and can copy response
```

## Current project structure

```text
public/manifest.json
public/icons/
rover.html
src/
  background.ts
  content.ts
  contracts.ts
  popup/
    main.ts
    style.css
  providers/
    claude.ts
    dom.ts
    index.ts
    trendminer.ts
    types.ts
  runtime/
    ask.ts
    candidate-selection.ts
    response-tracker.ts
tests/
  candidate-selection.test.ts
  providers.test.ts
  response-completion.test.ts
```

## Generic adapter contract

Each provider implements:

```ts
interface ChatProviderAdapter {
  id: string;
  findComposer(): HTMLElement | null;
  setComposerText(text: string): Promise<void>;
  findSubmitButton(): HTMLElement | null;
  submit(): Promise<void>;
  getResponseCandidates(): ResponseCandidate[];
  getResponseState(): ResponseState;
}
```

The runtime snapshots candidates before submission and only accepts a newly appended or changed visible candidate. This prevents returning an older answer already present on the page.

## Completion rules

A response is accepted only when:

- meaningful assistant text exists;
- the candidate is newer than or changed from the pre-submit baseline;
- the text has remained stable for the provider stability window;
- the provider no longer reports generation in progress;
- the composer is idle;
- no provider error is visible;
- the overall timeout has not been reached.

Current defaults are provider-specific stability windows, a short minimum response age, and a 120-second timeout.

## Popup behavior

- The toolbar popup is `rover.html`.
- The MCPLab favicon is used for popup branding and extension icons.
- The popup follows the system light or dark theme.
- The popup has a compact MCPLab notch-inspired layout.
- The fixed smoke-test prompt is sent through the active Claude or TrendMiner tab.
- Completed text is shown in a scrollable response tray with a Copy response action.

## Reliability tests

The runtime tests cover:

- selecting a new appended assistant response;
- selecting a changed streaming response;
- ignoring unchanged stale DOM;
- ignoring hidden and empty candidates;
- waiting for stable completion;
- respecting active generation state;
- rejecting provider errors and timeouts;
- Claude completed streaming containers;
- TrendMiner assistant extraction and composer updates.

## Verification

Run from `/Users/tim.haselaars/Sites/mcp-lab-rover`:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Load the generated extension from:

`/Users/tim.haselaars/Sites/mcp-lab-rover/dist`

After rebuilding, reload the extension in `chrome://extensions` and refresh the active Claude or TrendMiner tab before running the smoke test.

## Phase 1 boundary

Phase 1 ends at reliable browser-chat injection and response capture. MCPLab API requests, SSE monitoring, run queues, API-origin configuration, and evaluation-run controls belong to [Phase 2](./phase-2-mcplab-api-sse.md).
