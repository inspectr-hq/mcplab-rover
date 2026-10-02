# MCPLab Rover Phase 2: Live Test and SSE Integration

## Purpose

Connect the MCPLab Live Test experience to Inspectr's MCP observability stream so a real external agent can be evaluated with the existing MCPLab assertion and judging pipeline.

This phase is separate from the Phase 1 browser-chat adapter. Phase 1 remains a working browser convenience prototype. Phase 2 must not turn MCPLab into a browser automation framework or make the extension responsible for interpreting every chat UI.

## Product direction from the brainstorms

The product primitive is **Live Test**, not Browser Test:

```text
MCPLab test case
  -> user starts a Live Test
  -> user runs the prompt in any real agent
  -> Inspectr observes MCP activity
  -> MCPLab evaluates tool calls and the final response
```

The ownership boundary is:

- **Inspectr:** what happened, MCP requests, responses, tool calls, arguments, results, timing, and sessions.
- **MCPLab:** was it correct, test cases, assertions, judges, pass/fail, reports, and history.
- **Rover:** optional convenience bridge for copying or injecting prompts and returning a captured final answer from a browser tab.

The extension should not become the source of truth for MCP activity. It should not replace Inspectr with DOM parsing or a provider-specific telemetry system.

For this product, Rover is the user-facing launcher for Live Test. The user selects an existing MCPLab test case inside Rover, starts the evaluation, and Rover reports the captured final answer back to MCPLab. Inspectr remains the source of truth for MCP activity, while MCPLab remains the source of truth for evaluation and reporting.

## Rover-led Live Test flow

```text
User opens Rover
  -> Rover loads available MCPLab test cases
  -> User selects a test case and clicks Start evaluation
  -> Rover asks MCPLab to create a Live Test session
  <- session id, correlation token, prompt, provider metadata
  -> Rover injects the prompt into the active supported chat
  -> Real agent runs and Inspectr observes MCP activity
  -> Rover waits for and captures the final response
  -> Rover submits final response to MCPLab
  -> MCPLab combines Inspectr events + response + test case
  -> MCPLab evaluates and returns the result to Rover
```

If browser injection or response capture is unavailable, Rover should provide a manual fallback: copy the prompt, let the user run it, then paste the final answer into Rover.

## Existing MCPLab API surface

The current MCPLab run API in `/Users/tim.haselaars/Sites/mcp-evaluation/packages/cli/src/app-server` exposes:

| Purpose | Method | Endpoint |
| --- | --- | --- |
| Enqueue a normal MCPLab-controlled evaluation run | `POST` | `/api/runs` |
| Inspect queued runs | `GET` | `/api/runs/queue` |
| Queue-wide live events | `GET` SSE | `/api/runs/queue/events` |
| Job-specific live events | `GET` SSE | `/api/runs/jobs/:jobId/events` |
| Stop a running job | `POST` | `/api/runs/jobs/:jobId/stop` |
| Read completed run summaries | `GET` | `/api/runs` |
| Read a run trace | `GET` | `/api/runs/:runId/trace` |

The MCPLab web app already implements the EventSource behavior in:

`/Users/tim.haselaars/Sites/mcp-evaluation/packages/app/src/lib/data-sources/workspace-api-client.ts`

These endpoints are useful references, but `/api/runs` is not automatically the correct entry point for Live Test. It runs MCPLab-controlled evaluations. Live Test needs a session that associates a test case with externally observed Inspectr events and a user-supplied or Rover-captured final response.

The MCPLab coder should decide whether to add dedicated Live Test endpoints, rather than overloading the normal run queue.

## Proposed Live Test API contract

These are proposed product endpoints, not claims about the current MCPLab routes:

| Purpose | Method | Endpoint |
| --- | --- | --- |
| List selectable test cases | `GET` | `/api/live-tests/test-cases` |
| Start a Live Test session | `POST` | `/api/live-tests` |
| Read session state and result | `GET` | `/api/live-tests/:sessionId` |
| Submit Rover's captured final response | `POST` | `/api/live-tests/:sessionId/response` |
| Stop or cancel a session | `POST` | `/api/live-tests/:sessionId/stop` |

