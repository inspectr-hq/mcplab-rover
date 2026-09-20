# Rover state detection map

Reviewed against the working tree on 2026-09-20. This describes the current implementation, including the uncommitted change in `src/providers/discovery-replay.ts`. It is an inventory of behavior, not a proposed design.

## Terms

- **Strong deterministic signal:** a directly observed browser event or DOM property. It proves only that event or property, not the provider's underlying work state.
- **Heuristic:** an interpretation of page text, selectors, visibility, or a DOM change.
- **Timing-based heuristic:** an inference from elapsed time without a provider completion event.
- **Selector-dependent:** the result changes with the saved selector or the page's DOM structure.

## Visual flow at a glance

The diagrams show the usual order of observations. Generation and the response candidate can appear in either order. Learning can emit without observing generation, and runtime can capture when only a changed response was observed. The vertical layout does not imply that every box is a required prerequisite.

```text
LEARNING: observations used to build a profile and trace

  +---------------------------------------------------------------+
  | USER INTERACTION                                              |
  | Focus or input on a contenteditable, textarea, or input.      |
  | Rover treats that element as the composer.                    |
  +---------------------------------------------------------------+
                              |
                              | input arms scanning, or a possible submit
                              | interaction permits scanning
                              | [observed event + heuristic meaning]
                              v
  +---------------------------------------------------------------+
  | SUBMITTED DETECTED                                            |
  | Click labelled send/submit/enter/ask/run, non-Shift Enter,    |
  | or form submit. Another button click with a known composer   |
  | can set submittedAt without recording a submitted event.     |
  +---------------------------------------------------------------+
                              |
                              | MutationObserver scan or 500 ms poll
                              | [selector-dependent heuristic]
                              v
  +---------------------------------------------------------------+
  | GENERATION DETECTED                                           |
  | Visible Stop/Cancel/Abort control OR visible disabled         |
  | Send/Submit/Ask/Run HTML button. observedGeneration latches.  |
  +---------------------------------------------------------------+
                              |
                              | Same scan also scores response candidates;
                              | candidate may appear before generation
                              | [heuristic]
                              v
  +---------------------------------------------------------------+
  | ASSISTANT CANDIDATE SELECTED                                  |
  | Visible nonempty element, score >= 12, assistant marker.     |
  | Highest score wins; later DOM element breaks a tie.          |
  +---------------------------------------------------------------+
                              |
                              | After generation was observed: no generating
                              | control and enabled Send-like control
                              | [selector-dependent heuristic]
                              v
  +---------------------------------------------------------------+
  | IDLE INFERRED                                                |
  | Rover records idleObserved. This does not observe agent work. |
  +---------------------------------------------------------------+
                              |
                              | Composer + candidate + current idle/no
                              | generation + unchanged scan signature 500 ms
                              | [timing-based heuristic]
                              v
  +---------------------------------------------------------------+
  | LEARNING DRAFT EMITTED / FINAL SNAPSHOT                      |
  | If generation was never observed, composer + candidate alone |
  | can emit a draft. Manual Capture uses that same weaker gate.  |
  +---------------------------------------------------------------+
```

```text
RUNTIME: executing a learned provider profile

  +---------------------------------------------------------------+
  | USER / ROVER SEND ACTION                                      |
  | Baseline old responses; insert prompt; wait 150 ms;          |
  | click saved submit locator or use Enter path.                 |
  +---------------------------------------------------------------+
                              |
                              | poll every 100 ms, up to 120 seconds
                              | [selector-dependent]
                              v
  +---------------------------------------------------------------+
  | GENERATION OBSERVED                                           |
  | Saved generating locator matches, OR fallback Stop control   |
  | or disabled submit matches. Historical flag latches.         |
  +---------------------------------------------------------------+
                              |
                              | Saved assistant locator supplies candidates;
                              | this can happen before generation is sampled
                              | [selector-dependent heuristic]
                              v
  +---------------------------------------------------------------+
  | RESPONSE CANDIDATE SELECTED                                  |
  | Last visible, nonempty locator match with text different from |
  | the pre-send baseline. responseObserved flag latches.        |
  +---------------------------------------------------------------+
                              |
                              | Generating locator absent (or fallback false);
                              | idle locator present (or fallback true)
                              | [selector-dependent heuristic]
                              v
  +---------------------------------------------------------------+
  | CURRENT IDLE INFERRED                                         |
  | This is a sampled DOM state, not proof of completed work.     |
  +---------------------------------------------------------------+
                              |
                              | Nonempty selected text unchanged 2,500 ms;
                              | >= 500 ms since poll start; !isGenerating;
                              | isIdle; generationObserved OR responseObserved
                              | [timing-based + selector-dependent heuristic]
                              v
  +---------------------------------------------------------------+
  | COMPLETION INFERRED / RESPONSE CAPTURED                      |
  | A later tool result or resumed stream can still arrive.      |
  +---------------------------------------------------------------+
```

