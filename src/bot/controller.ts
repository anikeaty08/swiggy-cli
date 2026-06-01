import type {
  DineoutSearchSession,
  FoodRecommendation,
  FoodSearchMode,
  FoodSearchSession,
  InstamartSearchSession,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUserProfile,
} from "./types.js";
import { TelegramBotStore } from "./store.js";
import { TelegramClient } from "./telegram.js";
import { SwiggyCliExecutor } from "../agent/cliExecutor.js";
import { FoodAgent } from "../agent/foodAgent.js";
import { DineoutAgent, InstamartAgent } from "../agent/commerceAgents.js";
import { renderFoodCartSummary, renderPaymentSummary } from "../agent/cartSummary.js";
import { renderTrackingSummary } from "../agent/trackingSummary.js";
import { deepFindArray, firstString } from "../agent/jsonHeuristics.js";
import { geocodeAddress } from "../lib/geocode.js";
import { b, code, h, lines } from "./format.js";

export interface TelegramBotOptions {
  token: string;
  dataDir?: string;
  swiggyCommand?: string;
  once?: boolean;
}

export class SwiggyTelegramBot {
  private readonly client: TelegramClient;
  private readonly store: TelegramBotStore;
  private readonly swiggyCommand?: string;
  private readonly activeActions = new Set<string>();

  constructor(opts: TelegramBotOptions) {
    this.client = new TelegramClient(opts.token);
    this.store = new TelegramBotStore(opts.dataDir);
    this.swiggyCommand = opts.swiggyCommand;
  }

