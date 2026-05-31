import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalSwiggyHome = process.env.SWIGGY_HOME;
const tempHomes: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalSwiggyHome === undefined) {
    delete process.env.SWIGGY_HOME;
  } else {
    process.env.SWIGGY_HOME = originalSwiggyHome;
  }
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("auth token refresh", () => {
  it("refreshes an expired access token and persists the refreshed credentials", async () => {
    const { authFile } = await seedAuth({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      expiresAt: Date.now() - 1_000,
      tokenType: "Bearer",
      scope: "mcp",
      clientId: "client-1",
      clientSecret: "secret-1",
      tokenEndpoint: "https://auth.example.test/token",
    });
    const fetchMock = mockFetch(
      new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "refresh-2",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { getAccessToken } = await import("../src/lib/auth.js");
    const token = await getAccessToken("food");

    expect(token).toBe("fresh-access");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://auth.example.test/token");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    });
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("secret-1");

    const saved = JSON.parse(await readFile(authFile, "utf8"));
    expect(saved.servers.food).toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "refresh-2",
      tokenType: "Bearer",
      scope: "mcp",
      clientId: "client-1",
      clientSecret: "secret-1",
      tokenEndpoint: "https://auth.example.test/token",
    });
    expect(saved.servers.food.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it("keeps the existing refresh token when refresh response omits one", async () => {
    const { authFile } = await seedAuth({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      expiresAt: Date.now() - 1_000,
      tokenType: "Bearer",
      clientId: "client-1",
      tokenEndpoint: "https://auth.example.test/token",
    });
    mockFetch(
      new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const { getAccessToken } = await import("../src/lib/auth.js");
    await expect(getAccessToken("food")).resolves.toBe("fresh-access");

    const saved = JSON.parse(await readFile(authFile, "utf8"));
    expect(saved.servers.food.refreshToken).toBe("refresh-1");
  });

  it("throws AUTH_FAILED when refreshing an expired token fails", async () => {
    const { authFile } = await seedAuth({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      expiresAt: Date.now() - 1_000,
      tokenType: "Bearer",
      clientId: "client-1",
      tokenEndpoint: "https://auth.example.test/token",
    });
    mockFetch(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));

    const { getAccessToken } = await import("../src/lib/auth.js");
    await expect(getAccessToken("food")).rejects.toMatchObject({
      code: "AUTH_FAILED",
      details: { reason: "Refresh failed: 400" },
    });

    const saved = JSON.parse(await readFile(authFile, "utf8"));
    expect(saved.servers.food.accessToken).toBe("expired-access");
  });
});

async function seedAuth(foodEntry: Record<string, unknown>): Promise<{ authFile: string }> {
  vi.resetModules();
  const home = await mkdtemp(join(tmpdir(), "swiggy-auth-test-"));
  tempHomes.push(home);
  process.env.SWIGGY_HOME = home;
  const authFile = join(home, "auth.json");
  await writeFile(authFile, JSON.stringify({ servers: { food: foodEntry } }, null, 2));
  return { authFile };
}

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}
