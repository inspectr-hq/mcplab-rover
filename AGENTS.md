# Agent Instructions

## Git workflow

- Prefer working on the existing checked-out branch.
- Do not create or use Git worktrees unless the user approves it first.
- Keep Git commit messages compact and use Conventional Commit format, such as `feat: add LangSmith tracing`.
- After each meaningful implementation stage, provide a suggested Conventional Commit message as a review checkpoint.
- Suggested commit messages are for the user to apply after reviewing the stage; do not create, stage, or amend commits unless the user explicitly asks.

## Release review

- Before recommending a branch for release, review the complete branch diff against its base, including committed and uncommitted changes.
- Check behavior and regression risk, not only test results: inspect edge cases, error paths, stale-result handling, and compatibility with persisted data.
- Check architecture: keep logic in its owning domain, reuse shared types/helpers, and identify duplicated formatting, matching, aggregation, or conversion logic.
- Add or verify focused regression tests for each confirmed bug, then run the relevant full test suites, typechecks, builds, and `git diff --check`.
- Report findings by severity with file and line references. Do not call a branch release-ready while unresolved correctness, duplication, or domain-placement issues remain.
