# Provider-Scoped Rover Queue and Recent History

## Goal

Make the injected Rover panel show only evaluations that are relevant to the active browser provider, while keeping MCPLab as the global queue and durable result history.

## Architecture

Rover continues to use one background worker and one MCPLab WebSocket connection per browser profile. Each injected panel is a view of shared Rover state, but it renders a provider-specific projection.

The queue state contains the current assignment. Completed items are archived in recent history grouped by provider. Each provider retains at most five completed items.

MCPLab-managed assignments remain read-only in Rover. Local Rover queues remain editable.

## Provider behavior

The active browser tab determines the provider context. Rover detects that provider and asks the background worker for the matching queue projection.

When the active tab changes:

1. Rover detects the new provider.
2. The background worker updates its existing MCPLab registration.
3. Rover renders the new provider's active queue and recent history.
4. MCPLab may assign a waiting job for that provider.

A running job remains bound to the tab selected when execution started. Switching tabs affects future assignments and visibility, not the destination of an in-flight job.

## UI

The Queue view contains:

```text
Queue
  Current provider queue
    waiting and running items

Recent {provider} evaluations
  up to five completed items
```

Completed items show their outcome and a result link when available. Unsupported pages show no provider-specific jobs. Empty history uses a clear provider-specific message.

For MCPLab-managed queues, Rover hides add, reorder, delete, and local run controls. Status, stop, retry where applicable, and result navigation remain available.

## Persistence and edge cases

- Recent history is stored in Rover session storage.
- It survives popup close and tab changes, but not the end of the browser session.
- Completed, failed, stopped, skipped, and incomplete items are history entries.
- Running items are archived only after completion.
- When a new MCPLab assignment replaces the current assignment, completed items are archived under the provider that executed them.
- MCPLab restart reconciliation continues to govern active managed work.
- MCPLab remains the durable source for older results and cross-provider history.

## Verification

Add focused tests for:

- provider-specific queue projections;
- recent-history capping at five items per provider;
- archiving completed assignments during replacement;
- hiding edit controls for MCPLab-managed queues;
- tab switching and provider changes;
- popup close and reopen;
- preserving active-job tab ownership;
- result links and outcome rendering.

