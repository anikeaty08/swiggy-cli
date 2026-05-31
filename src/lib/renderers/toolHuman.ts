import Table from "cli-table3";
import chalk from "chalk";
import type { RenderContext } from "../output.js";
import { BRAND } from "../output.js";
import { shouldUseColor } from "../tty.js";

export function renderToolHuman(data: unknown, ctx: RenderContext): void {
  const rows = extractRows(data);
  const colored = shouldUseColor(ctx);
  const head = (s: string) => (colored ? chalk.hex(BRAND.orange)(s) : s);

  if (ctx.tool === "search_restaurants" || ctx.tool === "search_restaurants_dineout") {
    return renderTable(rows, ["name", "rating", "distance", "eta", "open"], head);
  }
  if (ctx.tool === "get_food_cart" || ctx.tool === "get_cart") {
    return renderSummary(data, ["restaurantName", "total", "fees", "address", "paymentMethods"], head);
  }
  if (ctx.tool === "get_available_slots") {
    return renderTable(rows, ["time", "slot", "available", "offer"], head);
  }
  if (ctx.tool === "track_food_order" || ctx.tool === "track_order") {
    return renderSummary(data, ["status", "eta", "orderId", "deliveryPartner", "message"], head);
  }
  renderSummary(data, [], head);
}

function renderTable(rows: Record<string, unknown>[], preferred: string[], head: (s: string) => string): void {
  const headers = chooseHeaders(rows, preferred);
  if (rows.length === 0 || headers.length === 0) {
    process.stdout.write("No results.\n");
    return;
  }
  const table = new Table({ head: headers.map(head), wordWrap: true, style: { head: [], border: [] } });
  for (const row of rows) table.push(headers.map((h) => format(row[h] ?? findCaseInsensitive(row, h))));
  process.stdout.write(table.toString() + "\n");
}

function renderSummary(data: unknown, preferred: string[], head: (s: string) => string): void {
  const record = firstRecord(data);
  if (!record) {
    process.stdout.write(format(data) + "\n");
    return;
  }
  const keys = preferred.length > 0 ? preferred.filter((key) => findCaseInsensitive(record, key) !== undefined) : Object.keys(record).slice(0, 12);
  const table = new Table({ wordWrap: true, style: { head: [], border: [] } });
  for (const key of keys) table.push([head(key), format(findCaseInsensitive(record, key))]);
  process.stdout.write(table.toString() + "\n");
}

function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  const record = firstRecord(data);
  if (!record) return [];
  for (const key of ["restaurants", "cards", "items", "slots", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [record];
}

function firstRecord(data: unknown): Record<string, unknown> | undefined {
  if (isRecord(data)) return data;
  if (Array.isArray(data)) return data.find(isRecord);
  return undefined;
}

function chooseHeaders(rows: Record<string, unknown>[], preferred: string[]): string[] {
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  const picked = preferred.filter((key) => available.has(key) || rows.some((row) => findCaseInsensitive(row, key) !== undefined));
  if (picked.length > 0) return picked;
  return Array.from(available).slice(0, 6);
}

function findCaseInsensitive(row: Record<string, unknown>, key: string): unknown {
  if (row[key] !== undefined) return row[key];
  const lower = key.toLowerCase();
  const actual = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return actual ? row[actual] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(format).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
