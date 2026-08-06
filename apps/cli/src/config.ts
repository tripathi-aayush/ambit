// Credential storage for `orion login`. Deliberately the same
// shared-secret model the web UI and backend already use (X-Orion-Key) --
// no new auth system, just a place to put it. Future work (per-user auth)
// replaces this file's contents, not its location.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OrionConfig {
  apiUrl: string;
  apiKey: string;
  // Base URL of the Control Room (the Next.js app), used only to print
  // "review this here" links -- the CLI never calls it, it's display only.
  webUrl?: string;
}

export function controlRoomUrl(config: OrionConfig): string {
  return config.webUrl ?? "http://localhost:3000";
}

const CONFIG_DIR = join(homedir(), ".config", "orion");
const CONFIG_PATH = join(CONFIG_DIR, "credentials.json");

export function loadConfig(): OrionConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (typeof raw.apiUrl !== "string" || typeof raw.apiKey !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveConfig(config: OrionConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  // 0o600: this file holds a bearer credential -- readable only by the
  // owning user, same posture as ssh keys / most other CLI credential
  // files (gh, aws, npm all do this).
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function configPath(): string {
  return CONFIG_PATH;
}
