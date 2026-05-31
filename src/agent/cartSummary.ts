import { deepFindArray, firstNumber, firstString, formatMoney } from "./jsonHeuristics.js";

export function renderFoodCartSummary(payload: unknown): string {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const items = deepFindArray(payload, ["items", "cartItems", "lineItems"]) ?? [];
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

  const lines = ["Cart review:"];
  if (itemLines.length > 0) {
    lines.push(...itemLines);
  } else {
    lines.push("Swiggy accepted the cart request, but this MCP cart response did not include itemized cart lines.");
  }
  if (amount !== undefined) lines.push(`Payable amount: ${formatMoney(amount)}`);
  if (methods.length > 0) lines.push(`Payment methods: ${methods.join(", ")}`);
  return lines.join("\n");
}
