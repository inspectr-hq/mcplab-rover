# MCPLab Rover README design

## Goal

Create a product-first repository README that explains why Rover exists, how it works with MCPLab, and how to install and use it without overstating current capabilities.

## Structure

- Lead with the existing Rover logo, a concise value proposition, and GitHub release badges.
- Explain the product through benefits first, then features and a short flow diagram.
- Provide installation paths for GitHub Releases and local development.
- Document the injected sidebar workflow, supported providers, local connection model, and relationship to MCPLab.
- End with development commands and links to the architecture and issue tracker.

## Constraints

- Reuse `logo/rover-logo-orange.png` rather than adding another asset.
- Link downloads to GitHub Releases because release asset names contain the version tag.
- Use only features and commands verified in the current codebase.
- Keep protocol internals in `ARCHITECTURE.md`, not in the product README.
