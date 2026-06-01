# Telegram Bot Agent

`swiggy bot telegram` runs a Telegram polling bot that turns Food, Instamart, and Dineout requests into Swiggy CLI calls. It keeps the existing CLI as the deterministic execution layer and creates one isolated `SWIGGY_HOME` per Telegram user.

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
/address Indiranagar Bengaluru
order biryani
instamart milk bread
dineout italian
```

The `/auth food` command prints the exact host command for that Telegram user, for example:

```bash
SWIGGY_HOME="/home/app/.swiggy/telegram-bot/users/123" swiggy auth init --server food
```

Run it on the bot host and finish the browser OAuth flow. This is necessary because the current Swiggy CLI OAuth flow uses a local loopback callback.

## Manual Addresses

Manual addresses are supported where the upstream MCP accepts coordinates. The bot geocodes `/address <full address>` or `/location <full address>` and stores the resolved latitude/longitude in the Telegram user profile. Dineout search/details/slots and tracking-style flows can use those coordinates.

Food and Instamart cart mutations still require a saved Swiggy address id because those MCP tools require `addressId` / `selectedAddressId`. The bot does not guess or map a typed address to a saved Swiggy address.

## Safety

The Telegram bot does not place orders or bookings automatically. It can search, rank candidates, inspect coupons, show payment methods returned by MCP, and add explicitly selected Food/Instamart items to cart. Checkout and Dineout booking must remain explicit human actions because Swiggy tools can place real orders.

The bot also avoids writing directly to `auth.json` or config files. It uses the normal CLI and only changes bot-local user state such as selected `addressId` and the last pending recommendation.

## Food Behavior

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

## Instamart Behavior

Messages such as `instamart milk bread` or grocery-like queries route to Instamart. The bot searches `instamart/search_products`, shows paginated results with inline Add buttons, and adds only the selected `spinId` to cart. `/imcart` shows the live Instamart cart summary.

## Dineout Behavior

Messages such as `dineout italian` or `book table italian` route to Dineout. The bot uses the manual geocoded address when available, shows paginated restaurant results, and provides inline Details and Slots buttons. Booking is not automatic.
