import { Command } from "commander";
import { attachOutputOptions, resolveExecOpts } from "./common.js";
import { renderError, renderResult } from "../lib/output.js";
import { listProfiles, useProfile, createProfile, deleteProfile, setProfileValue } from "../lib/profiles.js";

export function buildProfileCommands(program: Command): void {
  const p = program.command("profile").description("Manage profiles (city, defaults, output mode)");

  attachOutputOptions(
    p.command("list").description("List profiles").action(async () => {
      const opts = await resolveExecOpts(p);
      try {
        const data = await listProfiles();
        const flat = Object.entries(data.profiles).map(([name, prof]) => ({
          name,
          current: name === data.current,
          defaultCity: prof.defaultCity ?? "",
          defaultServer: prof.defaultServer ?? "",
          output: prof.output ?? "human",
          noInteractive: Boolean(prof.noInteractive),
          activeEndpointEnvironment: prof.activeEndpointEnvironment ?? "",
        }));
        renderResult(flat, opts);
      } catch (err) {
        process.exitCode = renderError(err, opts);
      }
    })
  );

  attachOutputOptions(
    p.command("use <name>").description("Switch active profile").action(async (name: string) => {
      const opts = await resolveExecOpts(p);
      try {
        await useProfile(name);
        renderResult({ active: name }, opts);
      } catch (err) {
        process.exitCode = renderError(err, opts);
      }
    })
  );

  attachOutputOptions(
    p
      .command("create <name>")
      .description("Create a profile")
      .option("--city <city>", "default city")
      .option("--output <mode>", "default output mode (human|json|plain)", "human")
      .action(async (name: string, o: { city?: string; output?: "human" | "json" | "plain" }) => {
        const opts = await resolveExecOpts(p);
        try {
          await createProfile(name, { defaultCity: o.city, output: o.output });
          renderResult({ created: name }, opts);
        } catch (err) {
          process.exitCode = renderError(err, opts);
        }
      })
  );

  attachOutputOptions(
    p.command("delete <name>").description("Delete a profile").action(async (name: string) => {
      const opts = await resolveExecOpts(p);
      try {
        await deleteProfile(name);
        renderResult({ deleted: name }, opts);
      } catch (err) {
        process.exitCode = renderError(err, opts);
      }
    })
  );

  attachOutputOptions(
    p
      .command("set <name> <key> <value>")
      .description("Set a profile field (defaultCity, output, noInteractive, endpoints.food, defaultAddressIds.food)")
      .action(async (name: string, key: string, value: string) => {
        const opts = await resolveExecOpts(p);
        try {
          await setProfileValue(name, key, value);
          renderResult({ updated: { name, key, value } }, opts);
        } catch (err) {
          process.exitCode = renderError(err, opts);
        }
      })
  );
}
