# Deployment

## Telegram Bot

Run the bot with a dedicated state directory. Each Telegram user gets an isolated `SWIGGY_HOME` below that directory.

```bash
TELEGRAM_BOT_TOKEN=123:abc \
SWIGGY_BOT_HOME=/srv/swiggy-bot/state \
swiggy bot telegram --swiggy-command swiggy
```

For systemd or another process manager, keep these environment variables outside git:

- `TELEGRAM_BOT_TOKEN`
- `SWIGGY_BOT_HOME`
- `SWIGGY_BOT_SWIGGY_COMMAND`
- `SWIGGY_OAUTH_CLIENT_ID` / `SWIGGY_OAUTH_CLIENT_SECRET` when required

## Auth

Users link profiles from Telegram with `/auth food`, `/auth instamart`, or `/auth dineout`. The bot prints a host command that sets that user's `SWIGGY_HOME` and runs `swiggy auth init`.

The browser flow must run on the bot host because OAuth uses a local loopback callback. Do not paste or log tokens from `auth.json`.

## Manual Addresses

Typed addresses are geocoded and stored in bot state as coordinates. They are used only for MCP calls that accept coordinates, such as Dineout search/details/slots or tracking-style flows.

Food and Instamart cart mutations still require saved Swiggy address ids. The bot does not guess, create, or map typed addresses to saved Swiggy addresses.

## Verification

Use non-mutating checks before exposing the bot:

```bash
swiggy doctor
swiggy smoke --json --no-interactive --quiet
swiggy auth status --json --no-interactive --quiet
```

`swiggy smoke` checks auth state and renderer/cart-summary paths without creating carts, placing orders, or booking tables.
