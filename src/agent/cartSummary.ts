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
      const name = firstString(item, ["name", "itemName", "title", "displayName", "display_name", "productName"]) ?? "item";
      const quantity = firstNumber(item, ["quantity", "qty"]);
      const unit = firstNumber(item, ["price", "unitPrice", "finalPrice", "sellingPrice"]);
      const total = firstNumber(item, ["total", "itemTotal", "lineTotal", "subTotal"]);
      const amount = total ?? (unit !== undefined && quantity !== undefined ? unit * quantity : unit);
      return `${quantity ? `${quantity} x ` : ""}${name}${amount ? ` - ${formatMoney(normalizePrice(amount))}` : ""}`;
    });

  const amount = findFirstNumber(payload, ["paymentAmount", "total", "totalAmount", "finalAmount", "payableAmount", "toPay"]);
  const itemTotal = findFirstNumber(payload, ["itemTotal", "itemsTotal", "cartTotal", "subTotal", "subtotal"]);
  const fees = collectAmountLines(payload, [
    ["delivery", "deliveryFee", "deliveryCharge"],
    ["platform", "platformFee"],
    ["packaging", "packagingCharge", "packingCharge"],
    ["tax", "tax", "taxes", "gst"],
  ]);
  const discounts = collectAmountLines(payload, [
    ["discount", "discount", "discountAmount", "couponDiscount", "totalDiscount"],
    ["coupon", "couponSavings", "couponDiscount", "savings"],
  ]);
  const methods = collectPaymentMethodLabels(payload);
  const upi = extractUpiPaymentOptions(payload);
  const paymentOffers = extractPaymentOffers(payload);

  const lines = ["Cart:"];
  if (itemLines.length > 0) {
    lines.push(...itemLines);
  } else if (fallback.itemName || fallback.restaurantName) {
    lines.push(`${fallback.itemName ?? "Selected item"}${fallback.restaurantName ? ` from ${fallback.restaurantName}` : ""}`);
  } else {
    lines.push("Itemized cart lines were not included in this Swiggy MCP response.");
  }
  lines.push("");
  if (itemTotal !== undefined || fees.length > 0 || discounts.length > 0) {
    lines.push("Price breakup:");
    if (itemTotal !== undefined) lines.push(`Items: ${formatMoney(normalizePrice(itemTotal))}`);
    for (const fee of fees) lines.push(`${fee.label}: ${formatMoney(normalizePrice(fee.amount))}`);
    for (const discount of discounts) lines.push(`${discount.label}: -${formatMoney(normalizePrice(discount.amount))}`);
    lines.push("");
  }
  lines.push("Payment:");
  lines.push(`Method: ${methods.length > 0 ? methods.join(", ") : "not returned"}`);
  if (upi.length > 0) {
    lines.push("UPI options:");
    for (const option of upi) {
      lines.push(`- ${option.label}${option.uri ? `: ${option.uri}` : ""}`);
    }
  } else {
    lines.push("UPI/QR: not returned by Swiggy MCP for this cart");
  }
  if (paymentOffers.length > 0) {
    lines.push("Payment offers:");
    for (const offer of paymentOffers.slice(0, 5)) lines.push(`- ${offer}`);
  }
  lines.push(`Payable: ${amount !== undefined ? formatMoney(normalizePrice(amount)) : fallback.estimatedTotal !== undefined ? `${formatMoney(fallback.estimatedTotal)} estimated` : "not returned"}`);
  lines.push(`Status: ${record.successful === true ? "cart request accepted" : "unknown"}`);
  return lines.join("\n");
}

export function renderPaymentSummary(payload: unknown): string {
  const lines = ["Payment options:"];
  const methods = collectPaymentMethodLabels(payload);
  if (methods.length > 0) lines.push(`Available: ${methods.join(", ")}`);
  const upi = extractUpiPaymentOptions(payload);
  if (upi.length > 0) {
    lines.push("", "UPI / QR data returned by Swiggy:");
    for (const option of upi) {
      lines.push(`- ${option.label}`);
      if (option.uri) lines.push(`  ${option.uri}`);
    }
    lines.push("", "Open the UPI URI from your phone to pay. Only trust this if it came from Swiggy cart/checkout.");
  } else {
    lines.push("", "No UPI intent or QR payload was returned by this MCP cart response.");
  }
  const offers = extractPaymentOffers(payload);
  if (offers.length > 0) {
    lines.push("", "Payment offers:");
    for (const offer of offers.slice(0, 8)) lines.push(`- ${offer}`);
  } else {
    lines.push("No card/payment offers were returned by this MCP cart response.");
  }
  return lines.join("\n");
}

