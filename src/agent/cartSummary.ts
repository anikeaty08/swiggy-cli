import { deepFindArray, firstNumber, firstString, formatMoney } from "./jsonHeuristics.js";

export interface CartSummaryFallback {
  itemName?: string;
  restaurantName?: string;
  estimatedTotal?: number;
}

export function renderFoodCartSummary(payload: unknown, fallback: CartSummaryFallback = {}): string {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const items = findCartItemArrays(payload);
  const itemLines = items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const name = firstString(item, ["name", "itemName", "title"]) ?? "item";
      const quantity = firstNumber(item, ["quantity", "qty"]);
      const price = firstNumber(item, ["price", "finalPrice", "total", "itemTotal"]);
      return `${quantity ? `${quantity} x ` : ""}${name}${price ? ` - ${formatMoney(price)}` : ""}`;
    });

  const amount =
    firstNumber(record, ["paymentAmount", "total", "totalAmount", "finalAmount", "payableAmount"]) ??
    firstNumber((record.paymentOptions as Record<string, unknown> | undefined) ?? {}, ["paymentAmount"]);
  const methods = Array.isArray(record.availablePaymentMethods)
    ? (record.availablePaymentMethods as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const lines = ["Cart:"];
  if (itemLines.length > 0) {
    lines.push(...itemLines);
  } else if (fallback.itemName || fallback.restaurantName) {
    lines.push(`${fallback.itemName ?? "Selected item"}${fallback.restaurantName ? ` from ${fallback.restaurantName}` : ""}`);
  } else {
    lines.push("Itemized cart lines were not included in this Swiggy MCP response.");
  }
  lines.push("");
  lines.push("Payment:");
  lines.push(`Method: ${methods.length > 0 ? methods.join(", ") : "not returned"}`);
  lines.push(`Payable: ${amount !== undefined ? formatMoney(amount) : fallback.estimatedTotal !== undefined ? `${formatMoney(fallback.estimatedTotal)} estimated` : "not returned"}`);
  lines.push(`Status: ${record.successful === true ? "cart request accepted" : "unknown"}`);
  return lines.join("\n");
}

function findCartItemArrays(payload: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  const cartKeys = new Set(["items", "cartItems", "lineItems", "cart_items"]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        if (looksLikeCartItem(item)) out.push(item);
        if (item && typeof item === "object") queue.push(item);
      }
      continue;
    }
    const record = current as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (cartKeys.has(key) && Array.isArray(value)) {
        out.push(...value.filter(looksLikeCartItem));
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return out;
}

function looksLikeCartItem(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const hasFoodName = firstString(record, ["name", "itemName", "title"]) !== undefined;
  const hasCartSignal =
    firstNumber(record, ["quantity", "qty", "price", "finalPrice", "itemTotal"]) !== undefined ||
    firstString(record, ["itemId", "item_id", "skuId", "dishId"]) !== undefined;
  const isPayment = firstString(record, ["groupName", "payment_code", "display_name", "group_name"]) !== undefined;
  return hasFoodName && hasCartSignal && !isPayment;
}
