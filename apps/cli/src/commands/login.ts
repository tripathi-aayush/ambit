import pc from "picocolors";
import { configPath, saveConfig } from "../config";
import { promptText } from "../prompt";

export async function loginCommand(opts: { apiUrl?: string; apiKey?: string; webUrl?: string }): Promise<void> {
  const apiUrlInput = opts.apiUrl ?? (await promptText("Orion API URL [http://localhost:8000]: "));
  const apiKey = opts.apiKey ?? (await promptText("Orion API key: "));
  if (!apiKey) {
    console.error(pc.red("An API key is required — this must match ORION_API_KEY on the server."));
    process.exitCode = 1;
    return;
  }
  const webUrlInput = opts.webUrl ?? (await promptText("Control Room URL [http://localhost:3000]: "));
  saveConfig({
    apiUrl: apiUrlInput || "http://localhost:8000",
    apiKey,
    webUrl: webUrlInput || "http://localhost:3000",
  });
  console.log(pc.green(`✓ Saved to ${configPath()}`));
}
