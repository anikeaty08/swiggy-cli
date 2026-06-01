import type {
  DineoutRestaurant,
  DineoutSearchSession,
  InstamartProduct,
  InstamartSearchSession,
  PendingInstamartPlan,
  TelegramUserProfile,
} from "../bot/types.js";
import { SwiggyCliExecutor } from "./cliExecutor.js";
import { renderFoodCartSummary } from "./cartSummary.js";
import { deepFindArray, firstNumber, firstString, formatMoney } from "./jsonHeuristics.js";

export class InstamartAgent {
  constructor(private readonly executor: SwiggyCliExecutor) {}

  async search(query: string, user: TelegramUserProfile): Promise<{ reply: string; search?: InstamartSearchSession; plan?: PendingInstamartPlan }> {
    if (!user.addressId) {
      return { reply: "Set an Instamart delivery address first. Send /addresses, then /location <addressId>." };
    }
    const res = await this.executor.instamartSearch(query, user.addressId);
    if (!res.ok) return { reply: `Instamart returned ${res.error.code}: ${res.error.message}` };
    const options = extractProducts(res.data).slice(0, 12).sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
    if (options.length === 0) return { reply: `I could not find Instamart products for "${query}".` };
    const plan: PendingInstamartPlan = {
      kind: "instamart_cart",
      query,
      addressId: user.addressId,
      createdAt: new Date().toISOString(),
      product: options[0]!,
      quantity: 1,
    };
    return {
      plan,
      search: {
        kind: "instamart_search",
        query,
        addressId: user.addressId,
        page: 0,
        options,
        createdAt: new Date().toISOString(),
      },
      reply: `Instamart match for "${query}": ${options[0]!.title}`,
    };
  }

  createPlan(query: string, addressId: string, product: InstamartProduct, quantity = 1): PendingInstamartPlan {
    return { kind: "instamart_cart", query, addressId, createdAt: new Date().toISOString(), product, quantity };
  }

  async confirm(plan: PendingInstamartPlan): Promise<string> {
    if (!plan.product.spinId) return "This Instamart result did not include a spinId, so I cannot safely add it to cart.";
    const add = await this.executor.instamartAddToCart({
      addressId: plan.addressId,
      spinId: plan.product.spinId,
      quantity: plan.quantity,
    });
    if (!add.ok) return `Could not update Instamart cart: ${add.error.code} ${add.error.message}`;
    const cart = await this.executor.instamartCart().catch(() => undefined);
    return [
      `Added to Instamart cart:`,
      `${plan.quantity} x ${plan.product.title}${plan.product.price !== undefined ? ` - ${formatMoney(plan.product.price)}` : ""}`,
      "",
      "Review before checkout:",
      cart?.ok ? renderFoodCartSummary(cart.data) : "Cart refresh was not available. Use /imcart to check the live cart.",
      "",
      "Checkout/payment is not automatic. Use the Swiggy app/CLI after verifying the final total.",
    ].join("\n");
  }
}

export class DineoutAgent {
  constructor(private readonly executor: SwiggyCliExecutor) {}

  async search(query: string, user: TelegramUserProfile): Promise<{ reply: string; search?: DineoutSearchSession }> {
    const location = resolveDineoutLocation(user);
    if (!location.addressId && (location.latitude === undefined || location.longitude === undefined)) {
      return { reply: "Set a manual address first with /address <full address>, share a Telegram location, or use a saved Dineout location." };
    }
    const res = await this.executor.dineoutSearch({ query, ...location });
    if (!res.ok) return { reply: `Dineout returned ${res.error.code}: ${res.error.message}` };
    const options = extractDineoutRestaurants(res.data).slice(0, 12);
    if (options.length === 0) return { reply: `I could not find Dineout restaurants for "${query}".` };
    return {
      search: {
        kind: "dineout_search",
        query,
        page: 0,
        ...location,
        options,
        createdAt: new Date().toISOString(),
      },
      reply: `Dineout matches for "${query}": ${options[0]!.title}`,
    };
  }

  async details(search: DineoutSearchSession, index: number): Promise<string> {
    const option = search.options[index];
    if (!option?.restaurantId) return "That restaurant result did not include an id.";
    if (search.latitude === undefined || search.longitude === undefined) {
      return "Details need a coordinate-backed manual address. Send /address <full address>, then search Dineout again.";
    }
    const res = await this.executor.dineoutDetails({
      restaurantId: option.restaurantId,
      latitude: search.latitude,
      longitude: search.longitude,
    });
    if (!res.ok) return `Could not fetch restaurant details: ${res.error.code} ${res.error.message}`;
    return renderDineoutDetails(option, res.data);
  }

