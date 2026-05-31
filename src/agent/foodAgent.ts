import type { FoodPlanItem, FoodRecommendation, FoodSearchMode, FoodSearchSession, PendingFoodPlan, TelegramUserProfile } from "../bot/types.js";
import { SwiggyCliExecutor } from "./cliExecutor.js";
import { renderFoodCartSummary } from "./cartSummary.js";
import { deepFindArray, firstNumber, firstString, formatMoney } from "./jsonHeuristics.js";

export interface FoodAgentResult {
  reply: string;
  plan?: PendingFoodPlan;
  search?: FoodSearchSession;
}

export class FoodAgent {
  constructor(private readonly executor: SwiggyCliExecutor) {}

  async recommend(query: string, user: TelegramUserProfile, mode: FoodSearchMode = "best_value"): Promise<FoodAgentResult> {
    if (!user.addressId) {
      return {
        reply:
          "Set a delivery address first.\n\nRun `/addresses` to list saved Swiggy addresses, then `/location <addressId>`.",
      };
    }
    const addressId = user.addressId;

    const composite = parseCompositeRequest(query);
    if (composite.length > 1) {
      const compositeResult = await this.recommendComposite(query, composite, user, mode);
      if (compositeResult) return compositeResult;
    }

    const search = await this.executor.call("food", "search_menu", {
      query,
      addressId,
    });
    if (!search.ok) return { reply: this.errorReply(search.error.code, search.error.message) };

    let candidates = extractMenuCandidates(search.data).slice(0, 8);
    if (candidates.length === 0) {
      candidates = await this.restaurantMenuFallback(query, addressId);
    }
    if (candidates.length === 0) {
      return { reply: `I could not find food items for "${query}" at the selected address.` };
    }

    const coupons = await this.executor.foodCoupons().catch(() => undefined);
    const bestCoupon = coupons?.ok ? extractBestCoupon(coupons.data) : undefined;
    const ranked = candidates
      .map((candidate) => scoreCandidate(candidate, bestCoupon))
      .sort((a, b) => compareCandidates(a, b, mode));
    const options = ranked.map((candidate) => toRecommendation(query, candidate, bestCoupon));
    const recommendation = options[0]!;

    const plan: PendingFoodPlan = {
      kind: "food_order",
      query,
      addressId,
      createdAt: new Date().toISOString(),
      recommendation,
    };

    return {
      plan,
      search: {
        kind: "food_search",
        query,
        mode,
        addressId: user.addressId,
        page: 0,
        options,
        createdAt: new Date().toISOString(),
      },
      reply: renderRecommendation(query, recommendation, ranked, mode),
    };
  }

  createPlan(query: string, addressId: string, recommendation: FoodRecommendation): PendingFoodPlan {
    return {
      kind: "food_order",
      query,
      addressId,
      createdAt: new Date().toISOString(),
      recommendation,
    };
  }

  async confirm(plan: PendingFoodPlan): Promise<string> {
    const items = plan.items?.length ? plan.items : [{ recommendation: plan.recommendation, quantity: 1 }];
    const added: string[] = [];
    for (const item of items) {
      const r = item.recommendation;
    if (!r.restaurantId || !r.itemId) {
      return "I found a recommendation, but the result did not include enough item IDs to safely build the cart. Open Swiggy manually or try a more specific item.";
    }
    const add = await this.executor.foodAddToCart({
      restaurantId: r.restaurantId,
      addressId: plan.addressId,
      itemId: r.itemId,
      restaurantName: r.restaurantName,
        quantity: item.quantity,
    });
    if (!add.ok) return `Could not update cart: ${add.error.code} ${add.error.message}`;
      added.push(`${item.quantity} x ${r.itemName ?? r.itemId}`);
    }

    const primary = items[0]!.recommendation;
    let couponLine = "";
    if (primary.couponCode) {
      const coupon = await this.executor.foodApplyCoupon(primary.couponCode).catch(() => undefined);
      couponLine = coupon?.ok
        ? `\nCoupon applied: ${primary.couponCode}`
        : `\nCoupon ${primary.couponCode} could not be applied automatically; check it before checkout.`;
    }

    const cart = await this.executor.foodCart(plan.addressId);
    const cartText = cart.ok
      ? renderFoodCartSummary(cart.data, {
          itemName: added.join(", "),
          restaurantName: primary.restaurantName,
          estimatedTotal: sumPlanEstimate(items),
        })
      : `Could not fetch cart: ${cart.error.code} ${cart.error.message}`;
    return (
      `Added to cart:\n${added.join("\n")}` +
      (primary.restaurantName ? `\nfrom ${primary.restaurantName}` : "") +
      couponLine +
      "\n\nReview the cart before checkout:\n" +
      cartText +
      "\n\nCheckout is not automatic. Place the order only after verifying the final total in Swiggy/CLI."
    );
  }

