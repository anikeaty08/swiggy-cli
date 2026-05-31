import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CliEnvelope, ServerName } from "../types/index.js";

const execFileAsync = promisify(execFile);

export interface SwiggyCliExecutorOptions {
  swiggyHome: string;
  profile?: string;
  command?: string;
}

export class SwiggyCliExecutor {
  private readonly swiggyHome: string;
  private readonly profile?: string;
  private readonly command?: string;

  constructor(opts: SwiggyCliExecutorOptions) {
    this.swiggyHome = opts.swiggyHome;
    this.profile = opts.profile;
    this.command = opts.command || process.env.SWIGGY_BOT_SWIGGY_COMMAND;
  }

  async authStatus(): Promise<CliEnvelope> {
    return this.run(["auth", "status"]);
  }

  async addresses(): Promise<CliEnvelope> {
    return this.run(["food", "addresses"]);
  }

  async foodCart(addressId: string): Promise<CliEnvelope> {
    return this.run(["food", "cart", "--address-id", addressId]);
  }

  async foodAddToCart(input: {
    restaurantId: string;
    addressId: string;
    itemId: string;
    restaurantName?: string;
    quantity?: number;
  }): Promise<CliEnvelope> {
    const args = [
      "food",
      "add-to-cart",
      "--restaurant-id",
      input.restaurantId,
      "--address-id",
      input.addressId,
      "--item-id",
      input.itemId,
      "--quantity",
      String(input.quantity ?? 1),
    ];
    if (input.restaurantName) args.push("--restaurant-name", input.restaurantName);
    return this.run(args);
  }

  async foodCoupons(): Promise<CliEnvelope> {
    return this.run(["food", "list-coupons"]);
  }

  async foodApplyCoupon(code: string): Promise<CliEnvelope> {
    return this.run(["food", "apply-coupon", code]);
  }

  async call(server: ServerName, tool: string, input: unknown): Promise<CliEnvelope> {
    return this.run(["call", server, tool, "--input", JSON.stringify(input)]);
  }

  authCommand(server = "food"): string {
    if (process.platform === "win32") {
      return `$env:SWIGGY_HOME="${this.swiggyHome}"; swiggy auth init --server ${server}`;
    }
    return `SWIGGY_HOME="${this.swiggyHome}" swiggy auth init --server ${server}`;
  }

  private async run(args: string[]): Promise<CliEnvelope> {
    const common = ["--json", "--no-interactive", "--quiet", "--yes"];
    if (this.profile) common.push("--profile", this.profile);
    const allArgs = [...args, ...common];
    const env = { ...process.env, SWIGGY_HOME: this.swiggyHome };
    const target = this.resolveCommand();
    const { stdout } = await execFileAsync(target.file, [...target.prefixArgs, ...allArgs], {
      env,
      maxBuffer: 1024 * 1024 * 10,
      windowsHide: true,
    }).catch((err: unknown) => {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      if (e.stdout) return { stdout: e.stdout };
      throw new Error(e.stderr || e.message || String(err));
    });
    return JSON.parse(stdout) as CliEnvelope;
  }

  private resolveCommand(): { file: string; prefixArgs: string[] } {
    if (this.command) return { file: this.command, prefixArgs: [] };
    const here = dirname(fileURLToPath(import.meta.url));
    const distCli = resolve(here, "..", "cli.js");
    if (existsSync(distCli)) return { file: process.execPath, prefixArgs: [distCli] };
    return { file: "swiggy", prefixArgs: [] };
  }
}
