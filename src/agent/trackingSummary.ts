import { deepFindArray, firstNumber, firstString } from "./jsonHeuristics.js";

export function renderTrackingSummary(payload: unknown): string {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const lines = ["Order tracking:"];
  const status = firstString(root, ["status", "orderStatus", "statusMessage", "state"]);
  if (status) lines.push(`Status: ${status}`);

  const driver = findObjectWithAny(payload, ["driverName", "deliveryPartnerName", "deName", "name"]);
  if (driver) {
    const name = firstString(driver, ["driverName", "deliveryPartnerName", "deName", "name"]);
    const phone = firstString(driver, ["phone", "phoneNumber", "mobile"]);
    if (name) lines.push(`Driver: ${name}`);
    if (phone) lines.push(`Driver phone: ${phone}`);
  }

  const location = findObjectWithLatLng(payload);
  if (location) {
    const lat = firstNumber(location, ["lat", "latitude"]);
    const lng = firstNumber(location, ["lng", "lon", "longitude"]);
    if (lat !== undefined && lng !== undefined) {
      lines.push(`Driver location: ${lat}, ${lng}`);
      lines.push(`Map: https://www.google.com/maps?q=${lat},${lng}`);
    }
  }

  if (lines.length === 1) {
    lines.push("Swiggy did not return driver/location fields for this tracking response yet.");
  }
  return lines.join("\n");
}

function findObjectWithLatLng(payload: unknown): Record<string, unknown> | undefined {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (
      firstNumber(record, ["lat", "latitude"]) !== undefined &&
      firstNumber(record, ["lng", "lon", "longitude"]) !== undefined
    ) {
      return record;
    }
  }
  const candidates = deepFindArray(payload, ["locations", "tracking", "data"]) ?? [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    if (
      firstNumber(record, ["lat", "latitude"]) !== undefined &&
      firstNumber(record, ["lng", "lon", "longitude"]) !== undefined
    ) {
      return record;
    }
  }
  return undefined;
}

function findObjectWithAny(payload: unknown, keys: string[], requireAll = false): Record<string, unknown> | undefined {
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
    const matches = keys.filter((key) => record[key] !== undefined);
    if ((requireAll && matches.length === keys.length) || (!requireAll && matches.length > 0)) return record;
    queue.push(...Object.values(record).filter((value) => value && typeof value === "object"));
  }
  return undefined;
}
