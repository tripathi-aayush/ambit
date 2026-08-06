import { randomUUID } from "node:crypto";
import { createPlan } from "../client";
import { resolveOrLinkRepo } from "../repoContext";
import { startWatching } from "./watch";

export async function implementCommand(task: string, opts: { watch: boolean }): Promise<void> {
  const repo = await resolveOrLinkRepo();
  // Client-generated id: lets us open the live stream for this plan
  // BEFORE the plan even exists server-side, so nothing that happens
  // during generation/execution is missed (see startWatching/stream.ts).
  const planId = randomUUID();
  await startWatching(
    planId,
    async () => {
      await createPlan(repo.id, task, { id: planId, dryRun: false, adapter: "cli_wrapper" });
    },
    opts
  );
}
