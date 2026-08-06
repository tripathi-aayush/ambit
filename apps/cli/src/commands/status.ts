import pc from "picocolors";
import { listAllActions, listPlans } from "../client";
import { colorStatus, timeAgo } from "../format";
import { resolveOrLinkRepo } from "../repoContext";

export async function statusCommand(opts: { all: boolean }): Promise<void> {
  const actions = await listAllActions();
  const pending = actions.filter((a) => a.status === "pending").length;
  const executing = actions.filter((a) => a.status === "executing").length;
  const denied = actions.filter((a) => a.status === "denied").length;

  console.log(`${pc.bold("pending")} ${pending}   ${pc.bold("executing")} ${executing}   ${pc.bold("denied")} ${denied}`);
  console.log();

  if (opts.all) {
    console.log(pc.dim(`${actions.length} actions across all repositories.`));
    return;
  }

  const repo = await resolveOrLinkRepo();
  const plans = await listPlans(repo.id);
  if (plans.length === 0) {
    console.log(pc.dim("No plans yet for this repository."));
    return;
  }
  console.log(pc.bold(repo.name));
  for (const plan of plans.slice(0, 10)) {
    console.log(`  ${colorStatus(plan.status)}  ${plan.task_description}  ${pc.dim(timeAgo(plan.created_at) ?? "")}`);
  }
}