Suggested start request:

```ts
type StartLiveTestRequest = {
  testCaseId: string;
  provider?: 'claude' | 'trendminer' | string;
};
```

Suggested start response:

```ts
type StartLiveTestResponse = {
  sessionId: string;
  correlationToken: string;
  prompt: string;
  testCaseId: string;
  status: 'listening' | 'ready';
};
```

Suggested response submission:

```ts
type SubmitLiveTestResponse = {
  responseText: string;
  provider?: string;
};
```

MCPLab should correlate the Inspectr event window with `sessionId` or `correlationToken`, evaluate the combined evidence, and return a result containing at least status, assertion outcomes, observed tool calls, and missing observations.

## Recommended Phase 2 slices

### Phase 2A: MCPLab Live Test foundation

Implement the MCPLab session and evaluation contract first, while Rover can use a temporary mocked client during development:

1. Create a Live Test session for one selected test case and return its prompt.
2. Subscribe to the relevant Inspectr SSE channel using a correlation token.
3. Accept a final response submission from Rover or the manual fallback.
4. Evaluate Inspectr activity and the final response through the existing pipeline.
5. Return a structured result to Rover.
6. Persist a normal result with execution provenance marked `external` or `live`.

This proves the product without coupling MCPLab to Claude, Copilot, ChatGPT, or any browser DOM.

### Phase 2B: Rover-led browser execution

Make Rover the primary launcher and browser execution client:

```text
Rover
  -> lists/selects MCPLab test cases
  -> creates a Live Test session
  -> injects prompt into the active supported chat
  -> captures the final response
  -> sends response and session token back to MCPLab
MCPLab
  -> evaluates Inspectr activity and response
  -> returns the result to Rover
```

Rover should remain a thin adapter. Inspectr remains the authority for MCP tool activity. If Rover is unavailable, the user can still copy the prompt and paste the final response manually.

### Phase 2C: Live Evaluation and conversation flows

Only after one Live Test works, add multi-scenario continuation:

- model a `conversationId` or `flowRunId` above individual scenarios;
- keep per-scenario evaluation checkpoints inside one external conversation;
- let the UI advance to the next prompt;
- keep evaluation failure distinct from execution failure;
- restart the full conversation for each repetition;
- preserve one canonical conversation trace with per-scenario trace slices;
- later add explicit flow transitions and branching.

The conversation brainstorm's key distinction is: scenarios define evaluatable turns, while flows define conversation topology.

## Origin configuration

Do not hard-code one deployment origin into the extension.

Add a stored API origin setting with this precedence:

1. User-configured origin in the Rover settings UI.
2. The active MCPLab origin when the current tab is an MCPLab page.
3. A development default such as `http://127.0.0.1:8787` only in development builds.

Store the value with `chrome.storage.sync`. Normalize it by removing a trailing slash and reject non-HTTP(S) origins. The popup should show the resolved origin and a clear connection error when it cannot be reached.

The extension manifest will need host permissions for the configured API origin. The MCPLab server must also allow extension-origin requests when the API is cross-origin. If authentication uses cookies, requests and EventSource connections must use the server's supported credential and CORS policy.

## Proposed extension architecture

Add a small API client layer inside Rover:

```text
src/mcplab/
  api-client.ts       HTTP requests and origin normalization
  events.ts           EventSource lifecycle and typed event parsing
  types.ts            Request and SSE payload contracts
  run-controller.ts   start, monitor, stop, and reconcile a job
```

For the Live Test bridge, the MCPLab application should own the long-lived Inspectr SSE connection. The Rover background service worker should own only the browser-tab interaction and the optional response handoff. This prevents a popup close from losing the browser operation without moving Inspectr session ownership into the extension.

Data flow:

```text
Rover popup
  -> list test cases
  -> create Live Test session
Rover background
  -> inject prompt and capture response
  -> submit final response
MCPLab
  -> subscribe to Inspectr SSE
  -> evaluate activity and final response
  -> persist and return Live Test result
```

## Start-run contract

The first implementation should support the existing `POST /api/runs` contract:

