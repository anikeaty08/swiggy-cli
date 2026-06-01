import type { Command } from "commander";
import prompts from "prompts";
import type { OutputOptions, ServerName } from "../types/index.js";
import { getCurrentProfile } from "../lib/config.js";
import { McpClient, extractToolPayload } from "../lib/mcp.js";
import { renderError, renderResult, startSpinner, brand } from "../lib/output.js";
import { readFile } from "node:fs/promises";
import { CliError } from "../lib/errors.js";
import { UsageError } from "../lib/errors.js";
import { confirm } from "../lib/confirm.js";
import { DESTRUCTIVE_TOOLS } from "../lib/aliases.js";
import { isMachineMode } from "../lib/tty.js";
import { validateToolInput } from "../lib/schema.js";
import { renderToolHuman } from "../lib/renderers/toolHuman.js";

export function attachOutputOptions(cmd: Command): Command {
  return cmd
    .option("--json", "emit machine-readable JSON envelope on stdout")
    .option("--plain", "emit TSV-style line-oriented output")
    .option("--raw", "emit raw MCP response payload as JSON")
    .option("--quiet", "suppress non-essential output")
    .option("--no-interactive", "disable prompts and spinners (machine mode)")
    .option("-y, --yes", "auto-confirm destructive actions")
    .option("--profile <name>", "use a named profile");
}

export interface ExecOpts extends OutputOptions {
  skipCachedValidation?: boolean;
}

export function readGlobalOpts(cmd: Command): ExecOpts {
  const o = cmd.optsWithGlobals<ExecOpts>();
  return {
    json: o.json,
    plain: o.plain,
    raw: o.raw,
    quiet: o.quiet,
    noInteractive: o.noInteractive,
    yes: o.yes,
    profile: o.profile,
  };
}

export async function resolveExecOpts(cmd: Command): Promise<ExecOpts> {
  const raw = readGlobalOpts(cmd);
  const { profile, name } = await getCurrentProfile(raw.profile);
  const explicitOutput = Boolean(raw.json || raw.plain || raw.raw);

  return {
    json: explicitOutput ? Boolean(raw.json) : profile.output === "json",
    plain: explicitOutput ? Boolean(raw.plain) : profile.output === "plain",
    raw: Boolean(raw.raw),
    quiet: Boolean(raw.quiet),
    noInteractive: Boolean(raw.noInteractive || profile.noInteractive),
    yes: Boolean(raw.yes),
    profile: raw.profile || name,
  };
}

export async function callTool(
  server: ServerName,
  tool: string,
  args: unknown,
  opts: ExecOpts,
  humanRenderer?: (data: unknown, ctx: ExecOpts & { server?: string; tool?: string }) => void
): Promise<void> {
  try {
    if (!opts.skipCachedValidation) {
      const validation = validateToolInput(server, tool, args);
      if (!validation.ok) {
        throw new UsageError(`Invalid arguments for ${server}/${tool}: ${validation.errors.join("; ")}`);
      }
    }
    const { profile, name: profileName } = await getCurrentProfile(opts.profile);
    const ctx = { ...opts, server, tool, profile: opts.profile || profileName };
    const sp = startSpinner(`${brand("swiggy", opts)} · calling ${server}/${tool}…`, opts);
    const client = new McpClient({ server, profile });
    if (DESTRUCTIVE_TOOLS.has(tool)) {
      sp?.stop();
      await renderDestructivePreview(server, tool, args, opts, client);
      await confirm(`Run destructive tool "${tool}" on ${server}`, opts);
    }
    let result;
    try {
      result = await client.callTool(tool, args);
    } finally {
      sp?.stop();
    }
    if (result.isError) {
      const message = extractMcpToolErrorMessage(result) ?? `Tool "${tool}" returned an error`;
      throw new CliError("MCP_ERROR", message, { details: result, hint: hintForToolError(server, tool, message) });
    }
    const payload = opts.raw ? result : extractToolPayload(result);
    renderResult(payload, ctx, (humanRenderer ?? renderToolHuman) as never);
  } catch (err) {
    const code = renderError(err, { ...opts, server, tool });
    process.exitCode = code;
  }
}

async function renderDestructivePreview(
  server: ServerName,
  tool: string,
  args: unknown,
  opts: ExecOpts,
  client: McpClient
): Promise<void> {
  if (isMachineMode(opts) || opts.quiet) return;
  process.stderr.write(`\nReview before ${server}/${tool}:\n`);
  try {
    if (server === "food" && (tool === "place_food_order" || tool === "flush_food_cart")) {
      const result = await client.callTool("get_food_cart", pickKeys(args, ["addressId", "restaurantName"]));
      renderToolHuman(extractToolPayload(result), { ...opts, server, tool: "get_food_cart" });
      return;
    }
    if (server === "instamart" && (tool === "checkout" || tool === "clear_cart")) {
      const result = await client.callTool("get_cart", {});
      renderToolHuman(extractToolPayload(result), { ...opts, server, tool: "get_cart" });
      return;
    }
    process.stderr.write(`${JSON.stringify(args, null, 2)}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Could not load current summary before confirmation: ${message}\n`);
  }
}

function pickKeys(source: unknown, keys: string[]): Record<string, unknown> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const record = source as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return out;
}

export function parseJsonInput(input: string, flagName = "--input"): unknown {
  try {
    return JSON.parse(input);
  } catch (err) {
    throw new UsageError(`${flagName} is not valid JSON: ${(err as Error).message}`);
  }
}

export async function parseJsonInputOrFile(input: string | undefined, inputFile: string | undefined): Promise<unknown> {
  if (inputFile) return parseJsonInput(await readFile(inputFile, "utf8"), "--input-file");
  if (input) return parseJsonInput(input);
  return {};
}

