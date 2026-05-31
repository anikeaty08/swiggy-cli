import type { FoodRecommendation, FoodSearchMode, FoodSearchSession, TelegramCallbackQuery, TelegramMessage, TelegramUserProfile } from "./types.js";
import { TelegramBotStore } from "./store.js";
import { TelegramClient } from "./telegram.js";
import { SwiggyCliExecutor } from "../agent/cliExecutor.js";
import { FoodAgent } from "../agent/foodAgent.js";
import { renderFoodCartSummary } from "../agent/cartSummary.js";
import { deepFindArray, firstString } from "../agent/jsonHeuristics.js";

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
          city: `${message.location.latitude},${message.location.longitude}`,
        });
        await this.client.sendMessage(
          chatId,
          "I saved the shared coordinates for context. Food ordering still needs a Swiggy saved address id; send `/addresses` and then `/location <addressId>`."
        );
        return;
      }

      if (!text || text === "/start" || text === "/help") {
        await this.client.sendMessage(chatId, helpText(user));
        return;
      }
      if (text === "/auth" || text.startsWith("/auth ")) {
        await this.client.sendMessage(chatId, authText(this.executor(user), text.split(/\s+/)[1] || "food"));
        return;
      }
      if (text === "/status") {
        await this.client.sendMessage(chatId, await this.renderStatus(user));
        return;
      }
      if (text === "/addresses") {
        await this.client.sendMessage(chatId, await this.renderAddresses(user), undefined, "HTML");
        return;
      }
      if (text.startsWith("/location")) {
        await this.client.sendMessage(chatId, await this.setLocation(telegramUserId, text));
        return;
      }
      if (text.startsWith("/address")) {
        await this.client.sendMessage(chatId, await this.setManualAddress(telegramUserId, text));
        return;
      }
      if (text === "/cart") {
        await this.client.sendMessage(chatId, await this.renderCart(user));
        return;
      }
      if (text === "/cancel") {
        await this.store.updateUser(telegramUserId, { lastPlan: undefined });
        await this.client.sendMessage(chatId, "Pending action cancelled.");
        return;
      }
      if (/^(confirm|yes)$/i.test(text)) {
        const latest = await this.store.getUser(telegramUserId);
        if (!latest.lastPlan) {
          await this.client.sendMessage(chatId, "There is no pending order plan. Try `order biryani` first.");
          return;
        }
        const agent = new FoodAgent(this.executor(latest));
        await this.client.sendMessage(chatId, await agent.confirm(latest.lastPlan));
        return;
      }

      const foodRequest = parseFoodQuery(text);
      if (foodRequest) {
        const agent = new FoodAgent(this.executor(user));
        const result = await agent.recommend(foodRequest.query, user, foodRequest.mode);
        if (result.plan || result.search) {
          await this.store.updateUser(telegramUserId, { lastPlan: result.plan, lastSearch: result.search });
        }
        await this.client.sendMessage(
          chatId,
          result.search ? renderSearchPage(result.search) : result.reply,
          result.search ? searchKeyboard(result.search) : undefined
        );
        return;
      }

      await this.client.sendMessage(chatId, "I can help with food orders. Try `order biryani`, `/addresses`, or `/status`.");
    } catch (err) {
      await this.client.sendMessage(chatId, err instanceof Error ? err.message : String(err));
    }
  }

  private async handleCallback(callback: TelegramCallbackQuery): Promise<void> {
    const data = callback.data ?? "";
    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;
    if (!chatId) return;

    try {
      const user = await this.store.getUser(callback.from.id);
      if (!user.lastSearch) {
        await this.client.answerCallbackQuery(callback.id, "Search expired. Send a food name again.");
        return;
      }

      if (data.startsWith("food:page:")) {
        const page = Number(data.slice("food:page:".length));
        const nextSearch = clampSearchPage({ ...user.lastSearch, page });
        await this.store.updateUser(callback.from.id, { lastSearch: nextSearch });
        if (messageId) await this.client.editMessageText(chatId, messageId, renderSearchPage(nextSearch), searchKeyboard(nextSearch));
        await this.client.answerCallbackQuery(callback.id);
        return;
      }

      if (data.startsWith("food:add:")) {
        const index = Number(data.slice("food:add:".length));
        const option = user.lastSearch.options[index];
        if (!option) {
          await this.client.answerCallbackQuery(callback.id, "That item is no longer available in this result set.");
          return;
        }
        const agent = new FoodAgent(this.executor(user));
        const plan = agent.createPlan(user.lastSearch.query, user.lastSearch.addressId, option);
        await this.store.updateUser(callback.from.id, { lastPlan: plan });
        await this.client.answerCallbackQuery(callback.id, "Adding item to cart...");
        await this.client.sendMessage(chatId, await agent.confirm(plan));
        return;
      }

      await this.client.answerCallbackQuery(callback.id);
    } catch (err) {
      await this.client.answerCallbackQuery(callback.id, "Action failed");
      await this.client.sendMessage(chatId, err instanceof Error ? err.message : String(err));
    }
  }

  private executor(user: TelegramUserProfile): SwiggyCliExecutor {
    return new SwiggyCliExecutor({ swiggyHome: user.swiggyHome, command: this.swiggyCommand });
  }

  private async renderStatus(user: TelegramUserProfile): Promise<string> {
    const status = await this.executor(user).authStatus();
    if (!status.ok) return `Auth status failed: ${status.error.code} ${status.error.message}`;
    const servers = deepFindArray(status.data, ["servers"]) ?? [];
    const lines = [
      "Swiggy profile:",
      `SWIGGY_HOME: ${user.swiggyHome}`,
      `Address id: ${user.addressId ?? "not set"}`,
      `Manual address: ${user.manualAddress ?? "not set"}`,
      "",
    ];
    for (const row of servers) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      lines.push(`${firstString(record, ["server"]) ?? "server"}: ${record.authenticated ? "authenticated" : "not authenticated"}`);
    }
    return lines.join("\n");
  }

  private async renderAddresses(user: TelegramUserProfile): Promise<string> {
    const res = await this.executor(user).addresses();
    if (!res.ok) {
      if (res.error.code === "AUTH_REQUIRED" || res.error.code === "AUTH_FAILED") {
        return "Food auth is not ready. Send `/auth food`, complete the CLI auth flow, then try `/addresses` again.";
      }
      return `Could not list addresses: ${res.error.code} ${res.error.message}`;
    }
    const addresses = deepFindArray(res.data, ["addresses", "locations", "data"]) ?? [];
    const lines = ["Saved addresses:"];
    addresses.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      const id = firstString(record, ["address_id", "addressId", "id"]);
      const line = firstString(record, ["addressLine", "display_address", "address", "formattedAddress"]);
      const tag = firstString(record, ["addressTag", "addressCategory", "name", "label", "title"]);
      const phone = firstString(record, ["phoneNumber", "phone"]);
      if (id) {
        lines.push(
          "",
          `<b>${index + 1}. ${escapeHtml(tag ?? "Address")}</b>`,
          escapeHtml(line ?? "Address details not returned"),
          phone ? `Phone: ${escapeHtml(phone)}` : "",
          `<code>${escapeHtml(id)}</code>`
        );
      }
    });
    if (lines.length === 1) lines.push("No saved addresses found.");
    lines.push("", "Set one with <b>/location addressId</b>.");
    return lines.join("\n");
  }

  private async setLocation(telegramUserId: number, text: string): Promise<string> {
    const value = text.replace(/^\/location\s*/i, "").trim();
    if (!value) return "Use `/location <addressId>` for saved Swiggy addresses, or `/address <full address>` for manual text.";
    if (looksLikeAddressId(value)) {
      await this.store.updateUser(telegramUserId, { addressId: value, lastPlan: undefined });
      return `Delivery address set to ${value}.`;
    }
    await this.store.updateUser(telegramUserId, { manualAddress: value, lastPlan: undefined });
    return [
      "Manual address saved.",
      value,
      "",
      "For Swiggy Food actions I still need a saved Swiggy address id. Send `/addresses`, then `/location <addressId>`.",
    ].join("\n");
  }

  private async setManualAddress(telegramUserId: number, text: string): Promise<string> {
    const value = text.replace(/^\/address\s*/i, "").trim();
    if (!value) return "Use `/address <full address>` to save address text.";
    await this.store.updateUser(telegramUserId, { manualAddress: value, lastPlan: undefined });
    return [
      "Manual address saved.",
      value,
      "",
      "Swiggy Food still requires one of your saved Swiggy address ids for search/cart. Use `/addresses` and `/location <addressId>`.",
    ].join("\n");
  }

  private async renderCart(user: TelegramUserProfile): Promise<string> {
    if (!user.addressId) return "Set `/location <addressId>` first.";
    const res = await this.executor(user).foodCart(user.addressId);
    if (!res.ok) return `Could not fetch cart: ${res.error.code} ${res.error.message}`;
    return renderFoodCartSummary(res.data);
  }
}