  async start(opts: { once?: boolean } = {}): Promise<void> {
    let offset: number | undefined;
    do {
      let updates;
      try {
        updates = await this.client.getUpdates(offset);
      } catch (err) {
        if (opts.once) throw err;
        process.stderr.write(`Telegram polling error: ${err instanceof Error ? err.message : String(err)}\n`);
        await sleep(5_000);
        continue;
      }
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.callback_query) await this.handleCallback(update.callback_query);
        if (update.message) await this.handleMessage(update.message);
      }
      if (!opts.once) await sleep(500);
    } while (!opts.once);
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const telegramUserId = message.from?.id ?? chatId;
    const text = (message.text ?? "").trim();
    const user = await this.store.getUser(telegramUserId);

    try {
      if (message.location) {
        await this.store.updateUser(telegramUserId, {
          manualLatitude: message.location.latitude,
          manualLongitude: message.location.longitude,
        });
        await this.client.sendMessage(
          chatId,
          lines([
            b("Location received"),
            "I saved the shared coordinates for tracking/location-aware commands.",
            "",
            "Food ordering still needs a saved Swiggy address id.",
            `Send ${code("/addresses")} and then ${code("/location <addressId>")}.`,
          ]),
          undefined,
          "HTML"
        );
        return;
      }

      if (!text || text === "/start" || text === "/help" || text === "/init" || text === "/agent_init") {
        await this.client.sendMessage(chatId, helpText(user), undefined, "HTML");
        return;
      }
      if (text === "/auth" || text.startsWith("/auth ")) {
        const commandText = this.executor(user).authCommand(text.split(/\s+/)[1] || "food");
        await this.client.sendMessage(chatId, authText(commandText), authKeyboard(commandText), "HTML");
        return;
      }
      if (text === "/status") {
        await this.client.sendMessage(chatId, await this.renderStatus(user), undefined, "HTML");
        return;
      }
      if (text === "/addresses") {
        const rendered = await this.renderAddresses(user);
        await this.client.sendMessage(chatId, rendered.text, rendered.keyboard, "HTML");
        return;
      }
      if (text === "/imcart") {
        await this.client.sendMessage(chatId, h(await this.renderInstamartCart(user)), undefined, "HTML");
        return;
      }
      if (text.startsWith("/location")) {
        await this.client.sendMessage(chatId, await this.setLocation(telegramUserId, text), undefined, "HTML");
        return;
      }
      if (text.startsWith("/address")) {
        await this.client.sendMessage(chatId, await this.setManualAddress(telegramUserId, text), undefined, "HTML");
        return;
      }
      if (text === "/cart") {
        await this.client.sendMessage(chatId, h(await this.renderCart(user)), undefined, "HTML");
        return;
      }
      if (text === "/payment") {
        await this.client.sendMessage(chatId, h(await this.renderPayment(user)), undefined, "HTML");
        return;
      }
      if (text.startsWith("/track")) {
        await this.client.sendMessage(chatId, h(await this.trackOrder(user, text)), undefined, "HTML");
        return;
      }
      if (text === "/cancel") {
        await this.store.updateUser(telegramUserId, {
          lastPlan: undefined,
          lastSearch: undefined,
          lastInstamartPlan: undefined,
          lastInstamartSearch: undefined,
          lastDineoutSearch: undefined,
        });
        await this.client.sendMessage(chatId, lines([b("Cancelled"), "Pending actions cleared."]), undefined, "HTML");
        return;
      }
      if (/^(confirm|yes)$/i.test(text)) {
        const latest = await this.store.getUser(telegramUserId);
        if (!latest.lastPlan) {
          await this.client.sendMessage(
            chatId,
            lines([b("No pending item"), `Search first, for example ${code("biryani")} or ${code("4 roti and paneer sabzi")}.`]),
            undefined,
            "HTML"
          );
          return;
        }
        const agent = new FoodAgent(this.executor(latest));
        await this.client.sendMessage(chatId, h(await agent.confirm(latest.lastPlan)), undefined, "HTML");
        return;
      }

      const foodRequest = parseFoodQuery(text);
      const instamartRequest = parseInstamartQuery(text);
      if (instamartRequest) {
        const agent = new InstamartAgent(this.executor(user));
        const result = await agent.search(instamartRequest, user);
        if (result.search || result.plan) {
          await this.store.updateUser(telegramUserId, {
            lastInstamartSearch: result.search,
            lastInstamartPlan: result.plan,
          });
        }
        await this.client.sendMessage(
          chatId,
          result.search ? renderInstamartPage(result.search) : h(result.reply),
          result.search ? instamartKeyboard(result.search) : undefined,
          "HTML"
        );
        return;
      }
      const dineoutRequest = parseDineoutQuery(text);
      if (dineoutRequest) {
        const agent = new DineoutAgent(this.executor(user));
        const result = await agent.search(dineoutRequest, user);
        if (result.search) await this.store.updateUser(telegramUserId, { lastDineoutSearch: result.search });
        await this.client.sendMessage(
          chatId,
          result.search ? renderDineoutPage(result.search) : h(result.reply),
          result.search ? dineoutKeyboard(result.search) : undefined,
          "HTML"
        );
        return;
      }
      if (foodRequest) {
        const agent = new FoodAgent(this.executor(user));
        const result = await agent.recommend(foodRequest.query, user, foodRequest.mode);
        if (result.plan || result.search) {
          await this.store.updateUser(telegramUserId, { lastPlan: result.plan, lastSearch: result.search });
        }
        await this.client.sendMessage(
          chatId,
          result.search ? renderSearchPage(result.search) : h(result.reply),
          result.search ? searchKeyboard(result.search) : undefined,
          "HTML"
        );
        return;
      }

      await this.client.sendMessage(
        chatId,
        lines([b("Swiggy assistant"), `Try ${code("biryani")}, ${code("instamart milk")}, ${code("dineout italian")}, ${code("/addresses")}, or ${code("/status")}.`]),
        undefined,
        "HTML"
      );
    } catch (err) {
      await this.client.sendMessage(chatId, lines([b("Something failed"), h(err instanceof Error ? err.message : String(err))]), undefined, "HTML");
    }
  }

  private async handleCallback(callback: TelegramCallbackQuery): Promise<void> {
    const data = callback.data ?? "";
    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;
    if (!chatId) return;

    try {
      const user = await this.store.getUser(callback.from.id);
      if (data === "auth:status") {
        await this.client.answerCallbackQuery(callback.id);
        await this.client.sendMessage(chatId, await this.renderStatus(user), undefined, "HTML");
        return;
      }
      if (data.startsWith("addr:set:")) {
        const addressId = data.slice("addr:set:".length);
        await this.store.updateUser(callback.from.id, { addressId, lastPlan: undefined, lastInstamartPlan: undefined });
        await this.client.answerCallbackQuery(callback.id, "Address selected");
        await this.client.sendMessage(chatId, lines([b("Delivery address selected"), `${b("Address id")}: ${code(addressId)}`]), undefined, "HTML");
        return;
      }
      if (data.startsWith("im:page:")) {
        if (!user.lastInstamartSearch) {
          await this.client.answerCallbackQuery(callback.id, "Instamart search expired.");
          return;
        }
        const page = Number(data.slice("im:page:".length));
        const nextSearch = clampInstamartPage({ ...user.lastInstamartSearch, page });
        await this.store.updateUser(callback.from.id, { lastInstamartSearch: nextSearch });
        if (messageId) await this.client.editMessageText(chatId, messageId, renderInstamartPage(nextSearch), instamartKeyboard(nextSearch), "HTML");
        await this.client.answerCallbackQuery(callback.id);
        return;
      }
      if (data.startsWith("im:add:")) {
        if (!user.lastInstamartSearch) {
          await this.client.answerCallbackQuery(callback.id, "Instamart search expired.");
          return;
        }
        const index = Number(data.slice("im:add:".length));
        const product = user.lastInstamartSearch.options[index];
        if (!product) {
          await this.client.answerCallbackQuery(callback.id, "That product is no longer available.");
          return;
        }
        const agent = new InstamartAgent(this.executor(user));
        const plan = agent.createPlan(user.lastInstamartSearch.query, user.lastInstamartSearch.addressId, product);
        await this.store.updateUser(callback.from.id, { lastInstamartPlan: plan });
        await this.client.answerCallbackQuery(callback.id, "Adding to Instamart cart...");
        await this.client.sendMessage(chatId, h(await agent.confirm(plan)), undefined, "HTML");
        return;
      }
      if (data.startsWith("do:page:")) {
        if (!user.lastDineoutSearch) {
          await this.client.answerCallbackQuery(callback.id, "Dineout search expired.");
          return;
        }
        const page = Number(data.slice("do:page:".length));
        const nextSearch = clampDineoutPage({ ...user.lastDineoutSearch, page });
        await this.store.updateUser(callback.from.id, { lastDineoutSearch: nextSearch });
        if (messageId) await this.client.editMessageText(chatId, messageId, renderDineoutPage(nextSearch), dineoutKeyboard(nextSearch), "HTML");
        await this.client.answerCallbackQuery(callback.id);
        return;
      }
      if (data.startsWith("do:detail:") || data.startsWith("do:slots:")) {
        if (!user.lastDineoutSearch) {
          await this.client.answerCallbackQuery(callback.id, "Dineout search expired.");
          return;
        }
        const index = Number(data.split(":").at(-1));
        const agent = new DineoutAgent(this.executor(user));
        await this.client.answerCallbackQuery(callback.id);
        const text = data.startsWith("do:detail:")
          ? await agent.details(user.lastDineoutSearch, index)
          : await agent.slots(user.lastDineoutSearch, index);
        await this.client.sendMessage(chatId, h(text), undefined, "HTML");
        return;
      }
      if (!user.lastSearch) {
        await this.client.answerCallbackQuery(callback.id, "Search expired. Send a food name again.");
        return;
      }

      if (data.startsWith("food:page:")) {
        const page = Number(data.slice("food:page:".length));
        const nextSearch = clampSearchPage({ ...user.lastSearch, page });
        await this.store.updateUser(callback.from.id, { lastSearch: nextSearch });
        if (messageId) await this.client.editMessageText(chatId, messageId, renderSearchPage(nextSearch), searchKeyboard(nextSearch), "HTML");
        await this.client.answerCallbackQuery(callback.id);
        return;
      }

      if (data.startsWith("food:add:")) {
        const index = Number(data.slice("food:add:".length));
        const actionKey = `${callback.from.id}:${data}`;
        if (this.activeActions.has(actionKey)) {
          await this.client.answerCallbackQuery(callback.id, "Already adding this. Wait a moment.");
          return;
        }
        this.activeActions.add(actionKey);
        setTimeout(() => this.activeActions.delete(actionKey), 20_000).unref?.();
        if (user.lastSearch.mealOptions?.[index]) {
          const meal = user.lastSearch.mealOptions[index]!;
          const agent = new FoodAgent(this.executor(user));
          const plan = {
            kind: "food_order" as const,
            query: user.lastSearch.query,
            addressId: user.lastSearch.addressId,
            createdAt: new Date().toISOString(),
            recommendation: meal.items[0]!.recommendation,
            items: meal.items,
            discount: meal.discount,
          };
          await this.store.updateUser(callback.from.id, { lastPlan: plan });
          await this.client.answerCallbackQuery(callback.id, "Adding meal to cart...");
          await this.client.sendMessage(chatId, h(await agent.confirm(plan)), undefined, "HTML");
          return;
        }
        const option = user.lastSearch.options[index];
        if (!option) {
          await this.client.answerCallbackQuery(callback.id, "That item is no longer available in this result set.");
          return;
        }
        const agent = new FoodAgent(this.executor(user));
        const plan = agent.createPlan(user.lastSearch.query, user.lastSearch.addressId, option);
        await this.store.updateUser(callback.from.id, { lastPlan: plan });
        await this.client.answerCallbackQuery(callback.id, "Adding item to cart...");
        await this.client.sendMessage(chatId, h(await agent.confirm(plan)), undefined, "HTML");
        return;
      }

      if (data.startsWith("food:detail:")) {
        const index = Number(data.slice("food:detail:".length));
        const meal = user.lastSearch.mealOptions?.[index];
        if (!meal) {
          await this.client.answerCallbackQuery(callback.id, "Price details expired.");
          return;
        }
        await this.client.answerCallbackQuery(callback.id);
        await this.client.sendMessage(chatId, renderMealPriceDetails(index + 1, meal), undefined, "HTML");
        return;
      }

      await this.client.answerCallbackQuery(callback.id);
    } catch (err) {
      await this.client.answerCallbackQuery(callback.id, "Action failed");
      await this.client.sendMessage(chatId, lines([b("Action failed"), h(err instanceof Error ? err.message : String(err))]), undefined, "HTML");
    }
  }

  private executor(user: TelegramUserProfile): SwiggyCliExecutor {
    return new SwiggyCliExecutor({ swiggyHome: user.swiggyHome, command: this.swiggyCommand });
  }

  private async renderStatus(user: TelegramUserProfile): Promise<string> {
    const status = await this.executor(user).authStatus();
    if (!status.ok) return lines([b("Auth status failed"), `${h(status.error.code)}: ${h(status.error.message)}`]);
    const servers = deepFindArray(status.data, ["servers"]) ?? [];
    const out = [
      b("Swiggy profile"),
      `${b("Auth store")}: ${code(user.swiggyHome)}`,
      `${b("Saved address id")}: ${user.addressId ? code(user.addressId) : "not set"}`,
      `${b("Manual address")}: ${user.manualAddress ? h(user.manualAddress) : "not set"}`,
      `${b("Resolved coordinates")}: ${user.manualLatitude !== undefined && user.manualLongitude !== undefined ? h(`${user.manualLatitude}, ${user.manualLongitude}`) : "not set"}`,
      "",
    ];
    for (const row of servers) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      out.push(`${b(firstString(record, ["server"]) ?? "server")}: ${record.authenticated ? "authenticated" : "not authenticated"}`);
    }
    return out.join("\n");
  }

  private async renderAddresses(user: TelegramUserProfile): Promise<{ text: string; keyboard?: unknown }> {
    const res = await this.executor(user).addresses();
    if (!res.ok) {
      if (res.error.code === "AUTH_REQUIRED" || res.error.code === "AUTH_FAILED") {
        return { text: lines([b("Food auth needed"), `Send ${code("/auth food")}, complete browser login, then try ${code("/addresses")} again.`]) };
      }
      return { text: lines([b("Could not list addresses"), `${h(res.error.code)}: ${h(res.error.message)}`]) };
    }
    const addresses = deepFindArray(res.data, ["addresses", "locations", "data"]) ?? [];
    const out = [b("Saved Swiggy addresses")];
    const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
    addresses.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      const id = firstString(record, ["address_id", "addressId", "id"]);
      const line = firstString(record, ["addressLine", "display_address", "address", "formattedAddress"]);
      const tag = firstString(record, ["addressTag", "addressCategory", "name", "label", "title"]);
      const phone = firstString(record, ["phoneNumber", "phone"]);
      if (id) {
        keyboardRows.push([{ text: `Use ${index + 1}`, callback_data: `addr:set:${id}` }]);
        out.push(
          "",
          b(`${index + 1}. ${tag ?? "Address"}`),
          h(line ?? "Address details not returned"),
          phone ? `${b("Phone")}: ${h(phone)}` : "",
          `${b("Use")}: ${code(`/location ${id}`)}`
        );
      }
    });
    if (out.length === 1) out.push("No saved addresses found.");
    out.push("", `You can also save display text with ${code("/address <full address>")}.`);
    return { text: out.join("\n"), keyboard: keyboardRows.length > 0 ? { inline_keyboard: keyboardRows.slice(0, 10) } : undefined };
  }

  private async setLocation(telegramUserId: number, text: string): Promise<string> {
    const value = text.replace(/^\/location\s*/i, "").trim();
    if (!value) {
      return lines([
        b("Set delivery location"),
        `${b("Saved Swiggy address")}: ${code("/location <addressId>")}`,
        `${b("Typed address")}: ${code("/location <full address>")}`,
        "",
        `I will convert typed addresses to coordinates. Use ${code("/addresses")} to see saved address ids for Food.`,
      ]);
    }
    if (looksLikeAddressId(value)) {
      await this.store.updateUser(telegramUserId, { addressId: value, lastPlan: undefined });
      return lines([b("Delivery address selected"), `${b("Address id")}: ${code(value)}`]);
    }
    return this.saveManualAddress(telegramUserId, value);
  }

  private async setManualAddress(telegramUserId: number, text: string): Promise<string> {
    const value = text.replace(/^\/address\s*/i, "").trim();
    if (!value) return lines([b("Save manual address"), `Use ${code("/address <full address>")}.`]);
    return this.saveManualAddress(telegramUserId, value);
  }

  private async saveManualAddress(telegramUserId: number, value: string): Promise<string> {
    try {
      const point = await geocodeAddress(value);
      await this.store.updateUser(telegramUserId, {
        manualAddress: value,
        manualLatitude: point.latitude,
        manualLongitude: point.longitude,
        lastPlan: undefined,
      });
      return [
        b("Address saved"),
        h(value),
        `${b("Resolved")}: ${h(`${point.latitude}, ${point.longitude}`)}`,
        "",
        `Food search/cart still needs a saved Swiggy address id. Send ${code("/addresses")}, then ${code("/location <addressId>")}.`,
      ].join("\n");
    } catch (err) {
      await this.store.updateUser(telegramUserId, {
        manualAddress: value,
        manualLatitude: undefined,
        manualLongitude: undefined,
        lastPlan: undefined,
      });
      return [
        b("Address text saved"),
        h(value),
        "",
        `I could not resolve coordinates yet: ${h(err instanceof Error ? err.message : String(err))}`,
        `Try a more complete address. Food search/cart still needs ${code("/location <addressId>")}.`,
      ].join("\n");
    }
  }

  private async renderCart(user: TelegramUserProfile): Promise<string> {
    if (!user.addressId) return lines([b("Address needed"), `Set one with ${code("/location <addressId>")} first.`]);
    const res = await this.executor(user).foodCart(user.addressId);
    if (!res.ok && res.error.code === "NETWORK" && /429/.test(res.error.message)) {
      return "Swiggy is rate-limiting cart checks right now. Wait 30-60 seconds, then try /cart again.";
    }
    if (!res.ok) return `Could not fetch cart: ${res.error.code} ${res.error.message}`;
    return renderFoodCartSummary(res.data);
  }

  private async renderPayment(user: TelegramUserProfile): Promise<string> {
    if (!user.addressId) return lines([b("Address needed"), `Set one with ${code("/location <addressId>")} first.`]);
    const res = await this.executor(user).foodCart(user.addressId);
    if (!res.ok && res.error.code === "NETWORK" && /429/.test(res.error.message)) {
      return "Swiggy is rate-limiting payment/cart checks right now. Wait 30-60 seconds, then try /payment again.";
    }
    if (!res.ok) return `Could not fetch payment methods: ${res.error.code} ${res.error.message}`;
    return renderPaymentSummary(res.data);
  }

  private async renderInstamartCart(user: TelegramUserProfile): Promise<string> {
    const res = await this.executor(user).instamartCart();
    if (!res.ok) return `Could not fetch Instamart cart: ${res.error.code} ${res.error.message}`;
    return renderFoodCartSummary(res.data);
  }

  private async trackOrder(user: TelegramUserProfile, text: string): Promise<string> {
    const orderId = text.replace(/^\/track\s*/i, "").trim();
    if (!orderId) return `Use ${code("/track <orderId>")} after an order is placed.`;
    const res = await this.executor(user).foodTrackOrder(orderId);
    if (!res.ok) return `Could not track order: ${res.error.code} ${res.error.message}`;
    return renderTrackingSummary(res.data);
  }
}

