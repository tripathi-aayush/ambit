import pc from "picocolors";
import { resolveOrLinkRepo } from "../repoContext";

export async function linkCommand(): Promise<void> {
  const repo = await resolveOrLinkRepo();
  console.log(`${pc.bold(repo.name)} ${pc.dim(`(${repo.clone_url})`)} — ${pc.green(repo.status)}`);
}
