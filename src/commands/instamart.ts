import { Command } from "commander";
import { UsageError } from "../lib/errors.js";
import { attachOutputOptions, callTool, ensureAddressId, parseJsonInput, parseJsonInputOrFile, resolveExecOpts } from "./common.js";
import {
  buildInstamartAddToCartPayload,
  buildInstamartCheckoutPayload,
  buildInstamartTrackPayload,
  stripUndefined,
  toNonNegativeInteger,
} from "../lib/payloads.js";

export function buildInstamartCommands(program: Command): void {
  const im = program.command("instamart").description("Swiggy Instamart: groceries, cart, checkout");

  attachOutputOptions(
    im
      .command("search")
      .description("Search Instamart products")
      .option("-q, --query <q>", "search query")
      .option("--address-id <id>", "delivery address id")
      .option("--offset <n>", "pagination offset")
      .action(async (o: { query?: string; addressId?: string; offset?: string }) => {
        const opts = await resolveExecOpts(im);
        const addressId = await ensureAddressId("instamart", opts, o.addressId, { requiredBy: "instamart search" });
        if (!o.query) {
          throw new UsageError("Missing required option --query.");
        }
        await callTool(
          "instamart",
          "search_products",
          stripUndefined({ query: o.query, addressId, offset: toNonNegativeInteger(o.offset, "--offset") }),
          opts
        );
      })
  );

  attachOutputOptions(
    im
      .command("go-to-items")
      .description("Show your frequently-ordered Instamart items")
      .option("--address-id <id>", "delivery address id")
      .action(async (o: { addressId?: string }) => {
        const opts = await resolveExecOpts(im);
        const addressId = await ensureAddressId("instamart", opts, o.addressId, { requiredBy: "instamart go-to-items" });
        await callTool("instamart", "your_go_to_items", { addressId }, opts);
      })
  );

  attachOutputOptions(
    im
      .command("addresses")
      .description("List Instamart addresses")
      .action(async () => {
        await callTool("instamart", "get_addresses", {}, await resolveExecOpts(im));
      })
  );

  attachOutputOptions(
    im
      .command("create-address")
      .description("Create a delivery address")
      .option("--input <json>", "address payload JSON", "{}")
      .action(async (o: { input?: string }) => {
        await callTool("instamart", "create_address", parseJsonInput(o.input || "{}"), await resolveExecOpts(im));
      })
  );

  attachOutputOptions(
    im
      .command("delete-address <id>")
      .description("Delete an Instamart address (destructive)")
      .action(async (id: string) => {
        await callTool("instamart", "delete_address", { addressId: id }, await resolveExecOpts(im));
      })
  );

  attachOutputOptions(
    im
      .command("cart")
      .description("Show current Instamart cart")
      .action(async () => {
        await callTool("instamart", "get_cart", {}, await resolveExecOpts(im));
      })
  );

  attachOutputOptions(
    im
      .command("add-to-cart")
      .description("Update Instamart cart")
      .option("--address-id <id>", "delivery address id")
      .option("--spin-id <id>", "variant spinId from search results")
      .option("--quantity <n>", "quantity", "1")
      .option("--input <json>", "raw arguments JSON")
      .option("--input-file <path>", "read raw arguments JSON from a file")
      .action(async (o: { addressId?: string; spinId?: string; quantity?: string; input?: string; inputFile?: string }) => {
        const opts = await resolveExecOpts(im);
        const addressId = o.input || o.inputFile
          ? undefined
          : await ensureAddressId("instamart", opts, o.addressId, { requiredBy: "instamart add-to-cart" });
        const args =
          o.input || o.inputFile
            ? await parseJsonInputOrFile(o.input, o.inputFile)
            : buildInstamartAddToCartPayload({ addressId: addressId!, spinId: o.spinId, quantity: o.quantity });
        await callTool("instamart", "update_cart", args, opts);
      })
  );

  attachOutputOptions(
    im
      .command("clear-cart")
      .description("Empty the Instamart cart (destructive)")
      .action(async () => {
        await callTool("instamart", "clear_cart", {}, await resolveExecOpts(im));
      })
  );

  attachOutputOptions(
    im
      .command("checkout")
      .description("Place Instamart order (destructive)")
      .option("--address-id <id>", "delivery address id")
      .option("--payment-method <method>", "payment method from get_cart")
      .option("--input <json>", "raw arguments JSON")
      .option("--input-file <path>", "read raw arguments JSON from a file")
      .action(async (o: { addressId?: string; paymentMethod?: string; input?: string; inputFile?: string }) => {
        const opts = await resolveExecOpts(im);
        const addressId = o.input || o.inputFile
          ? undefined
          : await ensureAddressId("instamart", opts, o.addressId, { requiredBy: "instamart checkout" });
        const args =
          o.input || o.inputFile
            ? await parseJsonInputOrFile(o.input, o.inputFile)
            : buildInstamartCheckoutPayload({ addressId: addressId!, paymentMethod: o.paymentMethod });
        await callTool("instamart", "checkout", args, opts);
      })
  );

  attachOutputOptions(
    im
      .command("orders")
      .description("List Instamart orders")
      .action(async () => {
        await callTool("instamart", "get_orders", {}, await resolveExecOpts(im));
      })
  );

  attachOutputOptions(
    im
      .command("order <id>")
      .description("Show details of an Instamart order")
      .action(async (id: string) => {
        await callTool("instamart", "get_order_details", { orderId: id }, await resolveExecOpts(im));
      })
  );

  attachOutputOptions(
    im
      .command("track <id>")
      .description("Track an Instamart order")
      .option("--lat <lat>", "delivery latitude")
      .option("--lng <lng>", "delivery longitude")
      .action(async (id: string, o: { lat?: string; lng?: string }) => {
        await callTool(
          "instamart",
          "track_order",
          buildInstamartTrackPayload({ orderId: id, lat: o.lat, lng: o.lng }),
          await resolveExecOpts(im)
        );
      })
  );
}
