# 🍽️ Contributing to swiggy-cli

> 🍽️ **Repo kitchen:** `anikeaty08/swiggy-cli` · Built for Food, Instamart, Dineout, and automation.

Thanks for considering a contribution! This is a community CLI for the official [Swiggy MCP servers](https://github.com/Swiggy/swiggy-mcp-server-manifest); upstream behavior changes belong on their tracker, but anything about how this CLI wraps them belongs here.

## Quick start

```bash
git clone https://github.com/anikeaty08/swiggy-cli.git
cd swiggy-cli
npm ci
npm run dev -- --help     # tsx-powered watcher equivalent
npm test                  # vitest
npm run lint              # tsc --noEmit
npm run build             # tsup â†’ dist/
node dist/cli.js --help   # smoke-test the built binary
```

## Project layout

See [`docs/architecture.md`](./docs/architecture.md). One-line summary: `src/cli.ts` is the commander entry, every command lives under `src/commands/`, and every command compiles down to a single `McpClient.callTool()` invocation defined in `src/lib/mcp.ts`.

## Adding an ergonomic command

The Swiggy MCP servers expose 35 tools today. Any new tool can be invoked through `swiggy call <server> <tool>` immediately. To add a friendly alias on top:

1. Append the tool name to `TOOL_CATALOG[<server>]` in [`src/lib/aliases.ts`](./src/lib/aliases.ts).
2. Append `<verb>: <tool_name>` to `ERGONOMIC_ALIASES[<server>]`.
3. Add a `attachOutputOptions(<server>.command(...))` block in [`src/commands/<server>.ts`](./src/commands).
4. If the tool mutates state in a hard-to-reverse way, add it to `DESTRUCTIVE_TOOLS`.
5. Add a row to [`docs/commands.md`](./docs/commands.md).
6. Update tests in [`test/smoke.test.ts`](./test/smoke.test.ts) â€” alias-integrity assertions catch typos.

Full guide: [`docs/extending.md`](./docs/extending.md).

## Output contract

Every command must produce a structured envelope before rendering. The JSON shape is documented in [`docs/output-contract.md`](./docs/output-contract.md) and **must not change** in a backwards-incompatible way without a major version bump. New optional fields under `meta` are fine.

## Coding style

- TypeScript strict mode, ESM, Node 20+.
- No new runtime dependencies without discussion.
- Prefer pure functions; the renderers, error classes, and config helpers are all pure.
- Comments only for non-obvious *why*, never *what*.

## Tests

- `vitest` smoke tests are in `test/smoke.test.ts`. They verify alias integrity, error contract, and renderer determinism.
- Network-touching code is covered with mocked MCP/auth tests in CI. Manual smoke against a real account is still recommended before release.

## Commit style

Conventional commits are encouraged:

```
feat(food): add `add-to-cart --variation` flag
fix(auth): refresh token on 401 instead of failing
docs: expand troubleshooting for windows path
```

## Releasing

Maintainers only. See [`docs/releasing.md`](./docs/releasing.md) - tag-based, runs `release.yml` which publishes to npm with provenance.

## Code of conduct

By participating, you agree to abide by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Reporting security issues

Please do not file public issues for security problems. See [`SECURITY.md`](./SECURITY.md).
