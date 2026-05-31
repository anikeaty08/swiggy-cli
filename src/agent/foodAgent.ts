import type { FoodRecommendation, PendingFoodPlan, TelegramUserProfile } from "../bot/types.js";
import { SwiggyCliExecutor } from "./cliExecutor.js";
import { deepFindArray, firstNumber, firstString, formatMoney } from "./jsonHeuristics.js";

export interface FoodAgentResult {
  reply: string;
  plan?: PendingFoodPlan;
}

export class FoodAgent {
  constructor(private readonly executor: SwiggyCliExecutor) {}

  async recommend(query: string, user: TelegramUserProfile): Promise<FoodAgentResult> {
    if (!user.addressId) {
      return {
        reply:
          "Set a delivery address first.\n\nRun `/addresses` to list saved Swiggy addresses, then `/location <addressId>`.",
      };
    }

    const search = await this.executor.call("food", "search_menu", {
      query,
      addressId: user.addressId,
    });
    if (!search.ok) return { reply: this.errorReply(search.error.code, search.error.message) };

    let candidates = extractMenuCandidates(search.data).slice(0, 8);
    if (candidates.length === 0) {
      candidates = await this.restaurantMenuFallback(query, user.addressId);
    }
    if (candidates.length === 0) {
      return { reply: `I could not find food items for "${query}" at the selected address.` };
    }

    const coupons = await this.executor.foodCoupons().catch(() => undefined);
    const bestCoupon = coupons?.ok ? extractBestCoupon(coupons.data) : undefined;
    const ranked = candidates
      .map((candidate) => scoreCandidate(candidate, bestCoupon))
      .sort((a, b) => (a.estimatedTotal ?? Number.POSITIVE_INFINITY) - (b.estimatedTotal ?? Number.POSITIVE_INFINITY));
    const best = ranked[0]!;
    const addOn = bestCoupon?.minimumOrderValue && best.price && best.price < bestCoupon.minimumOrderValue
      ? bestCoupon.minimumOrderValue - best.price
      : undefined;

    const recommendation: FoodRecommendation = {
      title: best.itemName || best.restaurantName || query,
      restaurantName: best.restaurantName,
      restaurantId: best.restaurantId,
      itemName: best.itemName,
      itemId: best.itemId,
      estimatedTotal: best.estimatedTotal,
      savings: best.savings,
      couponCode: best.couponCode,
      addOnSuggestion: addOn && addOn > 0 ? `Add about ${formatMoney(addOn)} more to test the coupon threshold.` : undefined,
      eta: best.eta,
      rating: best.rating,
      raw: best.raw,
    };

    const plan: PendingFoodPlan = {
      kind: "food_order",
      query,
      addressId: user.addressId,
      createdAt: new Date().toISOString(),
      recommendation,
    };

    return {
      plan,
      reply: renderRecommendation(query, recommendation, ranked.length),
    };
  }

  async confirm(plan: PendingFoodPlan): Promise<string> {
    const r = plan.recommendation;
    if (!r.restaurantId || !r.itemId) {
      return "I found a recommendation, but the result did not include enough item IDs to safely build the cart. Open Swiggy manually or try a more specific item.";
    }
    const add = await this.executor.foodAddToCart({
      restaurantId: r.restaurantId,
      addressId: plan.addressId,
      itemId: r.itemId,
      restaurantName: r.restaurantName,
      quantity: 1,
    });
    if (!add.ok) return `Could not update cart: ${add.error.code} ${add.error.message}`;

    let couponLine = "";
    if (r.couponCode) {
      const coupon = await this.executor.foodApplyCoupon(r.couponCode).catch(() => undefined);
      couponLine = coupon?.ok
        ? `\nCoupon applied: ${r.couponCode}`
        : `\nCoupon ${r.couponCode} could not be applied automatically; check it before checkout.`;
    }

    const cart = await this.executor.foodCart(plan.addressId);
    const cartText = cart.ok ? JSON.stringify(cart.data, null, 2).slice(0, 2500) : `${cart.error.code} ${cart.error.message}`;
    return (
      `Added to cart: ${r.itemName ?? r.itemId} from ${r.restaurantName ?? r.restaurantId}` +
      couponLine +
      "\n\nReview the cart before checkout:\n" +
      cartText +
      "\n\nCheckout is not automatic. Place the order only after verifying the final total in Swiggy/CLI."
    );
  }

  private errorReply(code: string, message: string): string {
    if (code === "AUTH_REQUIRED" || code === "AUTH_FAILED") {
      return "Swiggy auth is not ready for your Telegram profile. Send `/auth` for the linking command, then `/status`.";
    }
    return `Swiggy returned ${code}: ${message}`;
  }

