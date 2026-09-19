# Console Debug Logging Design

## Goal

Add a persistent popup setting that controls Rover's verbose `[Rover debug]` console messages, defaulting to off while leaving operational warnings and errors visible.

## Design

The existing MCPLab connection settings section will contain a `Console debug logging` checkbox. The preference will be stored in `chrome.storage.local` under `rover.debugLogging`, which keeps this development-oriented preference local to the browser and avoids syncing it between devices.

Background and content scripts will use a shared cached debug logger. The cache is initialized from storage, updated when the popup changes the preference, and defaults to disabled until storage has been read. Debug messages will be emitted only when enabled. Existing `[Rover]` warnings and errors remain unconditional.

The popup will read the stored preference when initialized and write changes immediately. No change is needed to the existing Debug tab, which provides diagnostics independently of console verbosity.

## Verification

- Test the storage default and preference persistence.
- Test that the debug logger suppresses messages by default and emits them when enabled.
- Test popup setting initialization and updates where practical.
- Run the full Vitest suite, TypeScript checks, Vite build, and `git diff --check`.