```ts
type StartRunRequest = {
  configPath: string;
  runsPerScenario?: number;
  scenarioId?: string;
  scenarioIds?: string[];
  agents?: string[];
  runNote?: string;
  serverOverrideAll?: string[];
  scenarioServerOverrides?: Record<string, string[]>;
};
```

The API returns `202` and a queue/job response. The exact response type should be imported or mirrored from the MCPLab route tests, then covered by Rover contract tests.

The current MCPLab implementation returns:

```ts
type EnqueueResult = {
  jobId: string;
  queued?: boolean;
  position?: number;
};
```

The current job SSE envelope is:

```ts
type RunJobEvent = {
  type: 'started' | 'log' | 'completed' | 'error' | 'queued' | 'oauth_required' | string;
  ts: string;
  payload: Record<string, unknown>;
};
```

These contracts are defined in the MCPLab source at:

- `/Users/tim.haselaars/Sites/mcp-evaluation/packages/cli/src/app-server/run-queue-domain.ts`
- `/Users/tim.haselaars/Sites/mcp-evaluation/packages/app/src/lib/data-sources/types.ts`

## SSE behavior

The controller should:

- Open the job stream immediately after enqueueing.
- Parse named SSE events as JSON.
- Persist every meaningful event so reopening the popup shows current state.
- Treat `completed`, `error`, and terminal OAuth/auth events as terminal.
- Close the EventSource on terminal state or explicit stop.
- Allow automatic reconnect for transient `CONNECTING` states.
- Reconcile after reconnect by fetching the job or run status so missed events do not leave Rover stuck.
- Ignore malformed events without crashing the background worker.

Initial event types should match the existing MCPLab client: `queued`, `started`, `log`, `completed`, `error`, and `oauth_required`. If the MCPLab route emits additional types later, preserve them in a generic event field before adding provider-specific UI.

## Popup experience

Extend the current notch popup with a second mode:

- `Chat smoke test`: existing Claude or TrendMiner flow.
- `MCPLab run`: API origin, config path, optional scenario, and start button.
- `Running`: compact progress state and latest event message.
- `Completed`: run identifier, result link or trace action, and final status.
- `Error`: readable error with retry and connection-settings actions.

Keep the first Phase 2 UI intentionally small. Do not add a full evaluation editor to the extension.

## Security and reliability requirements

- Never place API tokens or secrets in the extension source or manifest.
- Do not log request bodies that may contain sensitive evaluation data.
- Validate API origins before storing them.
- Scope host permissions to the configured MCPLab origins where possible.
- Cancel an existing job stream before starting a replacement for the same profile.
- Persist a request ID and job ID so stale events cannot overwrite a newer run.
- Surface server, CORS, authentication, timeout, and malformed-payload errors distinctly.

## Implementation sequence

1. Confirm the exact `POST /api/runs` response and event payloads from MCPLab tests.
2. Add typed API origin storage and an HTTP client with focused tests.
3. Add an EventSource wrapper with reconnect, close, and malformed-event tests.
4. Add background-worker run ownership and session persistence.
5. Add popup API settings and run controls.
6. Add end-to-end mock-server coverage for enqueue, SSE updates, completion, error, and reconnect.
7. Verify against a local MCPLab server, then a configured remote origin.

## Decisions to confirm before implementation

The coder should confirm these three product choices before writing the first API slice:

1. Which `configPath` should the Rover popup use initially, and should the user select it from a fetched list or paste it manually?
2. Should Phase 2 start full evaluation runs only, or also expose the existing scenario preview endpoint?
3. Does the target MCPLab deployment require login cookies, an extension token, or same-origin access through the active MCPLab tab?

## Acceptance criteria

- Rover can enqueue a valid MCPLab run from the popup.
- The popup shows live job status after it is reopened.
- Completed and failed jobs reach a terminal state without polling loops.
- A transient SSE disconnect reconnects or reconciles without losing the final status.
- A stale job event cannot overwrite a newer run.
- Origin configuration works for local and remote MCPLab deployments.
- Phase 1 Claude and TrendMiner smoke tests remain unchanged and passing.
