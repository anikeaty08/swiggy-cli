# 🍽️ swiggy-cli

> 🍽️ **Repo kitchen:** `anikeaty08/swiggy-cli` · Built for Food, Instamart, Dineout, and automation.

Terminal-grade access to Swiggy's MCP platform.

`swiggy-cli` turns Swiggy Food, Instamart, and Dineout into a clean command-line interface for humans, scripts, and coding agents. It wraps the live MCP servers with a sharper command surface, stable machine output, OAuth handling, profiles, and safer defaults for real commerce workflows.

If you want to inspect live tool schemas, script against Swiggy from CI, or give an agent a deterministic CLI instead of a browser-shaped workflow, this repo is built for that.

## Why This Repo Exists

Swiggy's MCP servers are already tool-native. What they do not give you is a strong terminal experience.

This repo fills that gap:

- ergonomic commands for day-to-day use
- a generic discovery and `call` layer for long-term stability
- JSON output shaped for automation
- consistent auth, profile, and endpoint handling
- safety rails around destructive operations

The result is a CLI that feels practical in a shell and dependable inside an agent loop.

## Core Capabilities

- Search delivery restaurants, inspect menus, manage food carts, place orders, and track them
- Search Instamart products, update grocery carts, run checkout, and track orders
- Search Dineout restaurants, inspect details, fetch reservation slots, and check booking status
- Discover live tools and schemas directly from Swiggy MCP
- Return a stable machine envelope with `--json`
- Run a Telegram food-ordering agent on top of isolated per-user CLI profiles

## Command Model

The CLI has two layers.

Layer A is human-friendly:

```bash
swiggy food search-restaurants --query "biryani" --address-id <addressId>
swiggy instamart search --query "milk bread eggs" --address-id <addressId>
swiggy dineout search --query "italian" --lat 12.9716 --lng 77.5946
```

Layer B is generic and automation-first:

```bash
swiggy servers --json
swiggy tools food --json
swiggy schema food search_restaurants --json
swiggy call food search_restaurants --input '{"query":"pizza","addressId":"addr_123"}' --json
```

That split matters. Human-friendly commands make the tool pleasant to use. The generic layer makes it durable when upstream tools evolve.

## Install

Requirements:

- Node.js 20+

Global install:

```bash
npm i -g swiggy-cli
swiggy --help
```

One-off use:

```bash
npx -p swiggy-cli swiggy --help
```

Local development:

```bash
npm install
npm run build
npm test
```

## Quick Start

Authenticate the servers you plan to use:

```bash
swiggy auth init --server food
swiggy auth init --server instamart
swiggy auth init --server dineout
```

Check auth state:

```bash
swiggy auth status --json
```

Inspect the live MCP surface:

```bash
swiggy servers --json
swiggy tools food --json
swiggy schema food search_restaurants --json
```

Make a generic call:

```bash
swiggy call food search_restaurants --input '{"query":"pizza","addressId":"addr_123"}' --json
```

## Human Mode

Food:

```bash
swiggy food addresses
swiggy food search-restaurants --query "biryani" --address-id <addressId>
swiggy food menu --restaurant-id <restaurantId> --address-id <addressId>
swiggy food search-menu --query "paneer tikka" --address-id <addressId>
swiggy food cart --address-id <addressId>
swiggy food checkout --address-id <addressId> --yes
swiggy food track <orderId>
```

Instamart:

```bash
swiggy instamart addresses
swiggy instamart search --query "milk bread eggs" --address-id <addressId>
swiggy instamart add-to-cart --address-id <addressId> --spin-id <spinId> --quantity 2
swiggy instamart cart
swiggy instamart checkout --address-id <addressId> --yes
swiggy instamart track <orderId> --lat <lat> --lng <lng>
```

Dineout:

```bash
swiggy dineout locations
swiggy dineout search --query "italian" --lat 12.9716 --lng 77.5946
swiggy dineout details <restaurantId> --lat 12.9716 --lng 77.5946
swiggy dineout slots --restaurant-id <restaurantId> --date 2026-06-01 --lat 12.9716 --lng 77.5946
swiggy dineout status <orderId>
```

## Agent and Script Mode

For automation, use machine mode consistently:

```bash
swiggy servers --json --no-interactive --quiet
swiggy tools food --json --no-interactive --quiet
swiggy schema food search_restaurants --json --no-interactive --quiet
swiggy call food search_restaurants --input '{"query":"pizza","addressId":"addr_123"}' --json --no-interactive --quiet
```

Recommended flags:

- `--json` for the stable envelope on stdout
- `--no-interactive` to fail instead of prompting
- `--quiet` to suppress non-essential logs
- `--yes` when intentionally acknowledging a destructive action

Success envelope:

```json
{
  "ok": true,
  "server": "food",
  "tool": "search_restaurants",
  "data": {},
  "meta": {
    "profile": "default"
  }
}
```

Failure envelope:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Authentication required for server \"food\"."
  }
}
```

## Auth and Local State

The CLI uses browser-based OAuth with PKCE.

Useful commands:

```bash
swiggy auth init
swiggy auth init --server food
swiggy auth status
swiggy auth whoami
swiggy auth logout --server food
```

State lives under:

- `~/.swiggy/config.json`
- `~/.swiggy/auth.json`

Override the base path with:

```bash
SWIGGY_HOME=/path/to/state
```

## Profiles

Profiles let you store output defaults and endpoint overrides.

Examples:

```bash
swiggy profile list
swiggy profile create work --output json
swiggy profile use work
swiggy --profile work food addresses
```

## Shell Completion

Generate shell completion setup:

```bash
swiggy completion bash
swiggy completion zsh
swiggy completion fish
```

## Safety

This CLI is wired to real commerce actions. It should behave like it.

These commands require confirmation in normal use, or `--yes` in machine mode:

- `food checkout`
- `food clear-cart`
- `instamart delete-address`
- `instamart clear-cart`
- `instamart checkout`
- `dineout book`

In human mode, checkout, booking, cart clearing, and address deletion print a best-effort summary before asking for confirmation.

Operational rules:

- do not blindly retry `place_food_order`, `checkout`, or `book_table`
- after ambiguous failures, prefer checking `get_*_orders` or `get_booking_status`
- do not assume cart or order mutations are safe to replay

## Development

Scripts:

```bash
npm run build
npm run lint
npm test
npm run pack:check
```

Run locally:

```bash
npm run dev -- --help
```

Package sanity check:

```bash
npm run pack:check
```

## Project Layout

```text
src/
  cli.ts
  commands/
  lib/
  types/
test/
skills/
docs/
```

Key areas:

- `src/commands/` contains the ergonomic command layer
- `src/commands/generic.ts` exposes live discovery and generic tool calling
- `src/lib/mcp.ts` contains the MCP transport and session handling
- `src/lib/auth.ts` contains OAuth and token persistence

## Troubleshooting

Auth failures:

```bash
swiggy auth init --server <server>
swiggy auth status --json
```

Live tool drift:

```bash
swiggy tools <server> --json
swiggy schema <server> <tool> --json
```

Health check:

```bash
swiggy doctor
```

`npx` confusion:

```bash
npx -p swiggy-cli swiggy --help
```

## Docs

Additional docs live in [`docs/`](./docs):

- `docs/architecture.md`
- `docs/auth.md`
- `docs/commands.md`
- `docs/output-contract.md`
- `docs/telegram-bot.md`
- `docs/troubleshooting.md`

## License

MIT
