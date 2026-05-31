import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TelegramUserProfile } from "./types.js";

interface StoreFile {
  users: Record<string, TelegramUserProfile>;
}

export class TelegramBotStore {
  readonly dataDir: string;
  readonly file: string;

  constructor(dataDir = process.env.SWIGGY_BOT_HOME || join(homedir(), ".swiggy", "telegram-bot")) {
    this.dataDir = dataDir;
    this.file = join(dataDir, "users.json");
  }

  async getUser(telegramUserId: number): Promise<TelegramUserProfile> {
    const state = await this.load();
    const key = String(telegramUserId);
    const now = new Date().toISOString();
    const existing = state.users[key];
    if (existing) return existing;
    const created: TelegramUserProfile = {
      telegramUserId,
      swiggyHome: join(this.dataDir, "users", key),
      createdAt: now,
      updatedAt: now,
    };
    state.users[key] = created;
    await this.save(state);
    return created;
  }

  async updateUser(
    telegramUserId: number,
    patch: Partial<Omit<TelegramUserProfile, "telegramUserId" | "createdAt">>
  ): Promise<TelegramUserProfile> {
    const state = await this.load();
    const current = await this.getUser(telegramUserId);
    const updated: TelegramUserProfile = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    state.users[String(telegramUserId)] = updated;
    await this.save(state);
    return updated;
  }

  private async load(): Promise<StoreFile> {
    if (!existsSync(this.file)) return { users: {} };
    return JSON.parse(await readFile(this.file, "utf8")) as StoreFile;
  }

  private async save(state: StoreFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(join(this.dataDir, "users"), { recursive: true });
    await writeFile(this.file, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}
