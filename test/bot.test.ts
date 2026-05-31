import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TelegramBotStore } from "../src/bot/store.js";
import { deepFindArray, firstNumber, firstString, formatMoney } from "../src/agent/jsonHeuristics.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("Telegram bot state", () => {
  it("isolates each Telegram user in a separate SWIGGY_HOME", async () => {
    const dir = mkdtempSync(join(tmpdir(), "swiggy-bot-test-"));
    tempDirs.push(dir);
    const store = new TelegramBotStore(dir);

    const first = await store.getUser(101);
    const second = await store.getUser(202);
    await store.updateUser(101, { addressId: "addr_1" });

    expect(first.swiggyHome).toContain(join("users", "101"));
    expect(second.swiggyHome).toContain(join("users", "202"));
    expect((await store.getUser(101)).addressId).toBe("addr_1");
    expect((await store.getUser(202)).addressId).toBeUndefined();
  });
});

describe("agent JSON heuristics", () => {
  it("finds nested arrays and normalizes common values", () => {
    const payload = {
      data: {
        cards: [
          {
            itemName: "Biryani",
            price: "24900",
            restaurantName: "Test Kitchen",
          },
        ],
      },
    };
    const list = deepFindArray(payload, ["cards"]);
    expect(list).toHaveLength(1);
    const row = list![0] as Record<string, unknown>;
    expect(firstString(row, ["itemName"])).toBe("Biryani");
    expect(firstNumber(row, ["price"])).toBe(24900);
    expect(formatMoney(249)).toBe("Rs 249");
  });
});