function findCartItemArrays(payload: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  const cartKeys = new Set(["items", "cartItems", "lineItems", "cart_items", "products", "productItems"]);
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
  const hasFoodName = firstString(record, ["name", "itemName", "title", "displayName", "display_name", "productName"]) !== undefined;
  const hasCartSignal =
    firstNumber(record, ["quantity", "qty", "price", "unitPrice", "finalPrice", "itemTotal"]) !== undefined ||
    firstString(record, ["itemId", "item_id", "skuId", "dishId", "spinId"]) !== undefined;
  const isPayment = firstString(record, ["groupName", "payment_code", "display_name", "group_name"]) !== undefined;
  return hasFoodName && hasCartSignal && !isPayment;
}

function collectPaymentMethodLabels(payload: unknown): string[] {
  const labels = new Set<string>();
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (Array.isArray(root.availablePaymentMethods)) {
    for (const method of root.availablePaymentMethods) if (typeof method === "string" && method.trim()) labels.add(method.trim());
  }
  for (const record of collectRecords(payload)) {
    const paymentCode = firstString(record, ["payment_code", "paymentCode", "groupName", "group_name"]);
    const label = firstString(record, ["displayName", "display_name", "name", "label"]);
    if (paymentCode && label && !looksLikeCartItem(record)) labels.add(label);
  }
  return [...labels];
}

function extractPaymentOffers(payload: unknown): string[] {
  const offers = new Set<string>();
  for (const record of collectRecords(payload)) {
    const text = firstString(record, ["offer", "offers", "paymentOffer", "bankOffer", "description", "title", "message"]);
    const code = firstString(record, ["code", "couponCode", "paymentCode"]);
    const amount = firstNumber(record, ["discount", "discountAmount", "maxDiscount", "savings"]);
    const hasPaymentSignal = Object.keys(record).some((key) => /payment|bank|card|upi|offer|discount|coupon/i.test(key));
    if (hasPaymentSignal && (text || code || amount !== undefined)) {
      offers.add([code, text, amount !== undefined ? `${formatMoney(normalizePrice(amount))} off` : undefined].filter(Boolean).join(" - "));
    }
  }
  return [...offers].filter((offer) => offer.length > 0);
}

function collectAmountLines(payload: unknown, specs: string[][]): Array<{ label: string; amount: number }> {
  const out: Array<{ label: string; amount: number }> = [];
  for (const [label, ...keys] of specs) {
    if (!label) continue;
    const amount = findFirstNumber(payload, keys);
    if (amount !== undefined && amount > 0) out.push({ label: capitalize(label), amount });
  }
  return out;
}

function findFirstNumber(payload: unknown, keys: string[]): number | undefined {
  for (const record of collectRecords(payload)) {
    const value = firstNumber(record, keys);
    if (value !== undefined) return value;
  }
  return undefined;
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
    out.push(record);
    queue.push(...Object.values(record).filter((value) => value && typeof value === "object"));
  }
  return out;
}

function normalizePrice(value: number): number {
  return value > 10_000 ? value / 100 : value;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractUpiPaymentOptions(payload: unknown): Array<{ label: string; uri?: string }> {
  const out: Array<{ label: string; uri?: string }> = [];
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
    const label = firstString(record, ["displayName", "display_name", "name", "label", "title"]) ?? "UPI option";
    const uri = firstString(record, ["upiUri", "upi_uri", "intentUrl", "intent_url", "deepLink", "deeplink", "paymentUrl", "payment_url", "qrData", "qr_data"]);
    const group = firstString(record, ["groupName", "group_name", "type", "payment_code"]);
    const upiIntent = record.upiIntent === true || record.upi_intent === true;
    const hasUsableUri = Boolean(uri && (uri.startsWith("upi://") || /^https?:\/\//i.test(uri)));
    const explicitlyUpi = upiIntent || /upi/i.test(group ?? "") || (/upi/i.test(label) && hasUsableUri);
    if (hasUsableUri || explicitlyUpi) {
      out.push({ label, uri });
    }
    queue.push(...Object.values(record).filter((value) => value && typeof value === "object"));
  }
  return out;
}