const PAGE_SIZE = 4;

function clampSearchPage(search: FoodSearchSession): FoodSearchSession {
  const maxPage = Math.max(0, Math.ceil(search.options.length / PAGE_SIZE) - 1);
  return { ...search, page: Math.min(Math.max(0, search.page), maxPage) };
}

function clampInstamartPage(search: InstamartSearchSession): InstamartSearchSession {
  const maxPage = Math.max(0, Math.ceil(search.options.length / PAGE_SIZE) - 1);
  return { ...search, page: Math.min(Math.max(0, search.page), maxPage) };
}

function clampDineoutPage(search: DineoutSearchSession): DineoutSearchSession {
  const maxPage = Math.max(0, Math.ceil(search.options.length / PAGE_SIZE) - 1);
  return { ...search, page: Math.min(Math.max(0, search.page), maxPage) };
}

function renderSearchPage(search: FoodSearchSession): string {
  if (search.mealOptions?.length) return renderMealSearchPage(search);
  const current = clampSearchPage(search);
  const pageCount = Math.max(1, Math.ceil(current.options.length / PAGE_SIZE));
  const start = current.page * PAGE_SIZE;
  const visible = current.options.slice(start, start + PAGE_SIZE);
  const lines = [
    b(current.mode === "cheapest" ? "Cheapest matches" : "Food matches"),
    `${b("Query")}: ${h(current.query)}`,
    `${b("Page")}: ${current.page + 1}/${pageCount}`,
    "",
  ];
  visible.forEach((item, offset) => {
    lines.push(renderOption(start + offset + 1, item), "");
  });
  lines.push("Use the buttons below to add an item or browse more.");
  return lines.join("\n").trim();
}

