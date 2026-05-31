import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/auth.js", () => ({
  getAccessToken: vi.fn(async () => undefined),
  getAuthLookupState: vi.fn(async () => ({
    authFile: "/tmp/auth.json",
    hasAuthFile: false,
    hasServerEntry: false,
    hasAccessToken: false,
    expiresAt: null,
  })),
}));

import { McpClient } from "../src/lib/mcp.js";
import { CliError } from "../src/lib/errors.js";

const profile = { endpoints: { food: "https://example.test/food" } };

describe("MCP transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles JSON-RPC success", async () => {
    mockFetch([
      json({ result: {} }, "s1"),
      json({ result: {} }),
      json({ result: { content: [{ type: "text", text: "{\"ok\":true}" }] } }),
    ]);
    const client = new McpClient({ server: "food", profile });
    await expect(client.callTool("search_restaurants", { query: "pizza" })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"ok\":true}" }],
    });
  });

  it("handles JSON-RPC error", async () => {
    mockFetch([json({ result: {} }), json({ result: {} }), json({ error: { code: -32000, message: "boom" } })]);
    const client = new McpClient({ server: "food", profile });
    await expect(client.callTool("search_restaurants", {})).rejects.toMatchObject({ code: "MCP_ERROR", message: "boom" });
  });

  it("handles SSE success", async () => {
    mockFetch([json({ result: {} }), json({ result: {} }), sse({ result: { tools: [{ name: "search_restaurants" }] } })]);
    const client = new McpClient({ server: "food", profile });
    await expect(client.listTools()).resolves.toEqual([{ name: "search_restaurants" }]);
  });

  it("rejects invalid JSON responses", async () => {
    mockFetch([text("{not-json")]);
    const client = new McpClient({ server: "food", profile });
    await expect(client.listTools()).rejects.toMatchObject({ code: "MCP_ERROR", message: "Invalid JSON-RPC response" });
  });

  it("rejects empty responses", async () => {
    mockFetch([text("")]);
    const client = new McpClient({ server: "food", profile });
    await expect(client.listTools()).rejects.toMatchObject({ code: "MCP_ERROR", message: "Empty response from server." });
  });

  it("maps 401 and 403 to auth errors", async () => {
    mockFetch([text("", 401)]);
    const client = new McpClient({ server: "food", profile });
    await expect(client.listTools()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("maps network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const client = new McpClient({ server: "food", profile });
    await expect(client.listTools()).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("scopes MCP sessions by endpoint", async () => {
    const fetchMock = mockFetch([
      json({ result: {} }, "session-a"),
      json({ result: {} }),
      json({ result: { tools: [] } }),
      json({ result: {} }, "session-b"),
      json({ result: {} }),
      json({ result: { tools: [] } }),
    ]);
    await new McpClient({ server: "food", profile: { endpoints: { food: "https://example.test/a" } } }).listTools();
    await new McpClient({ server: "food", profile: { endpoints: { food: "https://example.test/b" } } }).listTools();
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies.filter((b) => b.method === "initialize")).toHaveLength(2);
  });
});

function mockFetch(responses: Response[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const next = responses.shift();
    if (!next) throw new CliError("UNKNOWN", "unexpected fetch");
    return next;
  });
}

function json(body: unknown, sessionId?: string, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", ...body }), { status, headers });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function sse(body: unknown): Response {
  return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: "1", ...body })}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}
