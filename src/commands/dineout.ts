import { Command } from "commander";
import { UsageError } from "../lib/errors.js";
import { attachOutputOptions, callTool, ensureDineoutLocation, parseJsonInput, parseJsonInputOrFile, resolveExecOpts } from "./common.js";
import {
  buildDineoutDetailsPayload,
  buildDineoutSearchPayload,
  buildDineoutSlotsPayload,
  buildDineoutStatusPayload,
  stripUndefined,
  toNumber,
} from "../lib/payloads.js";
import { geocodeAddress } from "../lib/geocode.js";

export function buildDineoutCommands(program: Command): void {
  const d = program.command("dineout").description("Swiggy Dineout: discover restaurants, slots, bookings");

  attachOutputOptions(
    d
      .command("search")
      .alias("restaurants")
      .description("Search Dineout restaurants")
      .option("-q, --query <q>", "search query")
      .option("--entity-type <type>", "optional filter type: locality|CUISINE|RESTAURANT_CATEGORY")
      .option("--address-id <id>", "saved location id from dineout locations")
      .option("--address <address>", "plain address to geocode")
      .option("--lat <lat>", "latitude")
      .option("--lng <lng>", "longitude")
      .action(async (o: { query?: string; entityType?: string; addressId?: string; address?: string; lat?: string; lng?: string }) => {
        const opts = await resolveExecOpts(d);
        if (!o.query) {
          throw new UsageError("Missing required option --query.");
        }
        const geocoded = o.address ? await geocodeAddress(o.address) : undefined;
        const location = await ensureDineoutLocation(
          opts,
          stripUndefined({
            addressId: o.addressId,
            latitude: geocoded?.latitude ?? (o.lat !== undefined ? toNumber(o.lat, "--lat") : undefined),
            longitude: geocoded?.longitude ?? (o.lng !== undefined ? toNumber(o.lng, "--lng") : undefined),
          }),
          "dineout search"
        );
        await callTool(
          "dineout",
          "search_restaurants_dineout",
          buildDineoutSearchPayload({ query: o.query, entityType: o.entityType, ...location }),
          opts
        );
      })
  );

  attachOutputOptions(
    d
      .command("details <id>")
      .description("Show restaurant details (menu, ratings, offers)")
      .option("--address <address>", "plain address to geocode")
      .option("--lat <lat>", "latitude used for the search")
      .option("--lng <lng>", "longitude used for the search")
      .action(async (id: string, o: { address?: string; lat?: string; lng?: string }) => {
        const geocoded = o.address ? await geocodeAddress(o.address) : undefined;
        await callTool(
          "dineout",
          "get_restaurant_details",
          buildDineoutDetailsPayload({ restaurantId: id, lat: geocoded?.latitude ?? o.lat, lng: geocoded?.longitude ?? o.lng }),
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
      .option("--address <address>", "plain address to geocode")
      .option("--lat <lat>", "latitude")
      .option("--lng <lng>", "longitude")
      .action(async (o: { restaurantId?: string; date?: string; address?: string; lat?: string; lng?: string }) => {
        if (!o.restaurantId) {
          throw new UsageError("Missing required option --restaurant-id.", "Run: swiggy dineout search first");
        }
        if (!o.date) {
          throw new UsageError("Missing required option --date.");
        }
        const geocoded = o.address ? await geocodeAddress(o.address) : undefined;
        await callTool(
          "dineout",
          "get_available_slots",
          buildDineoutSlotsPayload({ ...o, lat: geocoded?.latitude ?? o.lat, lng: geocoded?.longitude ?? o.lng }),
          await resolveExecOpts(d)
        );
      })
  );

  attachOutputOptions(
    d
      .command("cart")
      .description("Create a Dineout booking cart")
      .option("--input <json>", "raw arguments JSON", "{}")
      .option("--input-file <path>", "read raw arguments JSON from a file")
      .action(async (o: { input?: string; inputFile?: string }) => {
        await callTool(
          "dineout",
          "create_cart",
          o.inputFile ? await parseJsonInputOrFile(o.input, o.inputFile) : parseJsonInput(o.input || "{}"),
          await resolveExecOpts(d)
        );
      })
  );

  attachOutputOptions(
    d
      .command("book")
      .description("Book a table (destructive)")
      .option("--input <json>", "booking payload JSON", "{}")
      .option("--input-file <path>", "read booking payload JSON from a file")
      .action(async (o: { input?: string; inputFile?: string }) => {
        await callTool(
          "dineout",
          "book_table",
          o.inputFile ? await parseJsonInputOrFile(o.input, o.inputFile) : parseJsonInput(o.input || "{}"),
          await resolveExecOpts(d)
        );
      })
  );

  attachOutputOptions(
    d
      .command("status <orderId>")
      .description("Get the status of a booking")
      .action(async (id: string) => {
        await callTool("dineout", "get_booking_status", buildDineoutStatusPayload(id), await resolveExecOpts(d));
      })
  );
}