interface PromptAddressOptions {
  requiredBy: string;
}

export async function ensureAddressId(
  server: Extract<ServerName, "food" | "instamart">,
  opts: ExecOpts,
  currentAddressId: string | undefined,
  promptOpts: PromptAddressOptions
): Promise<string> {
  if (currentAddressId) return currentAddressId;
  const { profile } = await getCurrentProfile(opts.profile);
  const profileAddress = profile.defaultAddressIds?.[server];
  if (profileAddress) return profileAddress;
  if (isMachineMode(opts)) {
    throw new UsageError(
      `Missing address id for ${promptOpts.requiredBy}. Run: swiggy ${server} addresses, then retry with --address-id <id>.`,
      `Run: swiggy ${server} addresses, then pass --address-id <id>`
    );
  }
  const client = new McpClient({ server, profile });
  const result = await client.callTool("get_addresses", {});
  const payload = extractToolPayload(result);
  const addresses = extractAddresses(payload);
  if (addresses.length === 0) {
    throw new UsageError(
      `No saved addresses found for ${server}.`,
      "Add an address first (Swiggy app) or run with explicit --address-id"
    );
  }
  if (addresses.length === 1) return addresses[0]!.id;
  const response = await prompts({
    type: "select",
    name: "addressId",
    message: `Select delivery address for ${promptOpts.requiredBy}:`,
    choices: addresses.map((a) => ({ title: a.label, value: a.id })),
  });
  if (!response.addressId) {
    throw new UsageError("Address selection cancelled.", `Re-run and pass --address-id <id> if you prefer non-interactive`);
  }
  return response.addressId as string;
}

interface DineoutLocation {
  addressId?: string;
  latitude?: number;
  longitude?: number;
}

export async function ensureDineoutLocation(
  opts: ExecOpts,
  current: DineoutLocation,
  requiredBy: string
): Promise<DineoutLocation> {
  if (current.addressId || (current.latitude !== undefined && current.longitude !== undefined)) return current;
  if (isMachineMode(opts)) {
    throw new UsageError(
      `Missing location for ${requiredBy}.`,
      "Use --address \"full address\", --address-id <id> (from `swiggy dineout locations`), or --lat/--lng"
    );
  }
  const { profile } = await getCurrentProfile(opts.profile);
  const client = new McpClient({ server: "dineout", profile });
  const result = await client.callTool("get_saved_locations", {});
  const payload = extractToolPayload(result);
  const addresses = extractAddresses(payload);
  if (addresses.length === 0) {
    throw new UsageError("No saved locations found for dineout.", "Use --address \"full address\" or --lat/--lng");
  }
  const response = await prompts({
    type: "select",
    name: "addressId",
    message: `Select location for ${requiredBy}:`,
    choices: addresses.map((a) => ({ title: a.label, value: a.id })),
  });
  if (!response.addressId) {
    throw new UsageError("Location selection cancelled.", "Re-run with --address-id, --address, or --lat/--lng");
  }
  return { addressId: response.addressId as string };
}

function extractAddresses(payload: unknown): Array<{ id: string; label: string }> {
  const list = resolveAddressList(payload);
  if (!Array.isArray(list)) return [];
  const addresses: Array<{ id: string; label: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = firstString(record, ["address_id", "addressId", "id"]);
    if (!id) continue;
    const label =
      firstString(record, ["display_address", "address", "name", "label", "title"]) ??
      firstString(record, ["area", "city"]) ??
      id;
    addresses.push({ id, label });
  }
  return addresses;
}

function resolveAddressList(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.addresses)) return record.addresses as unknown[];
  const nestedData = record.data;
  if (nestedData && typeof nestedData === "object") {
    const nested = nestedData as Record<string, unknown>;
    if (Array.isArray(nested.addresses)) return nested.addresses as unknown[];
    if (nested.data && typeof nested.data === "object") {
      const deeper = nested.data as Record<string, unknown>;
      if (Array.isArray(deeper.addresses)) return deeper.addresses as unknown[];
      if (Array.isArray(deeper.locations)) return deeper.locations as unknown[];
    }
    if (Array.isArray(nested.locations)) return nested.locations as unknown[];
  }
  if (Array.isArray(record.locations)) return record.locations as unknown[];
  return undefined;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function extractMcpToolErrorMessage(result: { content?: Array<{ type?: string; text?: string }> }): string | undefined {
  const texts = (result.content ?? [])
    .filter((chunk) => chunk?.type === "text" && typeof chunk.text === "string")
    .map((chunk) => (chunk.text as string).trim())
    .filter((text) => text.length > 0);
  if (texts.length === 0) return undefined;
  const first = texts[0]!;
  try {
    const parsed = JSON.parse(first) as { error?: { message?: string }; message?: string };
    if (parsed?.error?.message && typeof parsed.error.message === "string") return parsed.error.message;
    if (parsed?.message && typeof parsed.message === "string") return parsed.message;
  } catch {
    // keep raw text
  }
  return first;
}

function hintForToolError(server: ServerName, tool: string, message: string): string | undefined {
  if (/address[_ ]?id is required/i.test(message)) {
    return `Run: swiggy ${server} addresses, then retry with --address-id <id>`;
  }
  if (/location is required/i.test(message) && server === "dineout") {
    return "Pass --address \"full address\", or run: swiggy dineout locations, then retry with --address-id <id>";
  }
  if (/required/i.test(message)) {
    return `Run: swiggy schema ${server} ${tool} --json to inspect required arguments`;
  }
  return undefined;
}
