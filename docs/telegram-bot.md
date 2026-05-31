# Telegram Bot Agent

`swiggy bot telegram` runs a Telegram polling bot that turns food requests into Swiggy CLI calls. It keeps the existing CLI as the deterministic execution layer and creates one isolated `SWIGGY_HOME` per Telegram user.

## Start

Create a bot with BotFather, then run:

```bash
TELEGRAM_BOT_TOKEN=123:abc swiggy bot telegram
```

Useful options:

```bash
swiggy bot telegram \
  --token "$TELEGRAM_BOT_TOKEN" \
  --data-dir ~/.swiggy/telegram-bot \
  --swiggy-command swiggy
```

## User Flow

Inside Telegram:

```text
/start
/auth food
/status
/addresses
/location <addressId>
order biryani
confirm
```

The `/auth food` command prints the exact host command for that Telegram user, for example:

```bash
SWIGGY_HOME="/home/app/.swiggy/telegram-bot/users/123" swiggy auth init --server food
```

Run it on the bot host and finish the browser OAuth flow. This is necessary because the current Swiggy CLI OAuth flow uses a local loopback callback.

## Safety

The Telegram bot does not place orders automatically. It can search, rank candidates, inspect coupons, and after `confirm` add the selected item to cart. Checkout must remain an explicit human step because Swiggy tools can place real orders.

The bot also avoids writing directly to `auth.json` or config files. It uses the normal CLI and only changes bot-local user state such as selected `addressId` and the last pending recommendation.

## Behavior

For a request such as:

```text
order biryani
```

The agent:

1. Calls `food/search_menu` with the selected address.
2. Extracts candidate items from the structured MCP response.
3. Calls `food/fetch_food_coupons` when available.
4. Estimates best value from item price and coupon threshold data.
5. Tells the user when adding a small item may unlock a better discount.
6. Stores the recommendation as a pending plan until `confirm` or `/cancel`.

Because upstream MCP payload shapes can evolve, ranking uses tolerant JSON extraction and only mutates cart state when the required restaurant and item ids are present.
