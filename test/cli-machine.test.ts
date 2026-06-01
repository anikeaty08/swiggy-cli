import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distCli = join(repoRoot, "dist", "cli.js");
const sourceCli = join(repoRoot, "src", "cli.ts");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

const tempHomes: string[] = [];

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function cliArgs(args: string[]): string[] {
  if (existsSync(distCli)) return [distCli, ...args];
  return [tsxCli, sourceCli, ...args];
}

function runCli(args: string[]): CliResult {
  const swiggyHome = mkdtempSync(join(tmpdir(), "swiggy-cli-machine-"));
  tempHomes.push(swiggyHome);

  const result = spawnSync(process.execPath, cliArgs(args), {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      NO_COLOR: "1",
      SWIGGY_HOME: swiggyHome,
    },
  });

  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseSingleJsonEnvelope(stdout: string): unknown {
  expect(stdout.endsWith("\n")).toBe(true);
  const lines = stdout.trimEnd().split(/\r?\n/);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}

afterEach(() => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop()!;
    rmSync(home, { recursive: true, force: true });
  }
});

describe("CLI machine mode", () => {
  it("servers --json emits exactly one JSON success envelope on stdout", () => {
    const result = runCli(["servers", "--json", "--no-interactive"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const envelope = parseSingleJsonEnvelope(result.stdout);
    expect(envelope).toMatchObject({
      ok: true,
      meta: { profile: "default" },
    });
    expect(envelope).toHaveProperty("data");
    expect(Array.isArray((envelope as { data: unknown }).data)).toBe(true);
  });

  it("does not write banners or spinner text to stderr in machine mode", () => {
    const result = runCli(["servers", "--json", "--no-interactive"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("usage errors with --json emit a JSON error envelope and exit 2", () => {
    const result = runCli(["tools", "not-a-server", "--json", "--no-interactive"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");

    const envelope = parseSingleJsonEnvelope(result.stdout);
    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: "USAGE",
      },
    });
  });

  it("config path --json is an auth-free README example with a JSON envelope", () => {
    const result = runCli(["config", "path", "--json", "--no-interactive"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const envelope = parseSingleJsonEnvelope(result.stdout);
    expect(envelope).toMatchObject({
      ok: true,
      data: {
        configFile: expect.stringContaining("config.json"),
        authFile: expect.stringContaining("auth.json"),
      },
    });
  });

  it("--help stays auth-free and does not emit machine JSON", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("swiggy servers --json");
  });

  it("completion prints shell setup without network access", () => {
    const result = runCli(["completion", "bash"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("complete");
    expect(result.stdout).toContain("swiggy");
  });

  it("--dry-run validates mutation payloads without requiring auth", () => {
    const result = runCli([
      "food",
      "add-to-cart",
      "--restaurant-id",
      "rest_1",
      "--address-id",
      "addr_1",
      "--item-id",
      "item_1",
      "--quantity",
      "2",
      "--json",
      "--no-interactive",
      "--quiet",
      "--dry-run",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const envelope = parseSingleJsonEnvelope(result.stdout);
    expect(envelope).toMatchObject({
      ok: true,
      server: "food",
      tool: "update_food_cart",
      data: {
        dryRun: true,
        destructive: false,
        args: {
          restaurantId: "rest_1",
          addressId: "addr_1",
          cartItems: [{ itemId: "item_1", quantity: 2 }],
        },
      },
    });
  });
});
