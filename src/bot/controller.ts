import type { TelegramMessage, TelegramUserProfile } from "./types.js";
import { TelegramBotStore } from "./store.js";
import { TelegramClient } from "./telegram.js";
import { SwiggyCliExecutor } from "../agent/cliExecutor.js";
import { FoodAgent } from "../agent/foodAgent.js";
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
      const updates = await this.client.getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
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
        await this.client.sendMessage(chatId, await this.renderAddresses(user));
        return;
      }
      if (text.startsWith("/location")) {
        await this.client.sendMessage(chatId, await this.setLocation(telegramUserId, text));
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

      const query = parseFoodQuery(text);
      if (query) {
        const agent = new FoodAgent(this.executor(user));
        const result = await agent.recommend(query, user);
        if (result.plan) await this.store.updateUser(telegramUserId, { lastPlan: result.plan });
        await this.client.sendMessage(chatId, result.reply);
        return;
      }

      await this.client.sendMessage(chatId, "I can help with food orders. Try `order biryani`, `/addresses`, or `/status`.");
    } catch (err) {
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
    const lines = ["Swiggy profile:", `SWIGGY_HOME: ${user.swiggyHome}`, `Address id: ${user.addressId ?? "not set"}`, ""];
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
    for (const item of addresses) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const id = firstString(record, ["address_id", "addressId", "id"]);
      const label = firstString(record, ["display_address", "address", "name", "label", "title", "area"]);
      if (id) lines.push(`${id} - ${label ?? "address"}`);
    }
    if (lines.length === 1) lines.push("No saved addresses found.");
    lines.push("", "Set one with `/location <addressId>`.");
    return lines.join("\n");
  }

  private async setLocation(telegramUserId: number, text: string): Promise<string> {
    const [, addressId] = text.split(/\s+/, 2);
    if (!addressId) return "Use `/location <addressId>`. Run `/addresses` to list address ids.";
    await this.store.updateUser(telegramUserId, { addressId, lastPlan: undefined });
    return `Delivery address set to ${addressId}.`;
  }

  private async renderCart(user: TelegramUserProfile): Promise<string> {
    if (!user.addressId) return "Set `/location <addressId>` first.";
    const res = await this.executor(user).foodCart(user.addressId);
    if (!res.ok) return `Could not fetch cart: ${res.error.code} ${res.error.message}`;
    return `Current cart:\n${JSON.stringify(res.data, null, 2).slice(0, 3500)}`;
  }
}

function parseFoodQuery(text: string): string | undefined {
  const normalized = text.trim();
  const match = normalized.match(/^(?:order|get|find|search|best|cheapest)\s+(.+)$/i);
  if (match?.[1]) return match[1].replace(/\b(please|for me)\b/gi, "").trim();
  if (normalized.length > 2 && !normalized.startsWith("/")) return normalized;
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
    "`order biryani` - find the best-value matching food item",
    "`/cart` - inspect cart",
    "`/cancel` - clear pending action",
    "",
    `Your isolated SWIGGY_HOME is ${user.swiggyHome}`,
  ].join("\n");
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
