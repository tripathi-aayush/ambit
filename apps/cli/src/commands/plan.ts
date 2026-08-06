import pc from "picocolors";
import { createPlan, type Plan } from "../client";
import { colorRisk, actionLabel } from "../format";
import { resolveOrLinkRepo } from "../repoContext";

export function printPlanDag(plan: Plan): void {
  console.log(`${pc.bold(plan.task_description)}`);
  console.log(pc.dim(`branch ${plan.branch_name}`));
  console.log();
  for (const action of plan.actions) {
    const risk = action.risk_level ? `[${colorRisk(action.risk_level)}]` : "";
    console.log(`  ${pc.dim("•")} ${actionLabel(action)} ${risk}`.trimEnd());
  }
  console.log();
}

export async function planCommand(task: string): Promise<void> {
  const repo = await resolveOrLinkRepo();
  console.log(pc.dim("Planning…"));
  const plan = await createPlan(repo.id, task, { dryRun: true, adapter: "cli_wrapper" });
  printPlanDag(plan);
  console.log(pc.dim(`Nothing has executed yet. Run \`orion run ${plan.id}\` or \`orion implement\` to proceed.`));
}
