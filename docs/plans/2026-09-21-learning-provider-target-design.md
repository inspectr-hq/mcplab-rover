# Learning Provider Targeting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Learning update the intended browser provider profile without making runtime URL matching stricter or breaking existing provider IDs and agent references.

**Architecture:** Learning will receive the set of provider profiles that are plausible for the current page, using origin and live DOM capability checks. The popup will display an explicit target, ask the user to choose when more than one profile is plausible, and carry the selected provider ID through save. New profiles keep the current name-based creation flow. Existing browser-agent launch URLs will remain separate from provider behavior, with the current page URL captured for newly created agents.

**Tech Stack:** TypeScript, Chrome extension messaging, Vitest, existing browser-provider profile and discovery contracts.

---

### Task 1: Define the Learning target contract

**Files:**
- Modify: `src/contracts.ts`
- Test: `tests/learning-target.test.ts`

**Step 1: Write the failing tests**

Add tests for a Learning target model that distinguishes:

- no existing provider, which means create a new provider;
- exactly one matching provider, which means update that provider by ID;
- multiple matching providers, which requires explicit selection;
- an existing provider ID being preserved even when the display name changes.

**Step 2: Run the focused test**

Run: `npx vitest run tests/learning-target.test.ts`

Expected: FAIL because the target types and selection helper do not exist yet.

**Step 3: Implement the minimal contract**

Add a serializable Learning target shape to the extension contracts. Keep `targetProviderId` optional so old messages and old persisted drafts remain valid. Include the current page URL separately from the provider ID so the provider identity is not inferred from the URL.

**Step 4: Run the focused test**

Run: `npx vitest run tests/learning-target.test.ts`

Expected: PASS.

### Task 2: Expose all plausible providers from the content script

**Files:**
- Modify: `src/providers/index.ts`
- Modify: `src/content.ts`
- Modify: `src/contracts.ts`
- Test: `tests/providers.test.ts`

**Step 1: Write the failing tests**

Add tests proving that same-origin profiles are evaluated independently and that the result contains every profile whose `matchesPage()` and `canHandle()` checks pass, rather than only the first provider returned by `findPageAdapter()`.

Include a generic Copilot profile and a Lumen profile with different composer selectors. Verify that the correct profile is returned on each corresponding page state.

**Step 2: Run the focused tests**

Run: `npx vitest run tests/providers.test.ts`

Expected: FAIL because the multi-provider discovery helper and message do not exist.

**Step 3: Implement the minimal capability**

Add a helper for listing matching learned profiles. Add a content-script message that returns the matching provider IDs and the current page URL. Do not change `findPageAdapter()` or runtime provider selection.

**Step 4: Run the focused tests**

Run: `npx vitest run tests/providers.test.ts`

Expected: PASS.

### Task 3: Make the background layer provide profile metadata to Learning

**Files:**
- Modify: `src/background/messages.ts`
- Modify: `src/background/socket.ts`
- Modify: `src/contracts.ts`
- Test: `tests/background-messages.test.ts` or the existing background message test file

**Step 1: Write the failing tests**

Test that the new background request returns matching provider IDs and enough metadata for the popup to display provider name and ID. Test that a page with no matching learned profile returns an empty target list without failing.

**Step 2: Run the focused tests**

Run: `npx vitest run tests/background-messages.test.ts`

Expected: FAIL because the message is not handled.

**Step 3: Implement the minimal message flow**

Add a read-only message for Learning target discovery. Reuse the profiles already loaded from MCPLab. Preserve the current active-provider detection and registration behavior.

**Step 4: Run the focused tests**

Run: `npx vitest run tests/background-messages.test.ts`

Expected: PASS.

### Task 4: Add explicit target selection to the Learning UI

**Files:**
- Modify: `src/popup/main.ts`
- Modify: the popup HTML and CSS files containing the Learning panel
- Modify: `src/popup/view-model.ts`
- Test: `tests/popup-view-model.test.ts`

**Step 1: Write the failing tests**

Test the view model for these states:

- “Create new provider” when there are no matches;
- “Update provider” when there is one match;
- a required provider selector when there are multiple matches;
- update mode retaining the selected provider ID.

**Step 2: Run the focused tests**

Run: `npx vitest run tests/popup-view-model.test.ts`

Expected: FAIL because the target presentation helpers do not exist.

**Step 3: Implement the minimal UI**

When entering Learning mode, request matching profiles and show a compact target section:

```text
Learning target
Provider: TrendMiner Agent Lumen
ID: copilot-cloud-microsoft-lumen
Mode: Update existing provider
```

When multiple profiles match, show a selector. When none match, show that a new provider will be created. Keep the existing provider-name field for new profiles and make it a display-name field for updates.

Do not force URL-prefix matching. Show the current page URL as the separate browser-agent starting URL.

**Step 4: Run the focused tests**

Run: `npx vitest run tests/popup-view-model.test.ts`

Expected: PASS.

### Task 5: Preserve provider identity and save the correct agent URL

**Files:**
- Modify: `src/popup/main.ts`
- Modify: `src/contracts.ts`
- Modify: `src/mcplab/api-client.ts` only if the request payload needs an explicit target ID
- Test: `tests/learned-execution.test.ts` and a new save-flow test if needed

**Step 1: Write the failing tests**

Test that updating a selected provider:

- sends the original provider ID;
- does not regenerate the ID from the display name;
- sends the current full page URL as the browser-agent URL;
- leaves new-provider creation name-based.

Test a Lumen URL and verify the generated agent URL remains the full `/chat/agent/...` URL rather than only the origin.

**Step 2: Run the focused tests**

Run: `npx vitest run tests/learned-execution.test.ts`

Expected: FAIL because the save flow currently derives both identity and agent URL incorrectly for this case.

**Step 3: Implement the minimal save behavior**

For update mode, merge the newly learned behavior into the selected provider identity and preserve its ID. For create mode, keep the current generated ID behavior. Pass the current tab URL as the new browser-agent URL, while keeping the provider profile’s `new_conversation.url` as the lifecycle navigation target.

Keep old saved profiles and old saved agents valid. Do not rewrite existing agent URLs automatically.

**Step 4: Run the focused tests**

Run: `npx vitest run tests/learned-execution.test.ts`

Expected: PASS.

### Task 6: Add compatibility and regression coverage

**Files:**
- Modify: `tests/providers.test.ts`
- Modify: `tests/popup-view-model.test.ts`
- Modify: `tests/learned-execution.test.ts`
- Create or modify: `docs/README.md` or the existing provider-learning documentation location

**Step 1: Add regression cases**

Cover:

- generic Copilot and Lumen sharing the same origin;
- updating Lumen without changing `copilot-cloud-microsoft-lumen`;
- creating a new provider on an unsupported or unmatched page;
- multiple same-origin candidates requiring a user choice;
- legacy drafts without a target ID loading without errors.

**Step 2: Run the complete verification set**

Run:

```bash
npx vitest run
npm run typecheck
npm run build
git diff --check
```

Expected: all tests, typecheck, build, and whitespace validation pass.

**Step 3: Review the complete diff**

Confirm that only the Learning target flow, provider save identity, browser-agent URL handling, tests, and documentation changed. Do not modify existing provider or agent files automatically.

Suggested commit message after review: `feat: target learned provider profiles explicitly`
