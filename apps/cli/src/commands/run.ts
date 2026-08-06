import pc from "picocolors";
import { listPlans, runPlan } from "../client";
import { resolveOrLinkRepo } from "../repoContext";
import { watchPlan } from "./watch";

export async function runCommand(planIdArg: string | undefined, opts: { watch: boolean }): Promise<void> {
  let planId = planIdArg;
  if (!planId) {
    const repo = await resolveOrLinkRepo();
    const plans = await listPlans(repo.id);
    if (plans.length === 0) {
      console.error(pc.red("No plans for this repository yet. Run `orion plan \"<task>\"` first."));
      process.exitCode = 1;
      return;
    }
    planId = plans[0].id; // newest first, per GET /repos/{id}/plans
  }
  console.log(pc.dim(`Running ${planId}…`));
  const plan = await runPlan(planId);
  await watchPlan(plan, opts.watch);
}
