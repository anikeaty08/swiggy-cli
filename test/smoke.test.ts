import { afterEach, describe, it, expect, vi } from "vitest";
import { TOOL_CATALOG, ERGONOMIC_ALIASES, DESTRUCTIVE_TOOLS } from "../src/lib/aliases.js";
import { EXIT_CODE, CliError } from "../src/lib/errors.js";
import { geocodeAddress } from "../src/lib/geocode.js";
import { renderJson } from "../src/lib/renderers/json.js";
import { renderToolHuman } from "../src/lib/renderers/toolHuman.js";
import { SCHEMA_FIXTURES } from "../src/lib/schema.js";

describe("aliases", () => {
  it("every alias points to a real tool in the catalog", () => {
    for (const [server, map] of Object.entries(ERGONOMIC_ALIASES)) {
      const valid = new Set(TOOL_CATALOG[server as keyof typeof TOOL_CATALOG]);
      for (const [verb, tool] of Object.entries(map)) {
        expect(valid.has(tool), `${server}.${verb} → ${tool}`).toBe(true);
      }
    }
  });

  it("destructive tools all exist in some catalog", () => {
    const all = new Set(Object.values(TOOL_CATALOG).flat());
    for (const t of DESTRUCTIVE_TOOLS) expect(all.has(t)).toBe(true);
  });

  it("expected counts match upstream reference (food=14, instamart=13, dineout=8)", () => {
    expect(TOOL_CATALOG.food.length).toBe(14);
    expect(TOOL_CATALOG.instamart.length).toBe(13);
    expect(TOOL_CATALOG.dineout.length).toBe(8);
  });

  it("every catalog tool has a cached schema fixture", () => {
    for (const [server, tools] of Object.entries(TOOL_CATALOG)) {
      const schemas = SCHEMA_FIXTURES[server as keyof typeof SCHEMA_FIXTURES];
      for (const tool of tools) {
        expect(schemas[tool], `${server}/${tool}`).toBeTruthy();
      }
    }
  });
});

describe("error contract", () => {
  it("every code has an exit mapping", () => {
    for (const code of Object.keys(EXIT_CODE)) {
      expect(typeof EXIT_CODE[code as keyof typeof EXIT_CODE]).toBe("number");
    }
  });

  it("CliError preserves code and details", () => {
    const e = new CliError("AUTH_REQUIRED", "x", { details: { a: 1 }, hint: "y" });
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e.details).toEqual({ a: 1 });
    expect(e.hint).toBe("y");
  });
});

describe("renderers", () => {
  it("renderJson writes a single line of valid JSON", () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string) => {
      chunks.push(s);
      return true;
    };
    try {
      renderJson({ ok: true, data: { hello: "world" } });
    } finally {
      (process.stdout.write as unknown) = orig;
    }
    expect(chunks.length).toBe(1);
    const line = chunks[0]!.trimEnd();
    expect(() => JSON.parse(line)).not.toThrow();
    const parsed = JSON.parse(line);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.hello).toBe("world");
  });

  it("tool human renderer formats addresses with address lines", () => {
    const output = captureStdout(() =>
      renderToolHuman(
        {
          addresses: [
            {
              id: "addr_1",
              addressLine: "Fixture address line",
              phoneNumber: "****2423",
              addressTag: "Home",
            },
          ],
        },
        { tool: "get_addresses", server: "food", quiet: true }
      )
    );

    expect(output).toContain("Addresses");
    expect(output).toContain("Fixture address line");
    expect(output).toContain("addr_1");
  });

  it("tool human renderer formats menu items without raw JSON blobs", () => {
    const output = captureStdout(() =>
      renderToolHuman(
        {
          categories: [
            {
              title: "Recommended",
              items: [{ id: "item_1", name: "Fixture menu item", price: 180, rating: "4.5" }],
            },
          ],
        },
        { tool: "get_restaurant_menu", server: "food", quiet: true }
      )
    );

    expect(output).toContain("Items");
    expect(output).toContain("Fixture menu item");
    expect(output).toContain("Rs 180");
  });

  it("tool human renderer formats Instamart display names", () => {
    const item = { spinId: "spin_1", displayName: "Sample grocery item", finalPrice: 64, brand: "Sample brand" };
    const output = captureStdout(() =>
      renderToolHuman(
        {
          items: [item],
        },
        { tool: "search_products", server: "instamart", quiet: true }
      )
    );

    expect(output).toContain("Items");
    expect(output).toContain(item.displayName);
    expect(output).toContain(`Rs ${item.finalPrice}`);
  });
});

describe("geocoding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("converts address search responses into coordinates", async () => {
    const geocoderResult = { lat: "12.9716", lon: "77.5946" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [geocoderResult],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress("sample address")).resolves.toEqual({
      latitude: Number(geocoderResult.lat),
      longitude: Number(geocoderResult.lon),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown) = (s: string) => {
    chunks.push(s);
    return true;
  };
  try {
    fn();
  } finally {
    (process.stdout.write as unknown) = orig;
  }
  return chunks.join("");
}