function renderMealSearchPage(search: FoodSearchSession): string {
  const current = clampSearchPage(search);
  const pageCount = Math.max(1, Math.ceil((current.mealOptions?.length ?? 0) / PAGE_SIZE));
  const start = current.page * PAGE_SIZE;
  const visible = (current.mealOptions ?? []).slice(start, start + PAGE_SIZE);
  const out = [b("Complete meal matches"), `${b("Query")}: ${h(current.query)}`, `${b("Page")}: ${current.page + 1}/${pageCount}`, ""];
  visible.forEach((meal, offset) => {
    out.push(b(`${start + offset + 1}. ${meal.restaurantName ?? "Restaurant"}`));
    for (const item of meal.items) {
      out.push(`${item.quantity} x ${h(item.recommendation.itemName ?? item.recommendation.title)} - Rs ${Math.round(item.recommendation.estimatedTotal ?? 0)} each`);
    }
    out.push(`${b("Estimated total")}: Rs ${Math.round(meal.estimatedTotal)}`, "");
  });
  out.push("Use Add Meal to add all items with quantities. Use Price to see calculation.");
  return out.join("\n").trim();
}

function renderMealPriceDetails(index: number, meal: NonNullable<FoodSearchSession["mealOptions"]>[number]): string {
  const out = [b(`Price details for meal ${index}`), meal.restaurantName ? `${b("Restaurant")}: ${h(meal.restaurantName)}` : undefined, ""].filter(
    (line): line is string => Boolean(line)
  );
  for (const item of meal.items) {
    const unit = Math.round(item.recommendation.estimatedTotal ?? 0);
    out.push(`${item.quantity} x ${h(item.recommendation.itemName ?? item.recommendation.title)} = Rs ${unit * item.quantity}`);
  }
  out.push("", `${b("Estimated item total")}: Rs ${Math.round(meal.estimatedTotal)}`);
  if (meal.discount?.foodCouponCode) {
    out.push(`${b("Food coupon")}: ${h(meal.discount.foodCouponCode)} saves about Rs ${Math.round(meal.discount.foodCouponSavings ?? 0)}`);
  } else if (meal.discount?.addOnNeeded !== undefined && meal.discount.addOnNeeded > 0) {
    out.push(
      `${b("Food coupon")}: add about Rs ${Math.round(meal.discount.addOnNeeded)} more ${
        meal.discount.addOnWorthIt ? "to unlock a better coupon threshold." : "only if you already need another item."
      }`
    );
  } else {
    out.push(`${b("Food coupon")}: no applicable coupon returned by MCP for this estimate.`);
  }
  out.push(`${b("Payment offers")}: ${h(meal.discount?.paymentOfferNote ?? "Not returned by MCP yet.")}`);
  out.push("Taxes, delivery, platform fee, and packaging depend on the final Swiggy cart response.");
  return out.join("\n");
}

