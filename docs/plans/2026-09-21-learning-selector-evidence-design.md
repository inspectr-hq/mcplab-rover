# Learning Selector Evidence Design

## Problem

Copilot exposed a working element with `name="[object Object]"`, `role="article"`, and `aria-busy="true"`. Rover chose the `name` attribute as the primary locator even though the value is serialization noise. Browser replay correctly rejected that locator. MCPLab selected the already-observed `div[aria-busy="true"]` alternative, but the Learn proposal comparison did not display `workingLocator`, so the correction was hidden.

## Design

Keep the existing Learning and replay architecture. Selector construction will ignore object-string attribute values. When recording an active working element, Rover will combine its strongest remaining semantic selector with the explicit `aria-busy="true"` state. For Copilot this produces `[role="article"][aria-busy="true"]`, avoiding both the malformed name and unrelated generic busy regions. This changes only the primary working locator; the existing selector alternatives remain available as evidence.

The proposal comparison will add a separate **Working** entry between Generation and Idle. It will compare `completion.workingLocator` exactly like the existing lifecycle locator rows, making MCPLab corrections visible before Save.

No runtime lifecycle rules, completion timing, trace schema, or MCPLab persistence format will change.

## Verification

- A Copilot-style busy article with `name="[object Object]"` learns `[role="article"][aria-busy="true"]` as its primary working locator.
- Object-string attributes are absent from recorded selector alternatives.
- The proposal summary exposes a Working change independently of Generation and Idle.
- Focused tests, the complete Rover suite, production build, and `git diff --check` pass.
