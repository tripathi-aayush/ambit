import pc from "picocolors";
import { createPlan } from "../client";
import { resolveOrLinkRepo } from "../repoContext";
import { watchPlan } from "./watch";

export async function implementCommand(task: string, opts: { watch: boolean }): Promise<void> {
  const repo = await resolveOrLinkRepo();
  console.log(pc.dim("Planning and running ready steps…"));
  // This call itself already executes every ready (non-approval-blocked)
  // action before returning -- there's no live progress to show during
  // this first burst without SSE (deliberately deferred, see the approved
  // plan). What we CAN show is what happened once it lands.
  const plan = await createPlan(repo.id, task, { dryRun: false, adapter: "cli_wrapper" });
  await watchPlan(plan, opts.watch);
}