  private async restaurantMenuFallback(query: string, addressId: string): Promise<MenuCandidate[]> {
    const restaurants = await this.executor.call("food", "search_restaurants", { query, addressId });
    if (!restaurants.ok) return [];
    const restaurantCandidates = extractRestaurantCandidates(restaurants.data).slice(0, 5);
    const all: MenuCandidate[] = [];
    for (const restaurant of restaurantCandidates) {
      if (!restaurant.restaurantId) continue;
      const menu = await this.executor
        .call("food", "get_restaurant_menu", {
          restaurantId: restaurant.restaurantId,
          addressId,
          page: 1,
          pageSize: 8,
        })
        .catch(() => undefined);
      if (!menu?.ok) continue;
      all.push(...extractMenuCandidates(menu.data, restaurant));
    }
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return dedupeCandidates(all)
      .filter((candidate) => {
        const haystack = `${candidate.itemName ?? ""}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 12);
  }
}

interface MenuCandidate {
  restaurantName?: string;
  restaurantId?: string;
  itemName?: string;
  itemId?: string;
  price?: number;
  eta?: string;
  rating?: string;
  raw: unknown;
}

interface CouponCandidate {
  code?: string;
  discount?: number;
  minimumOrderValue?: number;
}

function extractMenuCandidates(payload: unknown, context: Partial<MenuCandidate> = {}): MenuCandidate[] {
  const list = collectItemRecords(payload);
  const out: MenuCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const nested = flattenOne(record);
    const itemName = firstString(nested, ["name", "itemName", "dishName", "title"]);
    const restaurantName = firstString(nested, ["restaurantName", "restaurant_name", "brand", "restaurant"]);
    const price = normalizePrice(firstNumber(nested, ["price", "finalPrice", "defaultPrice", "cost", "itemPrice"]));
    if (!itemName && !restaurantName) continue;
    out.push({
      restaurantName: restaurantName ?? context.restaurantName,
      restaurantId: firstString(nested, ["restaurantId", "restaurant_id", "restId", "cid"]) ?? context.restaurantId,
      itemName,
      itemId: firstString(nested, ["itemId", "item_id", "id", "skuId"]),
      price,
      eta: firstString(nested, ["slaString", "deliveryTime", "eta"]),
      rating: firstString(nested, ["avgRating", "rating", "ratings"]),
      raw: item,
    });
  }
  return out;
}

function extractRestaurantCandidates(payload: unknown): MenuCandidate[] {
  const list = deepFindArray(payload, ["restaurants", "data"]) ?? [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((record) => {
      const flat = flattenOne(record);
      return {
        restaurantName: firstString(flat, ["name", "restaurantName", "restaurant_name", "title"]),
        restaurantId: firstString(flat, ["id", "restaurantId", "restaurant_id"]),
        eta: firstString(flat, ["deliveryTimeRange", "slaString", "eta"]),
        rating: firstString(flat, ["avgRating", "avgRatingString", "rating"]),
        raw: record,
      };
    })
    .filter((candidate) => candidate.restaurantId || candidate.restaurantName);
}

function collectItemRecords(payload: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (looksLikeMenuItem(record)) out.push(record);
    for (const key of ["items", "menuItems", "cards", "categories", "data"]) {
      const value = record[key];
      if (Array.isArray(value) || (value && typeof value === "object")) queue.push(value);
    }
  }
  return out;
}

function looksLikeMenuItem(record: Record<string, unknown>): boolean {
  const hasName = firstString(record, ["name", "itemName", "dishName", "title"]) !== undefined;
  const hasPrice = firstNumber(record, ["price", "finalPrice", "defaultPrice", "cost", "itemPrice"]) !== undefined;
  const hasItemId = firstString(record, ["itemId", "item_id", "id", "skuId"]) !== undefined;
  return hasName && hasPrice && hasItemId;
}

function extractBestCoupon(payload: unknown): CouponCandidate | undefined {
  const list = deepFindArray(payload, ["coupons", "offers", "data"]) ?? [];
  const coupons = list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((record) => {
      const flat = flattenOne(record);
      return {
        code: firstString(flat, ["code", "couponCode", "coupon_code"]),
        discount: normalizePrice(firstNumber(flat, ["discount", "discountValue", "maxDiscount", "value"])),
        minimumOrderValue: normalizePrice(firstNumber(flat, ["minimumOrderValue", "minCartValue", "minOrderValue"])),
      };
    })
    .filter((coupon) => coupon.code || coupon.discount);
  return coupons.sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0))[0];
}

function scoreCandidate(candidate: MenuCandidate, coupon?: CouponCandidate): MenuCandidate & {
  estimatedTotal?: number;
  savings?: number;
  couponCode?: string;
} {
  const base = candidate.price;
  const couponApplies =
    base !== undefined &&
    coupon?.discount !== undefined &&
    (coupon.minimumOrderValue === undefined || base >= coupon.minimumOrderValue);
  const savings = couponApplies ? coupon.discount : undefined;
  return {
    ...candidate,
    savings,
    couponCode: couponApplies ? coupon?.code : undefined,
    estimatedTotal: base === undefined ? undefined : Math.max(0, base - (savings ?? 0)),
  };
}

function dedupeCandidates(candidates: MenuCandidate[]): MenuCandidate[] {
  const seen = new Set<string>();
  const out: MenuCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.restaurantId ?? ""}:${candidate.itemId ?? candidate.itemName ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
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

function renderRecommendation(query: string, r: FoodRecommendation, count: number): string {
  const lines = [
    `Best value I found for "${query}":`,
    "",
    `${r.itemName ?? r.title}${r.restaurantName ? ` from ${r.restaurantName}` : ""}`,
    `Estimated total: ${formatMoney(r.estimatedTotal)}`,
  ];
  if (r.couponCode) lines.push(`Coupon to try: ${r.couponCode}${r.savings ? ` (${formatMoney(r.savings)} off)` : ""}`);
  if (r.addOnSuggestion) lines.push(r.addOnSuggestion);
  if (r.eta) lines.push(`ETA: ${r.eta}`);
  if (r.rating) lines.push(`Rating: ${r.rating}`);
  lines.push("", `Compared ${count} candidate items. Reply "confirm" to continue, or search another item.`);
  return lines.join("\n");
}