function renderOption(index: number, item: FoodRecommendation): string {
  const parts = [
    b(`${index}. ${item.itemName ?? item.title}`),
    item.restaurantName ? `from ${h(item.restaurantName)}` : undefined,
    item.estimatedTotal !== undefined ? `${b("Price")}: Rs ${Math.round(item.estimatedTotal)}` : undefined,
    item.rating ? `${b("Rating")}: ${h(item.rating)}` : undefined,
  ].filter(Boolean);
  return parts.join("\n");
}

function searchKeyboard(search: FoodSearchSession): unknown {
  const current = clampSearchPage(search);
  const pageCount = Math.max(1, Math.ceil(current.options.length / PAGE_SIZE));
  const total = current.mealOptions?.length ?? current.options.length;
  const mealMode = Boolean(current.mealOptions?.length);
  const start = current.page * PAGE_SIZE;
  const visible = (mealMode ? current.mealOptions! : current.options).slice(start, start + PAGE_SIZE);
  const rows = visible.map((_, offset) => {
    const index = start + offset;
    const row = [
      {
        text: `${mealMode ? "Add Meal" : "Add"} ${index + 1}`,
        callback_data: `food:add:${index}`,
      },
    ];
    if (mealMode) row.push({ text: `Price ${index + 1}`, callback_data: `food:detail:${index}` });
    return row;
  });
  const nav = [];
  if (current.page > 0) nav.push({ text: "Prev", callback_data: `food:page:${current.page - 1}` });
  if (start + PAGE_SIZE < total) nav.push({ text: "Next", callback_data: `food:page:${current.page + 1}` });
  if (nav.length > 0) rows.push(nav);
  return { inline_keyboard: rows };
}