## Learning flow

```text
Start learning
  → baseline snapshot: immediately, plus the first input focus/input event
    [strong deterministic signal for the event; selector-dependent snapshot]
  → composer: focused or inputting contenteditable, textarea, or input
    [strong deterministic signal for interaction; heuristic that this is the chat composer]
  → submission armed: any input into that element
    [strong deterministic input event; heuristic that a submission is forthcoming]
  → submitted: click on a button/role=button with send|submit|enter|ask|run
                 in aria-label, text, or data-testid; non-Shift Enter anywhere;
                 or any form submit. A different button click can set submittedAt
                 if a composer exists, without recording a submitted event.
    [strong deterministic interaction; heuristic that it submitted a chat prompt]
  → scan: only after submission is armed or submitted; runs on observed DOM
           mutation and every 500 ms. Open shadow roots existing when Learning
           started are observed; every scan also traverses currently open roots.
    [selector-dependent, heuristic]
  → generating event: each scan that finds a visible stop/cancel/abort-labelled
           button or role=button, or a visible disabled HTML button labelled
           send/submit/ask/run. `observedGeneration` latches true.
    [heuristic, selector-dependent]
  → candidate event: on a changed scan signature when a visible, nonempty
           candidate scores at least 12 and has an assistant marker. If no
           candidate is selected, the changed scan records `baseline` instead.
    [heuristic, selector-dependent]
  → idleObserved progress flag: a scan after `observedGeneration` is true where
           an enabled send/submit/ask/run control exists and no generating
           control is detected. The flag latches true.
    [heuristic, selector-dependent]
  → final snapshot/draft: composer and selected assistant element both exist,
           and either generation was never observed, or an idle control exists,
           no generating control exists, and the selected scan signature has
           stayed unchanged for at least 500 ms. Manual Capture needs only
           composer and assistant, bypassing the automatic readiness condition.
    [heuristic; timing-based heuristic when generation was observed]
```

Learning has no strict finite-state machine. `baseline`, `submitted`, `generating`, `candidate`, and `final` are trace event labels. They can repeat; `baseline` can be recorded after submission. `submittedAt` and `submissionArmed` gate scanning, but `submittedAt` does not expire. A generation event can be recorded on every scan while a matching control persists. The trace trims toward 32 events while preserving every `baseline` and `submitted` event, so it can exceed 32 if those preserved events alone do. Each snapshot keeps the last 64 matching page elements. A mutation does not automatically create a snapshot. The 500 ms learning stability clock uses a scan signature built from candidate count, selected tag/test ID, and the first 120 characters of up to eight changed candidate texts; changes outside that signature do not reset it.

## Runtime flow for a learned provider

```text
Profile matches page origin and composer locator resolves
  → `ask()` samples existing assistant candidates and page alert as baseline
    [selector-dependent]
  → prompt inserted; wait 150 ms; click saved submit locator or use Enter path
    [strong deterministic action; selector-dependent]
  → poll every 100 ms, up to 120 seconds
    [timing-based]
  → current candidates: all matches of saved assistant locator, with text,
    visibility, and a key built from profile id, DOM index, and textContent length
    [selector-dependent]
  → selected response: last visible nonempty candidate whose normalized text
    differs from the baseline candidate with the same key
    [heuristic, selector-dependent]
  → generation observed: any sampled `isGenerating=true` latches true;
    `responseObserved=true` also latches when a candidate is selected
    [selector-dependent, heuristic]
  → current generating: saved generating locator matches, if configured;
    otherwise a visible stop/cancel/abort control in the light DOM, or a
    disabled submit control
    [selector-dependent, heuristic]
  → current idle: saved idle locator matches, if configured; otherwise
    `!generating` and a submit control or composer exists
    [selector-dependent, heuristic]
  → captured response: nonempty selected text unchanged for 2,500 ms,
    at least 500 ms since polling began, current `!isGenerating`, current
    `isIdle`, and either generation or response was observed earlier.
    [timing-based heuristic plus selector-dependent checks]
```

