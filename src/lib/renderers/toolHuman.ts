import Table from "cli-table3";
import chalk from "chalk";
import type { RenderContext } from "../output.js";
import { BRAND } from "../output.js";
import { shouldUseColor } from "../tty.js";
import { renderFoodCartSummary, renderPaymentSummary } from "../../agent/cartSummary.js";
import { renderTrackingSummary } from "../../agent/trackingSummary.js";

type RendererKind = "restaurants" | "items" | "addresses" | "cart" | "coupons" | "orders" | "tracking" | "slots" | "summary";

interface DisplayConfig {
  title: string;
  kind: RendererKind;
  preferred?: string[];
}

const TOOL_DISPLAY: Record<string, DisplayConfig> = {
  search_restaurants: { title: "Restaurants", kind: "restaurants" },
  search_restaurants_dineout: { title: "Restaurants", kind: "restaurants" },
  search_menu: { title: "Items", kind: "items" },
  get_restaurant_menu: { title: "Items", kind: "items" },
  search_products: { title: "Items", kind: "items" },
  your_go_to_items: { title: "Items", kind: "items" },
  get_addresses: { title: "Addresses", kind: "addresses" },
  get_saved_locations: { title: "Addresses", kind: "addresses" },
  get_food_cart: { title: "Cart", kind: "cart" },
  get_cart: { title: "Cart", kind: "cart" },
  fetch_food_coupons: { title: "Coupons", kind: "coupons" },
  get_food_orders: { title: "Orders", kind: "orders" },
  get_orders: { title: "Orders", kind: "orders" },
  track_food_order: { title: "Tracking", kind: "tracking" },
  track_order: { title: "Tracking", kind: "tracking" },
  get_available_slots: { title: "Available Slots", kind: "slots" },
  apply_food_coupon: { title: "Coupon", kind: "summary", preferred: ["code", "couponCode", "status", "message", "discount", "savings", "total"] },
  update_food_cart: { title: "Cart Updated", kind: "summary", preferred: ["statusMessage", "message", "restaurantName", "total", "payableAmount"] },
  update_cart: { title: "Cart Updated", kind: "summary", preferred: ["statusMessage", "message", "restaurantName", "total", "payableAmount"] },
  place_food_order: { title: "Checkout", kind: "summary", preferred: ["orderId", "status", "statusMessage", "message", "paymentMethod", "total"] },
  checkout: { title: "Checkout", kind: "summary", preferred: ["orderId", "status", "statusMessage", "message", "paymentMethod", "total"] },
  book_table: { title: "Booking", kind: "summary", preferred: ["bookingId", "status", "statusMessage", "message", "restaurantName", "date", "time"] },
  get_food_order_details: { title: "Details", kind: "summary", preferred: ["orderId", "status", "restaurantName", "items", "total", "eta", "message"] },
  get_order_details: { title: "Details", kind: "summary", preferred: ["orderId", "status", "restaurantName", "items", "total", "eta", "message"] },
  get_booking_status: { title: "Booking", kind: "summary", preferred: ["bookingId", "status", "restaurantName", "date", "time", "message"] },
  get_restaurant_details: { title: "Restaurant", kind: "summary", preferred: ["name", "restaurantName", "rating", "avgRating", "address", "areaName", "cuisines", "costForTwo", "offers"] },
  create_cart: { title: "Dineout Cart", kind: "summary", preferred: ["restaurantName", "date", "time", "guests", "offer", "total"] },
};

export function renderToolHuman(data: unknown, ctx: RenderContext): void {
  const ui = makeUi(ctx);
  const config = TOOL_DISPLAY[ctx.tool ?? ""] ?? inferDisplayConfig(data, ctx.tool);
  ui.heading(config.title);

  switch (config.kind) {
    case "restaurants":
      return renderRows(projectRows(data, "restaurants"), restaurantColumns, "No restaurants found.", ui);
    case "items":
      return renderRows(collectItemRecords(data).map(projectItem), itemColumns, "No items found.", ui);
    case "addresses":
      renderRows(projectRows(data, "addresses"), addressColumns, "No saved addresses found.", ui);
      process.stdout.write(`\nUse: ${ui.strong("swiggy food cart --address-id <id>")} or ${ui.strong("swiggy profile set defaultAddressIds.food <id>")}\n`);
      return;
    case "cart":
      process.stdout.write(`${renderFoodCartSummary(data)}\n`);
      return;
    case "coupons":
      return renderRows(projectRows(data, "coupons"), couponColumns, "No coupons returned.", ui);
    case "orders":
      return renderRows(projectRows(data, "orders"), orderColumns, "No orders returned.", ui);
    case "tracking":
      process.stdout.write(`${renderTrackingSummary(data)}\n`);
      return;
    case "slots":
      return renderRows(projectRows(data, "slots"), slotColumns, "No slots returned.", ui);
    case "summary":
      return renderSummary(data, ui, config.preferred ?? []);
  }
}