const PAGE_SIZE = 4;

function clampSearchPage(search: FoodSearchSession): FoodSearchSession {
  const maxPage = Math.max(0, Math.ceil(search.options.length / PAGE_SIZE) - 1);
  return { ...search, page: Math.min(Math.max(0, search.page), maxPage) };
}

function renderSearchPage(search: FoodSearchSession): string {
  const current = clampSearchPage(search);
  const pageCount = Math.max(1, Math.ceil(current.options.length / PAGE_SIZE));
  const start = current.page * PAGE_SIZE;
  const visible = current.options.slice(start, start + PAGE_SIZE);
  const lines = [
    `${current.mode === "cheapest" ? "Cheapest matches" : "Food matches"} for "${current.query}"`,
    `Page ${current.page + 1}/${pageCount}`,
    "",
  ];
  visible.forEach((item, offset) => {
    lines.push(renderOption(start + offset + 1, item), "");
  });
  lines.push("Use Add buttons to add a specific item. Use next/prev to browse more.");
  return lines.join("\n").trim();
}

function renderOption(index: number, item: FoodRecommendation): string {
  const parts = [
    `${index}. ${item.itemName ?? item.title}`,
    item.restaurantName ? `from ${item.restaurantName}` : undefined,
    item.estimatedTotal !== undefined ? `Rs ${Math.round(item.estimatedTotal)}` : undefined,
    item.rating ? `rating ${item.rating}` : undefined,
  ].filter(Boolean);
  return parts.join("\n");
}

