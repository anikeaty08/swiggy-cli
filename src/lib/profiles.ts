import { loadConfig, saveConfig } from "./config.js";
import type { ProfileConfig, ServerName } from "../types/index.js";
import { CliError } from "./errors.js";

export async function listProfiles(): Promise<{ current: string; profiles: Record<string, ProfileConfig> }> {
  const cfg = await loadConfig();
  return { current: cfg.currentProfile, profiles: cfg.profiles };
}

export async function useProfile(name: string): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.profiles[name]) {
    throw new CliError("CONFIG_ERROR", `Profile "${name}" does not exist.`, {
      hint: `Create it: swiggy profile create ${name}`,
    });
  }
  cfg.currentProfile = name;
  await saveConfig(cfg);
}

export async function createProfile(name: string, profile: ProfileConfig = {}): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.profiles[name]) {
    throw new CliError("CONFIG_ERROR", `Profile "${name}" already exists.`);
  }
  cfg.profiles[name] = { output: "human", ...profile };
  await saveConfig(cfg);
}

export async function deleteProfile(name: string): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.profiles[name]) {
    throw new CliError("CONFIG_ERROR", `Profile "${name}" does not exist.`);
  }
  if (name === "default") {
    throw new CliError("CONFIG_ERROR", `Cannot delete the "default" profile.`);
  }
  delete cfg.profiles[name];
  if (cfg.currentProfile === name) cfg.currentProfile = "default";
  await saveConfig(cfg);
}

export async function setProfileField<K extends keyof ProfileConfig>(
  name: string,
  key: K,
  value: ProfileConfig[K]
): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.profiles[name]) throw new CliError("CONFIG_ERROR", `Profile "${name}" does not exist.`);
  cfg.profiles[name][key] = value;
  await saveConfig(cfg);
}

export async function setProfileValue(name: string, key: string, value: string): Promise<void> {
  const cfg = await loadConfig();
  const profile = cfg.profiles[name];
  if (!profile) throw new CliError("CONFIG_ERROR", `Profile "${name}" does not exist.`);

  if (key === "noInteractive") {
    profile.noInteractive = parseBoolean(value);
  } else if (key === "output") {
    if (!["human", "json", "plain"].includes(value)) throw new CliError("CONFIG_ERROR", "output must be human, json, or plain.");
    profile.output = value as ProfileConfig["output"];
  } else if (key === "defaultServer") {
    profile.defaultServer = parseServer(value);
  } else if (key.startsWith("defaultAddressIds.")) {
    const server = parseServer(key.slice("defaultAddressIds.".length));
    profile.defaultAddressIds = { ...profile.defaultAddressIds, [server]: value };
  } else if (key.startsWith("endpoints.")) {
    const server = parseServer(key.slice("endpoints.".length));
    profile.endpoints = { ...profile.endpoints, [server]: value };
  } else if (key.startsWith("endpointEnvironments.")) {
    const [, envName, serverName] = key.split(".");
    if (!envName || !serverName) {
      throw new CliError("CONFIG_ERROR", "Use endpointEnvironments.<name>.<server>.");
    }
    const server = parseServer(serverName);
    profile.endpointEnvironments = {
      ...profile.endpointEnvironments,
      [envName]: { ...profile.endpointEnvironments?.[envName], [server]: value },
    };
  } else if (key === "activeEndpointEnvironment") {
    profile.activeEndpointEnvironment = value;
  } else if (key === "defaultCity") {
    profile.defaultCity = value;
  } else {
    throw new CliError("CONFIG_ERROR", `Unsupported profile key "${key}".`);
  }
  await saveConfig(cfg);
}

function parseServer(value: string): ServerName {
  if (value === "food" || value === "instamart" || value === "dineout") return value;
  throw new CliError("CONFIG_ERROR", `Invalid server "${value}".`);
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliError("CONFIG_ERROR", "Boolean profile fields must be true or false.");
}