interface Ui {
  accent: (s: string) => string;
  strong: (s: string) => string;
  heading: (s: string) => void;
}

interface Column {
  key: string;
  label?: string;
  pick: string[];
  format?: (value: unknown, row: Record<string, unknown>) => string | undefined;
}

const restaurantColumns: Column[] = [
  { key: "name", pick: ["name", "restaurantName", "title"] },
  { key: "rating", pick: ["avgRating", "avgRatingString", "rating"] },
  { key: "area", pick: ["areaName", "area", "locality"] },
  { key: "eta", pick: ["deliveryTimeRange", "slaString", "eta", "deliveryTimeMinutes"] },
  { key: "offer", pick: ["offer", "offers", "coupon"] },
  { key: "id", pick: ["id", "restaurantId"] },
];

const itemColumns: Column[] = [
  { key: "item", pick: ["name", "itemName", "title", "productName"] },
  { key: "restaurant", pick: ["restaurantName", "restaurant", "storeName", "brand"] },
  { key: "price", pick: ["price", "finalPrice", "defaultPrice", "cost", "itemPrice"], format: (v) => money(toNumber(v)) },
  { key: "rating", pick: ["rating", "avgRating"] },
  { key: "veg", pick: ["isVeg", "veg", "is_veg"], format: (v) => boolish(v) },
  { key: "id", pick: ["id", "itemId", "skuId", "spinId"] },
];

const addressColumns: Column[] = [
  { key: "#", pick: ["__index"] },
  { key: "tag", pick: ["addressTag", "addressCategory", "label", "name", "title"] },
  { key: "address", pick: ["addressLine", "display_address", "address", "formattedAddress"] },
  { key: "phone", pick: ["phoneNumber", "phone"] },
  { key: "id", pick: ["id", "addressId", "address_id"] },
];

const couponColumns: Column[] = [
  { key: "code", pick: ["code", "couponCode", "coupon_code"] },
  { key: "discount", pick: ["discount", "discountValue", "maxDiscount", "value"], format: (v) => money(toNumber(v)) },
  { key: "minimum", pick: ["minimumOrderValue", "minCartValue", "minOrderValue"], format: (v) => money(toNumber(v)) },
  { key: "title", pick: ["title", "description", "message"] },
];

const orderColumns: Column[] = [
  { key: "id", pick: ["orderId", "id"] },
  { key: "status", pick: ["status", "orderStatus", "statusMessage"] },
  { key: "restaurant", pick: ["restaurantName", "restaurant"] },
  { key: "total", pick: ["total", "amount", "payableAmount"], format: (v) => money(toNumber(v)) },
  { key: "time", pick: ["createdAt", "orderedAt", "time"] },
];

const slotColumns: Column[] = [
  { key: "time", pick: ["time", "slot", "startTime"] },
  { key: "available", pick: ["available", "isAvailable", "status"] },
  { key: "offer", pick: ["offer", "discount", "deal"] },
];

function makeUi(ctx: RenderContext): Ui {
  const colored = shouldUseColor(ctx);
  const accent = (s: string) => (colored ? chalk.hex(BRAND.orange).bold(s) : s);
  const strong = (s: string) => (colored ? chalk.bold(s) : s);
  return {
    accent,
    strong,
    heading: (s: string) => process.stdout.write(`${accent(s)}\n`),
  };
}

function inferDisplayConfig(data: unknown, tool?: string): DisplayConfig {
  const record = firstRecord(data);
  const title = titleFromTool(tool || "Result");
  if (hasArray(record, ["restaurants", "restaurantList"])) return { title: "Restaurants", kind: "restaurants" };
  if (hasArray(record, ["addresses", "locations"])) return { title: "Addresses", kind: "addresses" };
  if (hasArray(record, ["items", "menuItems", "categories", "products"])) return { title: "Items", kind: "items" };
  if (hasArray(record, ["coupons", "offers"])) return { title: "Coupons", kind: "coupons" };
  if (hasArray(record, ["orders", "orderList"])) return { title: "Orders", kind: "orders" };
  if (hasArray(record, ["slots", "availableSlots"])) return { title: "Available Slots", kind: "slots" };
  return { title, kind: "summary" };
}

