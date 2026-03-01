# CI/CD and Release

This repository uses GitHub Actions for continuous integration, security analysis, coverage reporting, and npm publication.

## Workflows
- `.github/workflows/ci.yml`
  - Runs on every push and pull request.
  - Installs dependencies with Bun.
  - Runs typecheck + build.
  - Runs the test suite (unit and integration tests in `tests/`).
  - Generates and uploads coverage (`coverage/lcov.info`).
  - Runs dependency security audit (`bun audit`).
- `.github/workflows/codeql.yml`
  - Runs CodeQL JavaScript/TypeScript analysis on push/PR to `main`.
  - Also runs weekly on a schedule.
- `.github/workflows/release.yml`
  - Runs when a GitHub Release is published.
  - Re-checks quality gates (`bun run check` + `bun run build`).
  - Publishes the package to npm.
  - Creates a GitHub linked artifact metadata record for the published npm tarball.

## Required Secrets
- `NPM_TOKEN` (required)
  - npm automation token with publish scope for this package.

## Optional Secrets
- `CODECOV_TOKEN` (optional)
  - If set, coverage is uploaded to Codecov.
  - If unset, CI still uploads the coverage artifact to GitHub Actions.
- `GH_ARTIFACT_METADATA_TOKEN` (optional)
  - Fine-grained token fallback for the Artifact Metadata API when org policies restrict `GITHUB_TOKEN`.
  - If unset, release workflow uses `GITHUB_TOKEN`.

## Release Flow
1. Update `package.json` version.
2. Push to GitHub.
3. Create a GitHub Release for that version.
4. `release.yml` publishes to npm automatically.

## Local Parity Commands
```bash
bun run check
bun run test:coverage
bun run audit
```
