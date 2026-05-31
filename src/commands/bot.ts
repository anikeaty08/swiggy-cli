import { Command } from "commander";
import { attachOutputOptions, resolveExecOpts } from "./common.js";
import { renderError, renderResult } from "../lib/output.js";
import { SwiggyTelegramBot } from "../bot/controller.js";

export function buildBotCommands(program: Command): void {
  const bot = program.command("bot").description("Run Swiggy agent transports");

  attachOutputOptions(
    bot
      .command("telegram")
      .description("Run the Telegram Swiggy ordering agent")
      .option("--token <token>", "Telegram bot token (default: TELEGRAM_BOT_TOKEN)")
      .option("--data-dir <path>", "bot state directory (default: SWIGGY_BOT_HOME or ~/.swiggy/telegram-bot)")
      .option("--swiggy-command <path>", "swiggy executable to use for per-user CLI calls")
      .option("--once", "process one getUpdates batch and exit")
      .action(
        async (o: { token?: string; dataDir?: string; swiggyCommand?: string; once?: boolean }) => {
          const opts = await resolveExecOpts(bot);
          try {
            const runner = new SwiggyTelegramBot({
              token: o.token || process.env.TELEGRAM_BOT_TOKEN || "",
              dataDir: o.dataDir,
              swiggyCommand: o.swiggyCommand,
            });
            if (o.once) {
              await runner.start({ once: true });
              renderResult({ processed: "once" }, opts);
              return;
            }
            if (!opts.quiet) process.stderr.write("Telegram bot polling started. Press Ctrl+C to stop.\n");
            await runner.start();
          } catch (err) {
            process.exitCode = renderError(err, opts);
          }
        }
      )
  );
}
