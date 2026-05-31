# 🍽️ Tools catalog

> 🍽️ **Repo kitchen:** `anikeaty08/swiggy-cli` · Built for Food, Instamart, Dineout, and automation.

Verified against [https://mcp.swiggy.com/builders/docs/reference/](https://mcp.swiggy.com/builders/docs/reference/) on **2026-04-28** (35 tools across 3 servers).

> Tool names are verbatim. The CLI keeps conservative cached schema fixtures for offline tests and validates generic calls against live schemas when available. To inspect the upstream contract, run `swiggy schema <server> <tool> --json`.

## Food (`https://mcp.swiggy.com/food`) â€” 14 tools

### Discover

- `search_restaurants` â€” search by query / cuisine / dish / location
- `search_menu` â€” search dishes across restaurants
- `get_restaurant_menu` â€” full menu for a restaurant id
- `get_addresses` â€” saved delivery addresses

### Cart

- `get_food_cart` â€” current cart contents
- `update_food_cart` â€” add / change / remove items
- `flush_food_cart` âš  â€” empty the cart
- `apply_food_coupon` â€” apply a coupon code
- `fetch_food_coupons` â€” list applicable coupons

### Order

- `place_food_order` âš  â€” place a COD order

### Track

- `get_food_orders` â€” history of food orders
- `get_food_order_details` â€” single order detail
- `track_food_order` â€” live tracking

### Support

- `report_error` â€” file an error report

## Instamart (`https://mcp.swiggy.com/im`) â€” 13 tools

### Discover

- `search_products` â€” query products by name/category/brand
- `your_go_to_items` â€” frequently-ordered items

### Address

- `get_addresses`
- `create_address`
- `delete_address` âš 

### Cart

- `get_cart`
- `update_cart`
- `clear_cart` âš 

### Order / Track

- `checkout` âš  â€” place COD order
- `get_orders`
- `get_order_details`
- `track_order`

### Support

- `report_error`

## Dineout (`https://mcp.swiggy.com/dineout`) â€” 8 tools

### Find

- `search_restaurants_dineout`
- `get_restaurant_details` â€” menu, ratings, offers
- `get_saved_locations`

### Reserve

- `create_cart`
- `get_available_slots`
- `book_table` âš  â€” free bookings only

### Manage / Support

- `get_booking_status`
- `report_error`

âš  = destructive. Gated by confirmation in this CLI; see `src/lib/aliases.ts` (`DESTRUCTIVE_TOOLS`).
