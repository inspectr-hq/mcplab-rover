# Tag-Driven Extension Versioning Implementation Plan

**Goal:** Make release tags the source of truth for the browser extension version while keeping local builds on a safe development version.

**Architecture:** The build will run a small Node script after Vite copies the extension into `dist/`. The script reads `GITHUB_REF_NAME`, validates release tags in the `vX.Y.Z` format, strips the leading `v`, and writes the numeric version to `dist/manifest.json`. Builds without a release tag use `0.0.0`. The release workflow continues to name and create GitHub releases from the same tag.

**Tech Stack:** Node.js ESM build script, Vite, Chrome Manifest V3, Vitest.

---

### Task 1: Add version-resolution tests

**Files:**
- Create: `tests/extension-version.test.ts`
- Create: `scripts/set-extension-version.mjs`

Write tests for valid release tags, invalid tags, local fallback behavior, and manifest version replacement. Run the focused tests first and confirm they fail because the helper does not yet exist.

### Task 2: Implement manifest version injection

**Files:**
- Modify: `scripts/set-extension-version.mjs`
- Modify: `package.json`
- Modify: `public/manifest.json`

Implement the resolver and a CLI that reads `dist/manifest.json`, sets its version, and writes it back. Use `0.0.0` when no release tag is present. Make `npm run build` invoke the script after Vite completes, and keep the source manifest valid with the development version.

### Task 3: Verify release behavior

**Files:**
- Modify: `.github/workflows/release.yml`

Make the release workflow call the normal build with its tag environment, so an invalid release tag fails before the ZIP and GitHub release are created. Keep the ZIP and release names derived from `GITHUB_REF_NAME`.

Run the focused tests, the full test suite, the production build, and `git diff --check`. Inspect the generated manifest for both the local fallback and a simulated release tag.
