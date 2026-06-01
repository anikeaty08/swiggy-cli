import { Command } from "commander";
import { attachOutputOptions, resolveExecOpts } from "./common.js";
import { renderError, renderResult } from "../lib/output.js";
import { loadAuth, evaluateAuthHealth } from "../lib/auth.js";
import { SERVER_NAMES } from "../types/index.js";
import { renderFoodCartSummary, renderPaymentSummary } from "../agent/cartSummary.js";
import { renderToolHuman } from "../lib/renderers/toolHuman.js";

export function buildSmokeCommand(program: Command): void {
  attachOutputOptions(
    program
      .command("smoke")
      .description("Run non-mutating local smoke checks for auth, renderers, and bot-facing summaries")
      .action(async () => {
        const opts = await resolveExecOpts(program);
        try {
          const auth = await loadAuth();
          const servers = SERVER_NAMES.map((server) => {
            const health = evaluateAuthHealth(auth.servers[server]);
            return { server, authenticated: health.authenticated, reason: health.reason };
          });
          const renderSamples = capture(() => {
            renderToolHuman(
              { items: [{ spinId: "sample_spin", displayName: "Sample product", finalPrice: 99, brand: "Sample brand" }] },
              { ...opts, server: "instamart", tool: "search_products", quiet: true }
            );
            renderToolHuman(
              { restaurants: [{ id: "sample_restaurant", name: "Sample restaurant", avgRating: 4.2, areaName: "Sample area" }] },
              { ...opts, server: "dineout", tool: "search_restaurants_dineout", quiet: true }
            );
            process.stdout.write(renderFoodCartSummary({ items: [{ name: "Sample item", quantity: 2, price: 50 }], paymentAmount: 100 }) + "\n");
            process.stdout.write(renderPaymentSummary({ availablePaymentMethods: ["Cash on Delivery"] }) + "\n");
          });
          renderResult({ authFilePresent: Object.keys(auth.servers).length > 0, servers, renderSamples }, opts);
        } catch (err) {
          process.exitCode = renderError(err, opts);
        }
      })
  );
}

function capture(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown) = (chunk: string) => {
    chunks.push(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    (process.stdout.write as unknown) = original;
  }
  return chunks.join("");
}
