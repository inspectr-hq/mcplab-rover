# Rover state-detection map

Reviewed against the working tree on 2026-09-20. This describes browser observations and inferences, not provider-side truth. A visible Stop control, an empty composer, and stable response text do not prove an agent has finished.

## Learning: one observed request

```text
USER INTERACTION
  focus/input on an editable element
  [observed fact, heuristic composer identification]
       |
       v
SUBMITTED LABEL RECORDED
  click on a Send/Submit/Enter/Ask/Run-labelled control,
  non-Shift Enter, or form submit
  [observed interaction, heuristic submission inference]
       |
       v
GENERATION / WORKING OBSERVED
  visible Stop/Cancel/Abort or disabled send-like button;
  independently, selected assistant's ancestor has aria-busy=true
  [selector-dependent DOM fact, heuristic work inference]
       |
       v
ASSISTANT CANDIDATE SELECTED
  visible, nonempty, changed element with assistant marker and score >= 12;
  selected element, selector alternatives, score, and baseline relation retained
  [heuristic selection]
       |
       v
ACTIVITY ENDS AND RESPONSE SETTLES
  generating control absent with ready control present, or busy ancestor
  becomes inactive; selected scan signature unchanged for >= 500 ms
  [selector-dependent and timing inference]
       |
       v
PROFILE REPLAY
  selectors must identify Rover's selected semantic elements;
  selected response must change after submission and be a new turn;
  generation or working evidence must precede final evidence
  [evidence validation, not live execution proof]
```

Learning scans after a submission interaction, from MutationObserver activity on roots present when Learning starts and a 500 ms poll that traverses currently open shadow roots. Typing alone and clicking an unrelated button no longer arm a request. `submittedAt` has no expiry, and Enter or form submit remains an inference, not a provider acknowledgement. A draft may be emitted before generation is observed, but replay will not mark it saveable without a generation or working-to-ready observation.

The assistant score uses metadata including test IDs, author role, class, role, visibility, text, and whether text changed from the pre-Learn baseline. It rejects obvious user, loading, and control elements. This is a classifier, not proof of authorship. When multiple matches remain, the highest score wins, with later DOM order breaking ties. A selected assistant element must be absent at submission. If it exposes `data-message-id`, `data-turn-id`, `data-id`, or `id`, that value must also be new. For anonymous turns, the assistant-marked candidate count must grow. A provider that reuses one anonymous response container may therefore fail Learning conservatively.

The trace pins the first baseline, submitted, generating, and working events, then retains recent events up to 32 total. Each event includes counts, selected semantic elements and their selector alternatives, match quality, relevant attributes, and text length/hash, but not full response text. Working activity is false when a previously busy element is removed. A final event records the selected assistant and ready control when available. The 500 ms Learning stability signature is based on selected/candidate metadata and a bounded preview of changed candidates; changes outside that signature may not reset it.

## Runtime: one Rover request

```text
ROVER SEND ACTION
  sample existing assistant turns, set composer text, wait 150 ms, submit
  [observed local action, selector assumption]
       |
       v
POLL DOM EVERY 100 MS
  resolve saved assistant and activity locators, up to 120 seconds
  [selector-dependent observation]
       |
       v
NEW ASSISTANT TURN SELECTED
  visible nonempty matching element not present in the baseline;
  provider ID survives rerender, anonymous node identity survives streaming;
  changed pre-existing turn and same-count anonymous replacement are refused
  [heuristic request association]
       |
       v
ACTIVITY SAMPLED
  visible generating locator or fallback Stop/disabled submit;
  visible working locator independently; visible idle locator or fallback
  composer/submit availability
  [selector-dependent UI facts]
       |
       v
COMPLETION INFERRED
  selected text and turn unchanged for profile stabilityMs (normally 2,500 ms),
  at least 500 ms since poll start, currently !generating, !working, idle,
  and historical generation or selected response observed
  [timing and selector inference]
```

Any text change, turn change, generation resumption, working activity, or non-idle sample resets the runtime stability window. The profile's `stabilityMs` is used. Hidden generating and idle controls do not count. A tool call outside tracked DOM, a network pause, or a silent agent can still look idle. No browser-only algorithm can claim completion from text stability alone in that case, so this result remains an inference. Runtime has a request-local baseline and selected turn key, not a provider request ID.

## New conversation

```text
LEARNING
  find visible control labelled New Chat/New Conversation/New Thread
  [selector-dependent heuristic]
       |
       +--> anchor URL: configure navigate action
       |    [action available, opening not observed during page unload]
       |
       +--> click control: require observed click followed by URL change
            or assistant-count reduction and an empty ready composer
            [context-change evidence, not a conversation ID]

RUNTIME CLICK
  choose a visible, New Chat-labelled match from configured locators;
  click actionable child if the selector targets a wrapper;
  wait up to 15 seconds for empty composer plus URL change or
  assistant-count reduction
  [selector assumption plus observed context change]
```

A click-based learned profile is not saveable until Learning observes its context change. Unrelated mutations and composer clearing alone are insufficient. Saved older profiles without the confirmation strategy retain their previous fallback. A navigation action calls `location.assign`; background waits for the tab and provider, but the URL alone does not prove a fresh semantic conversation. Same-URL, unchanged-count transitions without another observable marker remain unsupported rather than falsely confirmed.

## Profile, Judge, and replay boundary

The generated profile contains selectors and completion/New Chat strategies, not the trace. Rover replays a proposed profile against the retained selected-element evidence before enabling Save. Replay checks selected composer, submit, assistant, generating, working, idle, and confirmed New Chat elements when present, plus event order and response change/new-turn evidence. It does not execute a second request, prove that the matched element is semantically correct, or observe server-side agent state.

MCPLab sanitizes the richer trace for Judge AI, retaining selected elements, selector evaluations, activity flags, and New Chat context evidence while excluding raw response text. MCPLab also preserves `workingLocator`, alternate New Chat locators, and click confirmation through validation and YAML persistence. Existing schema-version-1 profiles without these optional fields remain readable. The Judge sees evidence and may propose changes; Rover's browser replay remains the final pre-save check.

Source: `src/providers/provider-discovery.ts`, `src/providers/candidate-descriptor.ts`, `src/providers/discovery-replay.ts`, `src/providers/learned.ts`, `src/providers/turn-identity.ts`, `src/runtime/candidate-selection.ts`, `src/runtime/response-tracker.ts`, and `src/runtime/ask.ts`.
