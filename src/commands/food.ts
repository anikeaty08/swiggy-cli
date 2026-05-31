import { Command } from "commander";
import { UsageError } from "../lib/errors.js";
import { attachOutputOptions, callTool, ensureAddressId, parseJsonInput, resolveExecOpts } from "./common.js";

export function buildFoodCommands(program: Command): void {
  const food = program.command("food").description("Swiggy Food: search, menus, cart, orders");

  attachOutputOptions(
    food
      .command("search-restaurants")
      .description("Search restaurants by query or cuisine")
      .option("-q, --query <q>", "search query (e.g. 'biryani')")
      .option("--address-id <id>", "delivery address id")
      .option("--offset <n>", "pagination offset")
      .action(async (o: { query?: string; addressId?: string; offset?: string }) => {
        const opts = await resolveExecOpts(food);
        const addressId = await ensureAddressId("food", opts, o.addressId, { requiredBy: "food search-restaurants" });
        if (!o.query) {
          throw new UsageError("Missing required option --query.");
        }
        await callTool(
          "food",
          "search_restaurants",
          stripUndefined({ query: o.query, addressId, offset: toNonNegativeInteger(o.offset, "--offset") }),
          opts
        );
      })
  );

  attachOutputOptions(
    food
      .command("search-menu")
      .description("Search menu items across restaurants")
      .option("-q, --query <q>", "search query")
      .option("--address-id <id>", "delivery address id")
      .option("--restaurant-id <id>", "scope results to the current restaurant")
      .option("--veg-only", "show veg items only")
      .option("--offset <n>", "pagination offset")
      .action(
        async (o: { query?: string; addressId?: string; restaurantId?: string; vegOnly?: boolean; offset?: string }) => {
          const opts = await resolveExecOpts(food);
          const addressId = await ensureAddressId("food", opts, o.addressId, { requiredBy: "food search-menu" });
          if (!o.query) {
            throw new UsageError("Missing required option --query.");
          }
          await callTool(
            "food",
            "search_menu",
            stripUndefined({
              query: o.query,
              addressId,
              restaurantIdOfAddedItem: o.restaurantId,
              vegFilter: o.vegOnly ? 1 : undefined,
              offset: toNonNegativeInteger(o.offset, "--offset"),
            }),
            opts
          );
        }
      )
  );

  attachOutputOptions(
    food
      .command("menu")
      .description("Get a restaurant's menu")
      .option("--restaurant-id <id>", "restaurant id")
      .option("--address-id <id>", "delivery address id")
      .option("--page <n>", "menu page number")
      .option("--page-size <n>", "number of categories per page")
      .action(async (o: { restaurantId?: string; addressId?: string; page?: string; pageSize?: string }) => {
        if (!o.restaurantId) {
          throw new UsageError("Missing required option --restaurant-id.", "Run: swiggy food search-restaurants first");
        }
        const opts = await resolveExecOpts(food);
        const addressId = await ensureAddressId("food", opts, o.addressId, { requiredBy: "food menu" });
        await callTool(
          "food",
          "get_restaurant_menu",
          stripUndefined({
            restaurantId: o.restaurantId,
            addressId,
            page: toPositiveInteger(o.page, "--page"),
            pageSize: toPositiveInteger(o.pageSize, "--page-size"),
          }),
          opts
        );
      })
  );

  attachOutputOptions(
    food
      .command("addresses")
      .description("List your saved delivery addresses")
      .action(async () => {
        await callTool("food", "get_addresses", {}, await resolveExecOpts(food));
      })
  );

  attachOutputOptions(
    food
      .command("cart")
      .description("Show your current food cart")
      .option("--address-id <id>", "delivery address id")
      .option("--restaurant-name <name>", "restaurant name for display context")
      .action(async (o: { addressId?: string; restaurantName?: string }) => {
        const opts = await resolveExecOpts(food);
        const addressId = await ensureAddressId("food", opts, o.addressId, { requiredBy: "food cart" });
        await callTool("food", "get_food_cart", stripUndefined({ addressId, restaurantName: o.restaurantName }), opts);
      })
  );

  attachOutputOptions(
    food
      .command("add-to-cart")
      .description("Add or update items in the food cart")
      .option("--restaurant-id <id>", "restaurant id")
      .option("--address-id <id>", "delivery address id")
      .option("--item-id <id>", "menu item id")
      .option("--quantity <n>", "quantity", "1")
      .option("--restaurant-name <name>", "restaurant name for display context")
      .option("--input <json>", "raw arguments JSON (overrides flags)")
      .action(
        async (o: {
          restaurantId?: string;
          addressId?: string;
          itemId?: string;
          quantity?: string;
          restaurantName?: string;
          input?: string;
        }) => {
          if (!o.input && (!o.restaurantId || !o.itemId)) {
            throw new UsageError(
              "Missing required options for add-to-cart.",
              "Provide --restaurant-id and --item-id, or pass --input <json>"
            );
          }
          if (!o.input && o.quantity && Number(o.quantity) <= 0) {
            throw new UsageError("Invalid --quantity. It must be a positive number.");
          }
          const opts = await resolveExecOpts(food);
          const addressId = o.input
            ? undefined
            : await ensureAddressId("food", opts, o.addressId, { requiredBy: "food add-to-cart" });
          const args = o.input
            ? parseJsonInput(o.input)
            : stripUndefined({
                restaurantId: o.restaurantId,
                addressId,
                restaurantName: o.restaurantName,
                cartItems: [{ itemId: o.itemId, quantity: o.quantity ? Number(o.quantity) : 1 }],
              });
          await callTool("food", "update_food_cart", args, opts);
        }
      )
  );

  attachOutputOptions(
    food
      .command("clear-cart")
      .description("Empty the food cart")
      .action(async () => {
        await callTool("food", "flush_food_cart", {}, await resolveExecOpts(food));
      })
  );

  attachOutputOptions(
    food
      .command("list-coupons")
      .description("List available food coupons")
      .action(async () => {
        await callTool("food", "fetch_food_coupons", {}, await resolveExecOpts(food));
      })
  );

  attachOutputOptions(
    food
      .command("apply-coupon <code>")
      .description("Apply a coupon code to the food cart")
      .action(async (code: string) => {
        await callTool("food", "apply_food_coupon", { code }, await resolveExecOpts(food));
      })
  );

  attachOutputOptions(
    food
      .command("checkout")
      .description("Place the current food order (COD only; destructive)")
      .option("--address-id <id>", "delivery address id")
      .option("--payment-method <method>", "payment method from get_food_cart")
      .option("--input <json>", "raw arguments JSON")
      .action(async (o: { addressId?: string; paymentMethod?: string; input?: string }) => {
        const opts = await resolveExecOpts(food);
        const addressId = o.input
          ? undefined
          : await ensureAddressId("food", opts, o.addressId, { requiredBy: "food checkout" });
        const args = o.input ? parseJsonInput(o.input) : stripUndefined({ addressId, paymentMethod: o.paymentMethod });
        await callTool("food", "place_food_order", args, opts);
      })
  );

  attachOutputOptions(
    food
      .command("orders")
      .description("List your active food orders")
      .option("--address-id <id>", "delivery address id")
      .option("--count <n>", "number of orders to fetch")
      .action(async (o: { addressId?: string; count?: string }) => {
        const opts = await resolveExecOpts(food);
        const addressId = await ensureAddressId("food", opts, o.addressId, { requiredBy: "food orders" });
        await callTool(
          "food",
          "get_food_orders",
          stripUndefined({ addressId, orderCount: toPositiveInteger(o.count, "--count") }),
          opts
        );
      })
  );

  attachOutputOptions(
    food
      .command("order <id>")
      .description("Show details of a specific food order")
      .action(async (id: string) => {
        await callTool("food", "get_food_order_details", { orderId: id }, await resolveExecOpts(food));
      })
  );

  attachOutputOptions(
    food
      .command("track <id>")
      .description("Track a food order")
      .action(async (id: string) => {
        await callTool("food", "track_food_order", { orderId: id }, await resolveExecOpts(food));
      })
  );
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== "") out[k] = v;
  return out as Partial<T>;
}

function toPositiveInteger(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`Invalid ${flagName}. It must be a positive integer.`);
  }
  return parsed;
}

function toNonNegativeInteger(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(`Invalid ${flagName}. It must be a non-negative integer.`);
  }
  return parsed;
}
