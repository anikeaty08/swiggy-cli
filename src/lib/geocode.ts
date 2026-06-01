import { UsageError } from "./errors.js";
import { VERSION } from "./version.js";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(address: string): Promise<Coordinates> {
  const query = address.trim();
  if (!query) throw new UsageError("Missing address text.", "Pass --address \"full address\"");

  const endpoint = process.env.SWIGGY_GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search";
  const userAgent = process.env.SWIGGY_GEOCODER_USER_AGENT ?? `swiggy-mcp-agent/${VERSION}`;
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
    });
  } catch (err) {
    throw new UsageError(`Could not geocode address: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new UsageError(`Could not geocode address: HTTP ${response.status}`, "Try a more specific address or use --lat/--lng");
  }

  const point = parseGeocodePayload((await response.json()) as unknown);
  if (!point) {
    throw new UsageError("Could not find coordinates for that address.", "Try a more specific address or use --lat/--lng");
  }
  return point;
}

function parseGeocodePayload(payload: unknown): Coordinates | undefined {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first || typeof first !== "object") return undefined;
  const record = first as Record<string, unknown>;
  const latitude = firstNumber(record, ["lat", "latitude"]);
  const longitude = firstNumber(record, ["lon", "lng", "longitude"]);
  if (latitude === undefined || longitude === undefined) return undefined;
  return { latitude, longitude };
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
