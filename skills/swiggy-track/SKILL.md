---
name: swiggy-track
description: List, inspect, and live-track Swiggy food and Instamart orders via swiggy-cli. Use when the user asks "where's my order" or "what did I order yesterday".
---

# 🍽️ swiggy-track

> 🍽️ **Repo kitchen:** `anikeaty08/swiggy-cli` · Built for Food, Instamart, Dineout, and automation.

All track commands are read-only and safe to call on any cadence.

## List recent orders

```bash
swiggy food orders --json --no-interactive
swiggy instamart orders --json --no-interactive
```

## Inspect a single order

```bash
swiggy food order <order_id> --json --no-interactive
swiggy instamart order <order_id> --json --no-interactive
```

## Live tracking

```bash
swiggy food track <order_id> --json --no-interactive
swiggy instamart track <order_id> --json --no-interactive
```

## When to refresh

`track_*` calls hit the live status endpoint each time. Don't poll faster than every 30 s â€” the upstream rate limits, and a 30â€“60 s cadence is enough to see status transitions (placed â†’ preparing â†’ on the way â†’ delivered).

## Dineout bookings

For dineout, the equivalent is:

```bash
swiggy dineout status <booking_id> --json --no-interactive
```
