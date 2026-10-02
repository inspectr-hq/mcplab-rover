# Popup Notch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restyle the MCPLab Rover extension popup as a compact, expandable MCPLab notch while preserving smoke-test behavior.

**Architecture:** Keep the existing popup DOM IDs and TypeScript state flow. Add semantic state classes and small markup hooks only where needed, then replace the light utility CSS with a dark notch shell, accent ring, progress treatment, and response tray. Verify with the existing tests, typecheck, and production build.

**Tech Stack:** HTML, TypeScript, CSS, Vite, Vitest.

---

### Task 1: Add notch-oriented markup hooks

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/rover.html`
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/popup/main.ts`

**Steps:**

1. Preserve `#provider`, `#run`, `#status`, `#result`, and `#copy` IDs.
2. Add compact brand, status, and response-tray wrappers that do not own runtime logic.
3. Add a root state class from `render()` so ready, running, completed, and error states can style independently.
4. Keep the current browser messaging and clipboard behavior unchanged.

### Task 2: Implement the MCPLab notch visual system

**Files:**
- Modify: `/Users/tim.haselaars/Sites/mcp-lab-rover/src/popup/style.css`

**Steps:**

1. Set the popup canvas to a dark MCPLab surface with a rounded outer shell and right-side notch silhouette.
2. Style the favicon as a compact accent mark with a subtle orange halo.
3. Style the primary action with orange accent, disabled running state, and focus-visible treatment.
4. Style response output as a scrollable dark tray with readable monospace text.
5. Add a compact progress line and accessible status contrast.
6. Ensure the layout stays usable at the extension popup width and does not depend on external assets.

### Task 3: Verify the popup build

**Files:**
- Test: `/Users/tim.haselaars/Sites/mcp-lab-rover/tests`

**Steps:**

1. Run `npm test` and confirm all existing behavior tests pass.
2. Run `npm run typecheck` and confirm the popup changes typecheck.
3. Run `npm run build` and confirm `dist/rover.html` and popup assets are generated.
4. Run `git diff --check` and inspect the final diff for accidental runtime changes.
