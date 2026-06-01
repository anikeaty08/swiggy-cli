# 🍽️ Releasing

> 🍽️ **Repo kitchen:** `anikeaty08/swiggy-cli` · Built for Food, Instamart, Dineout, and automation.

## Checklist

1. Update the package version.
2. Update `CHANGELOG.md`.
3. Run `npm run lint`.
4. Run `npm test`.
5. Run `npm run build`.
6. Run `npm run pack:check`.
7. Publish with npm provenance enabled: `npm publish --provenance`.

Releases are tag-driven. Pushing a tag matching `v*.*.*` triggers `.github/workflows/release.yml`, which:

1. Installs deps with a clean `npm ci`.
2. Runs lint + tests + build.
3. Publishes to npm with `--provenance --access public` (npm sigstore attestation).
4. Creates a GitHub Release with auto-generated notes.

## Prerequisites

A maintainer with publish rights needs:

- `NPM_TOKEN` set as a GitHub Actions secret on this repo. Use a granular access token scoped to `swiggy-mcp-agent` only - not a classic, not a legacy token.
- npm 2FA configured for "Auth and Writes" (recommended). With provenance + 2FA, the release pipeline still works because the GitHub OIDC token authorises publish; the human 2FA prompt is bypassed for CI.

## Cutting a release

```bash
# from a clean main
git checkout main && git pull
npm ci
npm run lint && npm test && npm run build && npm pack --dry-run

# bump
npm version patch        # or minor / major; this writes package.json + creates a tag locally
git push --follow-tags   # pushes commit AND the tag â†’ triggers release.yml
```

After CI completes:

```bash
npm view swiggy-mcp-agent             # confirm the new version
npx -p swiggy-mcp-agent@<version> swiggy --version
```

## What gets published

Per `files` in `package.json` and `.npmignore`:

- `dist/` (built JS only)
- `README.md`
- `AGENTS.md`
- `docs/`
- `skills/`
- `LICENSE`

`src/`, `test/`, `tsconfig.json`, `tsup.config.ts`, and `.github/` are deliberately excluded. Run `npm pack --dry-run` before tagging to verify.

## Pre-releases

For testing, use a `next` dist-tag:

```bash
npm version 0.2.0-rc.1 --no-git-tag-version
npm publish --tag next --access public --provenance
```

Users opt in with `npm i -g swiggy-mcp-agent@next`. Promote later with `npm dist-tag add swiggy-mcp-agent@0.2.0-rc.1 latest`.

## Yanking

If a release is broken:

```bash
npm deprecate swiggy-mcp-agent@<bad-version> "<reason - point at the fix>"
```

Do not unpublish unless within the 72-hour window and the version was never installed by anyone â€” unpublishing breaks lockfiles for everyone who already has it.
