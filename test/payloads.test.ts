import { describe, expect, it } from "vitest";
import {
  buildDineoutDetailsPayload,
  buildDineoutSearchPayload,
  buildDineoutSlotsPayload,
  buildDineoutStatusPayload,
  buildFoodAddToCartPayload,
  buildFoodCheckoutPayload,
  buildFoodMenuPayload,
  buildInstamartAddToCartPayload,
  buildInstamartCheckoutPayload,
  buildInstamartTrackPayload,
} from "../src/lib/payloads.js";
import { validateToolInput } from "../src/lib/schema.js";

describe("ergonomic command payload contracts", () => {
  const cases = [
    ["food menu", "food", "get_restaurant_menu", buildFoodMenuPayload({ restaurantId: "rest_1", addressId: "addr_1", page: "2", pageSize: "10" })],
    ["food add-to-cart", "food", "update_food_cart", buildFoodAddToCartPayload({ restaurantId: "rest_1", addressId: "addr_1", itemId: "item_1", quantity: "2", restaurantName: "A2B" })],
    ["food checkout", "food", "place_food_order", buildFoodCheckoutPayload({ addressId: "addr_1", paymentMethod: "COD" })],
    ["instamart add-to-cart", "instamart", "update_cart", buildInstamartAddToCartPayload({ addressId: "addr_1", spinId: "spin_1", quantity: "3" })],
    ["instamart checkout", "instamart", "checkout", buildInstamartCheckoutPayload({ addressId: "addr_1", paymentMethod: "COD" })],
    ["instamart track", "instamart", "track_order", buildInstamartTrackPayload({ orderId: "ord_1", lat: "12.97", lng: "77.59" })],
    ["dineout search", "dineout", "search_restaurants_dineout", buildDineoutSearchPayload({ query: "italian", entityType: "CUISINE", latitude: 12.97, longitude: 77.59 })],
    ["dineout details", "dineout", "get_restaurant_details", buildDineoutDetailsPayload({ restaurantId: "rest_1", lat: "12.97", lng: "77.59" })],
    ["dineout slots", "dineout", "get_available_slots", buildDineoutSlotsPayload({ restaurantId: "rest_1", date: "2026-06-01", lat: "12.97", lng: "77.59" })],
    ["dineout status", "dineout", "get_booking_status", buildDineoutStatusPayload("book_1")],
  ] as const;

  it.each(cases)("%s matches the pinned payload", (_name, server, tool, payload) => {
    expect(payload).toMatchSnapshot();
    expect(validateToolInput(server, tool, payload)).toEqual({ ok: true });
  });

  it("rejects payloads that do not match cached schemas", () => {
    expect(validateToolInput("food", "place_food_order", { paymentMethod: "COD" })).toEqual({
      ok: false,
      errors: ["$.addressId is required"],
    });
  });
});
