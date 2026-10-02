# MCPLab Rover Popup Notch Design

## Goal

Give the existing Chrome extension popup a compact, MCPLab-branded notch interface inspired by the supplied Claude Usage reference, while preserving the current smoke-test and response-copy workflow.

## Direction

The action popup remains the host surface. It will use a dark rounded panel with a small right-edge notch and a compact header. The smoke-test control is the primary action. When a run is active, the panel shows a loading state. When a response is available, the panel expands its response tray and keeps Copy response available.

## Visual language

- Black and near-black surfaces with soft depth shadows.
- MCPLab orange as the active accent, using the existing favicon asset.
- Warm white primary text and muted gray secondary text.
- Rounded geometry and a right-edge speech-notch silhouette, implemented with CSS pseudo-elements.
- Dense extension-popup sizing, with a capped response area so long answers remain scrollable.

## Interaction

- The popup opens in a compact ready state.
- Run smoke test is the primary full-width control.
- Running disables the control and shows a subtle progress indicator.
- Completed responses reveal the response tray and Copy response action.
- Errors remain readable without changing the existing runtime behavior.

## Constraints

- No changes to provider detection, prompt injection, response tracking, or background messaging.
- No new dependencies.
- Keep the existing `rover.html` entry point and icon files.
- Use the current DOM IDs so `src/popup/main.ts` remains compatible.