The saved profile's `completion.stabilityMs` is 2,500 ms when generated, but runtime `ask()` uses its own 2,500 ms value for learned providers and 1,500 ms for Claude. The tracker checks text equality between 100 ms polls. DOM mutations, network activity, tool calls, and animations outside the selected text do not reset the stability timer. `generationObserved` is historical; `isGenerating` and `isIdle` are current sampled values. The learned adapter sets `requiresGenerationSignal=true`, but the tracker accepts **generation observed OR response observed**. It does not require both.

For built-in adapters, ChatGPT considers a matching Stop button present as generating and otherwise idle. Claude considers a Stop control or `[data-is-streaming="true"]` as generating; idle also requires a completed streaming container or enabled submit button. These adapters use the same runtime tracker but their own candidate selectors and state checks.

## New conversation flow

```text
Learning draft emission
  → find visible, enabled controls whose accessible label, title, test
    attribute, tracking attribute, or text matches a new-chat phrase
    [heuristic, selector-dependent]
  → save first anchor URL as navigate action, or first control and all found
    control locators as click action
    [selector-dependent]

Learned runtime click action
  → find first matching configured locator and click it
    [selector-dependent]
  → poll every 50 ms for up to 15 seconds until composer exists, is empty,
    and either a previously nonempty composer cleared, assistant candidate
    count fell, URL changed, or any document.body mutation settled for 100 ms
    [heuristic; last condition is timing-based heuristic]
```

The learned `newConversation` control locates an action to perform. Its identity is not proof that a new conversation opened. The click path subsequently uses page changes as readiness evidence. The navigate path calls `location.assign(url)` and returns without the readiness poll. The built-in ChatGPT adapter clicks a fixed selector or navigates to the home URL, also without this readiness poll.

## Trace, profile, and replay

Each trace event stores phase, timestamp, candidate/control counts, optional selected candidate tag/test ID/text length/hash, and a compact snapshot. Snapshot rows keep selector, tag, optional role/aria-label/test ID, visibility, disabled flag, and text length. The snapshot contains no complete response text, HTML structure, control title, data-test, author role, class, candidate score, ranking, ancestor roles, or full shadow-root path. The trace has an overall `observedGeneration` flag and final `selectorValidation` summary; replay does not consult that summary.

The generated profile stores origin, composer and assistant locators, submit action/locator, generation and idle locators, an optional new-conversation action, and confidence labels. Runtime uses that profile, not the trace. The popup sends both profile and retained trace to MCPLab's proposal endpoint when the user requests AI improvement. Rover replays the proposed profile against the same trace before enabling Save. The trace and proposal diagnostics are also sent to MCPLab when Save is clicked.

Replay currently checks only selector strings against snapshots by phase:

1. Composer's **last locator segment** occurs in any baseline or submitted snapshot.
2. Click submit's **last segment** occurs in a submitted snapshot. Enter submit skips this check.
3. Assistant's **last segment** occurs in a candidate or final snapshot.
4. A generating locator exists, `trace.observedGeneration` is true, and its **last segment** occurs in a generating snapshot.
5. If an idle locator exists, its **last segment** occurs on an enabled row in a final snapshot. If no idle locator exists, replay fails only when the generating selector is still represented as active in a final snapshot.

Replay does not execute selectors against the page, verify the full shadow path, compare the selected candidate to the assistant selector, verify a submit caused the response, or prove the profile can drive another run. The no-idle-locator branch can pass when the final snapshot omits the generating control, including omission caused by the 64-row limit. New-conversation locators are not replayed.

## Source locations

- Learning event capture, candidate scanning, and profile emission: `src/providers/provider-discovery.ts`.
- Learning candidate scoring: `src/providers/candidate-descriptor.ts`.
- Compact trace schema: `src/contracts.ts`.
- Replay: `src/providers/discovery-replay.ts`.
- Learned runtime adapter and new-conversation readiness: `src/providers/learned.ts`.
- Runtime response selection and completion: `src/runtime/candidate-selection.ts`, `src/runtime/response-tracker.ts`, `src/runtime/ask.ts`.
- Built-in runtime adapters: `src/providers/chatgpt.ts`, `src/providers/claude.ts`.