function searchKeyboard(search: FoodSearchSession): unknown {
  const current = clampSearchPage(search);
  const pageCount = Math.max(1, Math.ceil(current.options.length / PAGE_SIZE));
  const start = current.page * PAGE_SIZE;
  const visible = current.options.slice(start, start + PAGE_SIZE);
  const rows = visible.map((_, offset) => [
    {
      text: `Add ${start + offset + 1}`,
      callback_data: `food:add:${start + offset}`,
    },
  ]);
  const nav = [];
  if (current.page > 0) nav.push({ text: "Prev", callback_data: `food:page:${current.page - 1}` });
  if (current.page < pageCount - 1) nav.push({ text: "Next", callback_data: `food:page:${current.page + 1}` });
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

function helpText(user: TelegramUserProfile): string {
  return [
    "Swiggy Telegram agent",
    "",
    "Commands:",
    "`/auth food` - show the per-user auth command",
    "`/status` - check auth and selected address",
    "`/addresses` - list saved Swiggy addresses",
    "`/location <addressId>` - set delivery address",
    "`/address <full address>` - save manual address text",
    "`order biryani` - find the best-value matching food item",
    "`/cart` - inspect cart",
    "`/cancel` - clear pending action",
    "",
    `Your isolated SWIGGY_HOME is ${user.swiggyHome}`,
  ].join("\n");
}

function looksLikeAddressId(value: string): boolean {
  return /^[a-z0-9_-]{8,}$/i.test(value) && !/\s/.test(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function authText(executor: SwiggyCliExecutor, server: string): string {
  return [
    "Run this on the bot host to link this Telegram profile:",
    "",
    `\`${executor.authCommand(server)}\``,
    "",
    "After the browser flow finishes, send `/status` here. For a remote phone browser, run the command on the host machine because the current Swiggy OAuth flow uses a local loopback callback.",
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