  private async recommendComposite(
    query: string,
    components: FoodComponent[],
    user: TelegramUserProfile,
    mode: FoodSearchMode
  ): Promise<FoodAgentResult | undefined> {
    if (!user.addressId) return undefined;
    const addressId = user.addressId;
    const restaurantQuery = components.map((c) => c.query).join(" ");
    const restaurants = await this.executor.call("food", "search_restaurants", { query: restaurantQuery, addressId });
    if (!restaurants.ok) return undefined;
    const restaurantCandidates = extractRestaurantCandidates(restaurants.data).slice(0, 6);
    const matches: Array<{ restaurant: MenuCandidate; items: FoodPlanItem[]; total: number; score: number }> = [];
    for (const restaurant of restaurantCandidates) {
      if (!restaurant.restaurantId) continue;
      const menu = await this.executor
        .call("food", "get_restaurant_menu", {
          restaurantId: restaurant.restaurantId,
          addressId,
          page: 1,
          pageSize: 10,
        })
        .catch(() => undefined);
      if (!menu?.ok) continue;
      const candidates = dedupeCandidates(extractMenuCandidates(menu.data, restaurant));
      const planItems: FoodPlanItem[] = [];
      for (const component of components) {
        const match = bestComponentMatch(candidates, component, mode);
        if (!match) break;
        planItems.push({
          recommendation: toRecommendation(component.query, scoreCandidate(match), undefined),
          quantity: component.quantity,
        });
      }
      if (planItems.length !== components.length) continue;
      const total = sumPlanEstimate(planItems);
      matches.push({
        restaurant,
        items: planItems,
        total,
        score: total + averageRatingPenalty(planItems),
      });
    }
    const best = matches.sort((a, b) => (mode === "cheapest" ? a.total - b.total : a.score - b.score))[0];
    if (!best) return undefined;
    const primary = best.items[0]!.recommendation;
    const plan: PendingFoodPlan = {
      kind: "food_order",
      query,
      addressId,
      createdAt: new Date().toISOString(),
      recommendation: primary,
      items: best.items,
    };
    return {
      plan,
      reply: renderCompositeRecommendation(query, best.items, best.restaurant.restaurantName, matches.length),
    };
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

interface FoodComponent {
  query: string;
  quantity: number;
  keywords: string[];
}

function parseCompositeRequest(query: string): FoodComponent[] {
  const normalized = query
    .toLowerCase()
    .replace(/\b(kee|ki|ka|ke)\b/g, " ")
    .replace(/\b(sabji|sabzi|sabjee)\b/g, "sabzi")
    .replace(/\b(chappathi|chapathi|chapati)\b/g, "roti")
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized
    .split(/\s+(?:and|with|\+|aur)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  return parts.map((part) => {
    const quantityMatch = part.match(/^(\d+)\s+(.+)$/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    const cleaned = (quantityMatch?.[2] ?? part).replace(/\b(of|plate|plates)\b/g, " ").replace(/\s+/g, " ").trim();
    return {
      query: cleaned,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      keywords: expandComponentKeywords(cleaned),
    };
  });
}

function expandComponentKeywords(query: string): string[] {
  const tokens = query.split(/\s+/).filter((token) => !["sabzi", "curry", "gravy"].includes(token));
  if (tokens.includes("roti")) return ["roti", "chapati", "phulka", "paratha", "tawa"];
  if (tokens.includes("paneer")) return ["paneer"];
  return tokens;
}

function bestComponentMatch(candidates: MenuCandidate[], component: FoodComponent, mode: FoodSearchMode): MenuCandidate | undefined {
  const matches = candidates.filter((candidate) => {
    const name = (candidate.itemName ?? "").toLowerCase();
    return component.keywords.some((keyword) => name.includes(keyword));
  });
  return matches
    .map((candidate) => scoreCandidate(candidate))
    .sort((a, b) => compareCandidates(a, b, mode))[0];
}

function sumPlanEstimate(items: FoodPlanItem[]): number {
  return items.reduce((sum, item) => sum + (item.recommendation.estimatedTotal ?? 0) * item.quantity, 0);
}

function averageRatingPenalty(items: FoodPlanItem[]): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => {
    const rating = Number(item.recommendation.rating);
    return sum + (Number.isFinite(rating) ? Math.max(0, 4.3 - rating) * 80 : 40);
  }, 0) / items.length;
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

function toRecommendation(query: string, candidate: ScoredCandidate, coupon?: CouponCandidate): FoodRecommendation {
  const addOn = coupon?.minimumOrderValue && candidate.price && candidate.price < coupon.minimumOrderValue
    ? coupon.minimumOrderValue - candidate.price
    : undefined;
  return {
    title: candidate.itemName || candidate.restaurantName || query,
    restaurantName: candidate.restaurantName,
    restaurantId: candidate.restaurantId,
    itemName: candidate.itemName,
    itemId: candidate.itemId,
    estimatedTotal: candidate.estimatedTotal,
    savings: candidate.savings,
    couponCode: candidate.couponCode,
    addOnSuggestion: addOn && addOn > 0 ? `Add about ${formatMoney(addOn)} more to test the coupon threshold.` : undefined,
    eta: candidate.eta,
    rating: candidate.rating,
    raw: candidate.raw,
  };
}

type ScoredCandidate = MenuCandidate & {
  estimatedTotal?: number;
  savings?: number;
  couponCode?: string;
};

function compareCandidates(a: ScoredCandidate, b: ScoredCandidate, mode: FoodSearchMode): number {
  if (mode === "cheapest") {
    return (a.estimatedTotal ?? Number.POSITIVE_INFINITY) - (b.estimatedTotal ?? Number.POSITIVE_INFINITY);
  }
  return valueScore(a) - valueScore(b);
}

function valueScore(candidate: ScoredCandidate): number {
  const total = candidate.estimatedTotal ?? Number.POSITIVE_INFINITY;
  const rating = Number(candidate.rating);
  const ratingPenalty = Number.isFinite(rating) ? Math.max(0, 4.3 - rating) * 80 : 40;
  return total + ratingPenalty;
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

function renderRecommendation(query: string, r: FoodRecommendation, ranked: ScoredCandidate[], mode: FoodSearchMode): string {
  const lines = [
    `${mode === "cheapest" ? "Cheapest match" : "Best value pick"} for "${query}":`,
    "",
    `${r.itemName ?? r.title}${r.restaurantName ? ` from ${r.restaurantName}` : ""}`,
    `Estimated total: ${formatMoney(r.estimatedTotal)}`,
  ];
  if (r.couponCode) lines.push(`Coupon to try: ${r.couponCode}${r.savings ? ` (${formatMoney(r.savings)} off)` : ""}`);
  if (r.addOnSuggestion) lines.push(r.addOnSuggestion);
  if (r.eta) lines.push(`ETA: ${r.eta}`);
  if (r.rating) lines.push(`Rating: ${r.rating}`);
  const alternatives = ranked.slice(1, 4);
  if (alternatives.length > 0) {
    lines.push("", "Other options:");
    for (const alt of alternatives) {
      lines.push(`- ${alt.itemName ?? "Item"} from ${alt.restaurantName ?? "restaurant"} - ${formatMoney(alt.estimatedTotal)}${alt.rating ? `, rating ${alt.rating}` : ""}`);
    }
  }
  lines.push("", `Compared ${ranked.length} candidate items. Reply "confirm" to continue, or search another item.`);
  return lines.join("\n");
}

function renderCompositeRecommendation(
  query: string,
  items: FoodPlanItem[],
  restaurantName: string | undefined,
  restaurantCount: number
): string {
  const lines = [
    `Meal match for "${query}":`,
    restaurantName ? `Restaurant: ${restaurantName}` : undefined,
    "",
  ].filter((line): line is string => line !== undefined);
  for (const item of items) {
    lines.push(
      `${item.quantity} x ${item.recommendation.itemName ?? item.recommendation.title} - ${formatMoney(item.recommendation.estimatedTotal)} each`
    );
  }
  lines.push("", `Estimated item total: ${formatMoney(sumPlanEstimate(items))}`);
  lines.push(`Matched complete meal at ${restaurantCount} restaurant${restaurantCount === 1 ? "" : "s"}. Reply "confirm" to add all items.`);
  return lines.join("\n");
}