function projectRows(data: unknown, family: "restaurants" | "addresses" | "coupons" | "orders" | "slots"): Record<string, unknown>[] {
  const keyMap = {
    restaurants: ["restaurants", "restaurantList", "cards", "data"],
    addresses: ["addresses", "locations", "data"],
    coupons: ["coupons", "offers", "data"],
    orders: ["orders", "orderList", "data"],
    slots: ["slots", "availableSlots", "data"],
  };
  return extractRows(data, keyMap[family]).map((row, index) => ({ ...row, __index: index + 1 }));
}

function projectItem(row: Record<string, unknown>): Record<string, unknown> {
  return row;
}

function renderRows(rows: Record<string, unknown>[], columns: Column[], emptyMessage: string, ui: Ui): void {
  if (rows.length === 0) {
    process.stdout.write(`${emptyMessage}\n`);
    return;
  }
  const projected = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = pick(row, col.pick);
      const value = col.format ? col.format(raw, row) : raw;
      if (value !== undefined && value !== "") out[col.key] = value;
    }
    return out;
  });
  const headers = columns.map((c) => c.key).filter((key) => projected.some((row) => row[key] !== undefined));
  if (headers.length === 0) {
    process.stdout.write(`${emptyMessage}\n`);
    return;
  }
  const table = new Table({
    head: headers.map((h) => ui.accent(label(h))),
    wordWrap: true,
    style: { head: [], border: [] },
  });
  for (const row of projected) table.push(headers.map((h) => format(row[h])));
  process.stdout.write(`${table.toString()}\n`);
}

function renderSummary(data: unknown, ui: Ui, preferred: string[]): void {
  const record = firstRecord(data);
  if (!record) {
    process.stdout.write(`${format(data)}\n`);
    return;
  }
  const keys = preferred.filter((key) => findCaseInsensitive(record, key) !== undefined);
  const fallback = Object.keys(record).filter((key) => !keys.includes(key)).slice(0, Math.max(0, 10 - keys.length));
  const table = new Table({ wordWrap: true, style: { head: [], border: [] } });
  for (const key of [...keys, ...fallback]) table.push([ui.accent(label(key)), format(findCaseInsensitive(record, key))]);
  process.stdout.write(`${table.toString()}\n`);
  if (preferred.includes("paymentMethod")) process.stdout.write(`\n${renderPaymentSummary(data)}\n`);
}

function collectItemRecords(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [data];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (looksLikeItem(record)) out.push(record);
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return dedupe(out, (row) => String(pick(row, ["id", "itemId", "skuId", "spinId"]) ?? pick(row, ["name", "itemName", "title"]) ?? JSON.stringify(row)));
}

function looksLikeItem(row: Record<string, unknown>): boolean {
  return Boolean(pick(row, ["name", "itemName", "title", "productName"]) && (toNumber(pick(row, ["price", "finalPrice", "defaultPrice", "cost", "itemPrice"])) !== undefined || pick(row, ["id", "itemId", "skuId", "spinId"])));
}

function extractRows(data: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  const record = firstRecord(data);
  if (!record) return [];
  for (const key of keys) {
    const value = findCaseInsensitive(record, key);
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return isRecord(data) ? [data] : [];
}

function firstRecord(data: unknown): Record<string, unknown> | undefined {
  if (isRecord(data)) return data;
  if (Array.isArray(data)) return data.find(isRecord);
  return undefined;
}

function hasArray(record: Record<string, unknown> | undefined, keys: string[]): boolean {
  return Boolean(record && keys.some((key) => Array.isArray(findCaseInsensitive(record, key))));
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = findCaseInsensitive(row, key);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function findCaseInsensitive(row: Record<string, unknown>, key: string): unknown {
  if (row[key] !== undefined) return row[key];
  const lower = key.toLowerCase();
  const actual = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return actual ? row[actual] : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000 ? value / 100 : value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) return parsed > 10_000 ? parsed / 100 : parsed;
  }
  return undefined;
}

function boolish(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === 1) return "yes";
  if (value === 0) return "no";
  return String(value);
}

function money(value?: number): string | undefined {
  return value === undefined ? undefined : `Rs ${Math.round(value)}`;
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(format).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function label(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function titleFromTool(tool: string): string {
  return label(tool);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function dedupe<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