  async slots(search: DineoutSearchSession, index: number, date = new Date().toISOString().slice(0, 10)): Promise<string> {
    const option = search.options[index];
    if (!option?.restaurantId) return "That restaurant result did not include an id.";
    if (search.latitude === undefined || search.longitude === undefined) {
      return "Slots need a coordinate-backed manual address. Send /address <full address> first.";
    }
    const res = await this.executor.dineoutSlots({
      restaurantId: option.restaurantId,
      date,
      latitude: search.latitude,
      longitude: search.longitude,
    });
    if (!res.ok) return `Could not fetch slots: ${res.error.code} ${res.error.message}`;
    const slots = deepFindArray(res.data, ["slots", "availableSlots", "data"]) ?? [];
    const lines = [`Slots for ${option.title} on ${date}:`];
    for (const slot of slots.slice(0, 10)) {
      if (!slot || typeof slot !== "object") continue;
      const row = slot as Record<string, unknown>;
      lines.push(`- ${firstString(row, ["time", "slot", "startTime"]) ?? "slot"}${firstString(row, ["offer", "discount"]) ? `, ${firstString(row, ["offer", "discount"])}` : ""}`);
    }
    if (lines.length === 1) lines.push("No slots were returned.");
    lines.push("", "Booking is not automatic. Use Dineout/CLI booking only after checking guest count, date, and final offer.");
    return lines.join("\n");
  }
}

function extractProducts(payload: unknown): InstamartProduct[] {
  return collectRecords(payload)
    .map((record) => {
      const flat = flattenOne(record);
      return {
        title: firstString(flat, ["displayName", "display_name", "name", "title", "productName"]) ?? "Product",
        spinId: firstString(flat, ["spinId", "spin_id", "id", "skuId"]),
        brand: firstString(flat, ["brand", "brandName", "storeName"]),
        price: normalizePrice(firstNumber(flat, ["finalPrice", "price", "discountedPrice", "sellingPrice"])),
        mrp: normalizePrice(firstNumber(flat, ["mrp", "defaultPrice", "maximumRetailPrice"])),
        quantityText: firstString(flat, ["quantity", "packSize", "unit", "weight"]),
        raw: record,
      };
    })
    .filter((product) => product.spinId || product.price !== undefined || product.title !== "Product");
}

function extractDineoutRestaurants(payload: unknown): DineoutRestaurant[] {
  const list = deepFindArray(payload, ["restaurants", "restaurantList", "data"]) ?? collectRecords(payload);
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((record) => {
      const flat = flattenOne(record);
      return {
        title: firstString(flat, ["name", "restaurantName", "title"]) ?? "Restaurant",
        restaurantId: firstString(flat, ["id", "restaurantId", "restaurant_id"]),
        area: firstString(flat, ["areaName", "area", "locality"]),
        rating: firstString(flat, ["avgRating", "rating"]),
        costForTwo: firstString(flat, ["costForTwo", "cost_for_two"]),
        offer: firstString(flat, ["offer", "offers", "discount", "deal"]),
        raw: record,
      };
    })
    .filter((restaurant) => restaurant.restaurantId || restaurant.title !== "Restaurant");
}

function resolveDineoutLocation(user: TelegramUserProfile): { addressId?: string; latitude?: number; longitude?: number } {
  if (user.manualLatitude !== undefined && user.manualLongitude !== undefined) {
    return { latitude: user.manualLatitude, longitude: user.manualLongitude };
  }
  if (user.addressId) return { addressId: user.addressId };
  return {};
}

function renderDineoutDetails(option: DineoutRestaurant, data: unknown): string {
  const record = data && typeof data === "object" ? flattenOne(data as Record<string, unknown>) : {};
  return [
    `Dineout details: ${option.title}`,
    option.area ? `Area: ${option.area}` : undefined,
    option.rating ? `Rating: ${option.rating}` : undefined,
    firstString(record, ["cuisines", "cuisine"]) ? `Cuisine: ${firstString(record, ["cuisines", "cuisine"])}` : undefined,
    option.offer || firstString(record, ["offer", "offers"]) ? `Offer: ${option.offer ?? firstString(record, ["offer", "offers"])}` : undefined,
    "",
    "Use the Slots button to check table times. Booking is not automatic.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function collectRecords(payload: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (Object.keys(record).some((key) => /name|price|spin|restaurant|rating/i.test(key))) out.push(record);
    queue.push(...Object.values(record).filter((value) => value && typeof value === "object"));
  }
  return out;
}

function flattenOne(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const value of Object.values(record)) {
    if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(out, value);
  }
  return out;
}

function normalizePrice(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return value > 10_000 ? value / 100 : value;
}
