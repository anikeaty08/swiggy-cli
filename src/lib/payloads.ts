import { UsageError } from "./errors.js";

export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out as Partial<T>;
}

export function toPositiveInteger(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`Invalid ${flagName}. It must be a positive integer.`);
  }
  return parsed;
}

export function toNonNegativeInteger(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(`Invalid ${flagName}. It must be a non-negative integer.`);
  }
  return parsed;
}

export function toNumber(value: string | undefined, flagName: string): number {
  if (value === undefined) {
    throw new UsageError(`Missing required option ${flagName}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`Invalid ${flagName}. It must be a number.`);
  }
  return parsed;
}

export interface FoodMenuOptions {
  restaurantId?: string;
  addressId: string;
  page?: string;
  pageSize?: string;
}

export function buildFoodMenuPayload(o: FoodMenuOptions): Record<string, unknown> {
  if (!o.restaurantId) {
    throw new UsageError("Missing required option --restaurant-id.", "Run: swiggy food search-restaurants first");
  }
  return stripUndefined({
    restaurantId: o.restaurantId,
    addressId: o.addressId,
    page: toPositiveInteger(o.page, "--page"),
    pageSize: toPositiveInteger(o.pageSize, "--page-size"),
  });
}

export interface FoodAddToCartOptions {
  restaurantId?: string;
  addressId: string;
  itemId?: string;
  quantity?: string;
  restaurantName?: string;
}

export function buildFoodAddToCartPayload(o: FoodAddToCartOptions): Record<string, unknown> {
  if (!o.restaurantId || !o.itemId) {
    throw new UsageError(
      "Missing required options for add-to-cart.",
      "Provide --restaurant-id and --item-id, or pass --input <json>"
    );
  }
  const quantity = parsePositiveQuantity(o.quantity);
  return stripUndefined({
    restaurantId: o.restaurantId,
    addressId: o.addressId,
    restaurantName: o.restaurantName,
    cartItems: [{ itemId: o.itemId, quantity }],
  });
}

export function buildFoodCheckoutPayload(o: { addressId: string; paymentMethod?: string }): Record<string, unknown> {
  return stripUndefined({ addressId: o.addressId, paymentMethod: o.paymentMethod });
}

export function buildInstamartAddToCartPayload(o: {
  addressId: string;
  spinId?: string;
  quantity?: string;
}): Record<string, unknown> {
  if (!o.spinId) {
    throw new UsageError("Missing required option --spin-id.", "Provide --spin-id or pass --input <json>");
  }
  return {
    selectedAddressId: o.addressId,
    items: [{ spinId: o.spinId, quantity: parsePositiveQuantity(o.quantity) }],
  };
}

export function buildInstamartCheckoutPayload(o: { addressId: string; paymentMethod?: string }): Record<string, unknown> {
  return stripUndefined({ addressId: o.addressId, paymentMethod: o.paymentMethod });
}

export function buildInstamartTrackPayload(o: { orderId: string; lat?: string; lng?: string }): Record<string, unknown> {
  return { orderId: o.orderId, lat: toNumber(o.lat, "--lat"), lng: toNumber(o.lng, "--lng") };
}

export function buildDineoutSearchPayload(o: {
  query?: string;
  entityType?: string;
  addressId?: string;
  latitude?: number;
  longitude?: number;
}): Record<string, unknown> {
  if (!o.query) throw new UsageError("Missing required option --query.");
  return stripUndefined({
    query: o.query,
    entityType: o.entityType,
    addressId: o.addressId,
    latitude: o.latitude,
    longitude: o.longitude,
  });
}

export function buildDineoutDetailsPayload(o: { restaurantId: string; lat?: string; lng?: string }): Record<string, unknown> {
  return {
    restaurantId: o.restaurantId,
    latitude: toNumber(o.lat, "--lat"),
    longitude: toNumber(o.lng, "--lng"),
  };
}

export function buildDineoutSlotsPayload(o: {
  restaurantId?: string;
  date?: string;
  lat?: string;
  lng?: string;
}): Record<string, unknown> {
  if (!o.restaurantId) {
    throw new UsageError("Missing required option --restaurant-id.", "Run: swiggy dineout search first");
  }
  if (!o.date) throw new UsageError("Missing required option --date.");
  return {
    restaurantId: o.restaurantId,
    date: o.date,
    latitude: toNumber(o.lat, "--lat"),
    longitude: toNumber(o.lng, "--lng"),
  };
}

export function buildDineoutStatusPayload(orderId: string): Record<string, unknown> {
  return { orderId };
}

function parsePositiveQuantity(value: string | undefined): number {
  const quantity = value ? Number(value) : 1;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new UsageError("Invalid --quantity. It must be a positive number.");
  }
  return quantity;
}
