import { Command } from "commander";
import { UsageError } from "../lib/errors.js";
import { attachOutputOptions, callTool, ensureDineoutLocation, parseJsonInput, resolveExecOpts } from "./common.js";

export function buildDineoutCommands(program: Command): void {
  const d = program.command("dineout").description("Swiggy Dineout: discover restaurants, slots, bookings");

  attachOutputOptions(
    d
      .command("search")
      .description("Search Dineout restaurants")
      .option("-q, --query <q>", "search query")
      .option("--entity-type <type>", "optional filter type: locality|CUISINE|RESTAURANT_CATEGORY")
      .option("--address-id <id>", "saved location id from dineout locations")
      .option("--lat <lat>", "latitude")
      .option("--lng <lng>", "longitude")
      .action(async (o: { query?: string; entityType?: string; addressId?: string; lat?: string; lng?: string }) => {
        const opts = await resolveExecOpts(d);
        if (!o.query) {
          throw new UsageError("Missing required option --query.");
        }
        const location = await ensureDineoutLocation(
          opts,
          strip({
            addressId: o.addressId,
            latitude: o.lat !== undefined ? toNumber(o.lat, "--lat") : undefined,
            longitude: o.lng !== undefined ? toNumber(o.lng, "--lng") : undefined,
          }),
          "dineout search"
        );
        await callTool(
          "dineout",
          "search_restaurants_dineout",
          strip({ query: o.query, entityType: o.entityType, ...location }),
          opts
        );
      })
  );

  attachOutputOptions(
    d
      .command("details <id>")
      .description("Show restaurant details (menu, ratings, offers)")
      .option("--lat <lat>", "latitude used for the search")
      .option("--lng <lng>", "longitude used for the search")
      .action(async (id: string, o: { lat?: string; lng?: string }) => {
        await callTool(
          "dineout",
          "get_restaurant_details",
          { restaurantId: id, latitude: toNumber(o.lat, "--lat"), longitude: toNumber(o.lng, "--lng") },
          await resolveExecOpts(d)
        );
      })
  );

  attachOutputOptions(
    d
      .command("locations")
      .description("List your saved Dineout locations")
      .action(async () => {
        await callTool("dineout", "get_saved_locations", {}, await resolveExecOpts(d));
      })
  );

  attachOutputOptions(
    d
      .command("slots")
      .description("Get available booking slots for a restaurant")
      .option("--restaurant-id <id>", "restaurant id")
      .option("--date <yyyy-mm-dd>", "booking date")
      .option("--lat <lat>", "latitude")
      .option("--lng <lng>", "longitude")
      .action(async (o: { restaurantId?: string; date?: string; lat?: string; lng?: string }) => {
        if (!o.restaurantId) {
          throw new UsageError("Missing required option --restaurant-id.", "Run: swiggy dineout search first");
        }
        if (!o.date) {
          throw new UsageError("Missing required option --date.");
        }
        await callTool(
          "dineout",
          "get_available_slots",
          {
            restaurantId: o.restaurantId,
            date: o.date,
            latitude: toNumber(o.lat, "--lat"),
            longitude: toNumber(o.lng, "--lng"),
          },
          await resolveExecOpts(d)
        );
      })
  );

  attachOutputOptions(
    d
      .command("cart")
      .description("Create a Dineout booking cart")
      .option("--input <json>", "raw arguments JSON", "{}")
      .action(async (o: { input?: string }) => {
        await callTool("dineout", "create_cart", parseJsonInput(o.input || "{}"), await resolveExecOpts(d));
      })
  );

  attachOutputOptions(
    d
      .command("book")
      .description("Book a table (destructive)")
      .option("--input <json>", "booking payload JSON", "{}")
      .action(async (o: { input?: string }) => {
        await callTool("dineout", "book_table", parseJsonInput(o.input || "{}"), await resolveExecOpts(d));
      })
  );

  attachOutputOptions(
    d
      .command("status <orderId>")
      .description("Get the status of a booking")
      .action(async (id: string) => {
        await callTool("dineout", "get_booking_status", { orderId: id }, await resolveExecOpts(d));
      })
  );
}

function strip<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out as Partial<T>;
}

function toNumber(value: string | undefined, flagName: string): number {
  if (value === undefined) {
    throw new UsageError(`Missing required option ${flagName}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`Invalid ${flagName}. It must be a number.`);
  }
  return parsed;
}
