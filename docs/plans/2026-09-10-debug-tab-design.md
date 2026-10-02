# Rover Debug Tab Design

## Goal

Give troubleshooting users a live, readable snapshot of MCPLab connectivity, active-page matching, provider element presence, and Rover session state.

## Design

The popup adds a Debug tab. Opening it requests a diagnostic snapshot immediately, refreshes every two seconds while the tab is selected, and offers a manual Refresh button. Polling stops when the user leaves Debug.

Provider adapters own their semantic element checks, so the Debug tab does not duplicate provider selectors. The background combines those active-tab checks with an MCPLab endpoint check and persisted Rover state before returning one snapshot to the popup.

The snapshot reports the endpoint origin and error, active tab URL and ID, matched provider, provider element checks, current mode/session status, and queue status. Missing content scripts are injected through the existing provider detection path.

## Error handling

Endpoint failures remain visible as a disconnected indicator with the server error. Unsupported or inaccessible tabs produce a page mismatch indicator and a useful diagnostic message. Individual missing elements do not fail the whole snapshot.

## Scope

The first version is read-only. It does not add repair actions, selector editing, or background polling when Debug is closed.
