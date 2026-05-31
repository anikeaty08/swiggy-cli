import { CliError } from "../lib/errors.js";
import type { TelegramUpdate } from "./types.js";

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(token: string) {
    if (!token) throw new CliError("USAGE", "Telegram bot token is required.", {
      hint: "Set TELEGRAM_BOT_TOKEN or pass --token",
    });
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getUpdates(offset?: number, timeout = 30): Promise<TelegramUpdate[]> {
    const url = new URL(`${this.baseUrl}/getUpdates`);
    url.searchParams.set("timeout", String(timeout));
    if (offset !== undefined) url.searchParams.set("offset", String(offset));
    const data = await this.request<{ result: TelegramUpdate[] }>(url);
    return data.result;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.request(new URL(`${this.baseUrl}/sendMessage`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
  }

  private async request<T = unknown>(url: URL, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => undefined)) as { ok?: boolean; description?: string } | undefined;
    if (!res.ok || body?.ok === false) {
      throw new CliError("NETWORK", body?.description || `Telegram API returned HTTP ${res.status}`);
    }
    return body as T;
  }
}