function renderInstamartPage(search: InstamartSearchSession): string {
  const current = clampInstamartPage(search);
  const pageCount = Math.max(1, Math.ceil(current.options.length / PAGE_SIZE));
  const start = current.page * PAGE_SIZE;
  const visible = current.options.slice(start, start + PAGE_SIZE);
  const out = [b("Instamart matches"), `${b("Query")}: ${h(current.query)}`, `${b("Page")}: ${current.page + 1}/${pageCount}`, ""];
  visible.forEach((item, offset) => {
    out.push(
      [
        b(`${start + offset + 1}. ${item.title}`),
        item.brand ? `${b("Brand")}: ${h(item.brand)}` : undefined,
        item.quantityText ? `${b("Pack")}: ${h(item.quantityText)}` : undefined,
        item.price !== undefined ? `${b("Price")}: Rs ${Math.round(item.price)}` : undefined,
        item.mrp !== undefined && item.price !== undefined && item.mrp > item.price ? `${b("Savings")}: Rs ${Math.round(item.mrp - item.price)}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      ""
    );
  });
  out.push("Use Add to place the product in Instamart cart. Checkout is not automatic.");
  return out.join("\n").trim();
}

function instamartKeyboard(search: InstamartSearchSession): unknown {
  const current = clampInstamartPage(search);
  const start = current.page * PAGE_SIZE;
  const visible = current.options.slice(start, start + PAGE_SIZE);
  const rows = visible.map((_, offset) => [{ text: `Add ${start + offset + 1}`, callback_data: `im:add:${start + offset}` }]);
  const nav = [];
  if (current.page > 0) nav.push({ text: "Prev", callback_data: `im:page:${current.page - 1}` });
  if (start + PAGE_SIZE < current.options.length) nav.push({ text: "Next", callback_data: `im:page:${current.page + 1}` });
  if (nav.length > 0) rows.push(nav);
  return { inline_keyboard: rows };
}

function renderDineoutPage(search: DineoutSearchSession): string {
  const current = clampDineoutPage(search);
  const pageCount = Math.max(1, Math.ceil(current.options.length / PAGE_SIZE));
  const start = current.page * PAGE_SIZE;
  const visible = current.options.slice(start, start + PAGE_SIZE);
  const out = [b("Dineout matches"), `${b("Query")}: ${h(current.query)}`, `${b("Page")}: ${current.page + 1}/${pageCount}`, ""];
  visible.forEach((item, offset) => {
    out.push(
      [
        b(`${start + offset + 1}. ${item.title}`),
        item.area ? `${b("Area")}: ${h(item.area)}` : undefined,
        item.rating ? `${b("Rating")}: ${h(item.rating)}` : undefined,
        item.costForTwo ? `${b("Cost")}: ${h(item.costForTwo)}` : undefined,
        item.offer ? `${b("Offer")}: ${h(item.offer)}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      ""
    );
  });
  out.push("Use Details or Slots. Booking is not automatic.");
  return out.join("\n").trim();
}

function dineoutKeyboard(search: DineoutSearchSession): unknown {
  const current = clampDineoutPage(search);
  const start = current.page * PAGE_SIZE;
  const visible = current.options.slice(start, start + PAGE_SIZE);
  const rows = visible.map((_, offset) => {
    const index = start + offset;
    return [
      { text: `Details ${index + 1}`, callback_data: `do:detail:${index}` },
      { text: `Slots ${index + 1}`, callback_data: `do:slots:${index}` },
    ];
  });
  const nav = [];
  if (current.page > 0) nav.push({ text: "Prev", callback_data: `do:page:${current.page - 1}` });
  if (start + PAGE_SIZE < current.options.length) nav.push({ text: "Next", callback_data: `do:page:${current.page + 1}` });
  if (nav.length > 0) rows.push(nav);
  return { inline_keyboard: rows };
}

function parseFoodQuery(text: string): { query: string; mode: FoodSearchMode } | undefined {
  const normalized = text.trim();
  const mode: FoodSearchMode = /^(?:cheapest|lowest|budget)\b/i.test(normalized) ? "cheapest" : "best_value";
  const match = normalized.match(/^(?:order|get|find|search|best|cheapest)\s+(.+)$/i);
  if (match?.[1]) return { query: match[1].replace(/\b(please|for me)\b/gi, "").trim(), mode };
  if (normalized.length > 2 && !normalized.startsWith("/")) return { query: normalized, mode };
  return undefined;
}

function parseInstamartQuery(text: string): string | undefined {
  const normalized = text.trim();
  const match = normalized.match(/^(?:instamart|grocery|groceries|mart)\s+(.+)$/i);
  if (match?.[1]) return match[1].replace(/\b(please|for me)\b/gi, "").trim();
  if (/\b(milk|bread|egg|eggs|atta|rice|dal|curd|butter|cheese|oil|shampoo|soap|toothpaste|biscuits)\b/i.test(normalized)) {
    return normalized;
  }
  return undefined;
}

function parseDineoutQuery(text: string): string | undefined {
  const normalized = text.trim();
  const match = normalized.match(/^(?:dineout|table|book table|restaurant booking)\s+(.+)$/i);
  if (match?.[1]) return match[1].replace(/\b(please|for me)\b/gi, "").trim();
  if (/\b(book|table|dineout|dinner|lunch)\b/i.test(normalized)) {
    return normalized.replace(/\b(book|table|for\s+\d+|people|person|today|tomorrow)\b/gi, " ").replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function helpText(user: TelegramUserProfile): string {
  return [
    b("Swiggy food assistant"),
    "",
    b("Commands"),
    `${code("/auth food|instamart|dineout")} - link a Swiggy service`,
    `${code("/init")} - show this agent setup`,
    `${code("/status")} - auth and address status`,
    `${code("/addresses")} - saved Swiggy addresses`,
    `${code("/location <addressId or full address>")} - choose or resolve delivery location`,
    `${code("/address <full address>")} - save and resolve address text`,
    `${code("biryani")} - browse food matches`,
    `${code("4 roti and paneer sabzi")} - build a same-restaurant meal`,
    `${code("instamart milk bread")} - browse grocery matches`,
    `${code("dineout italian")} - browse table/restaurant options`,
    `${code("/cart")} - inspect cart`,
    `${code("/imcart")} - inspect Instamart cart`,
    `${code("/payment")} - show payment methods returned by Swiggy`,
    `${code("/track <orderId>")} - track order and driver location if returned`,
    `${code("/cancel")} - clear pending action`,
    "",
    `${b("Profile")}: ${code(user.swiggyHome)}`,
  ].join("\n");
}

function looksLikeAddressId(value: string): boolean {
  return /^[a-z0-9_-]{8,}$/i.test(value) && !/\s/.test(value);
}

function authText(commandText: string): string {
  return [
    b("Link Swiggy profile"),
    "Run this on the bot host. The browser will open automatically:",
    "",
    code(commandText),
    "",
    `After browser login, send ${code("/status")} here.`,
    "The OAuth callback is local, so run this on the machine hosting the bot.",
  ].join("\n");
}

function authKeyboard(commandText: string): unknown {
  return {
    inline_keyboard: [
      [
        {
          text: "Copy login command",
          copy_text: { text: commandText },
        },
      ],
      [
        {
          text: "Check status",
          callback_data: "auth:status",
        },
      ],
    ],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
