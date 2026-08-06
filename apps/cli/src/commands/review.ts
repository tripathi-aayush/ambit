// Terminal port of apps/web/src/components/DiffView.tsx's exact logic:
// a completed action has both previous_content (captured by the executor
// right before overwriting) and content, so a real diff is possible; a
// still-pending action only has the proposed content -- shown plainly,
// no false diff coloring implying we know what it's replacing.

import { diffLines } from "diff";
import pc from "picocolors";
import { getActionEvents, getPlan, listPlans, type Action } from "../client";
import { actionLabel, colorRisk, riskReasons, policyReasons } from "../format";
import { resolveOrLinkRepo } from "../repoContext";

function printDiff(action: Action): void {
  const meta = action.action_metadata;
  const previous = meta.previous_content;
  const current = action.action_type === "file_write" ? meta.content : "";

  if (typeof previous === "string") {
    const parts = diffLines(previous, (current as string) ?? "");
    for (const part of parts) {
      const lines = part.value.split("\n").filter((_, i, arr) => i < arr.length - 1);
      for (const line of lines) {
        if (part.added) console.log(pc.green(`  + ${line}`));
        else if (part.removed) console.log(pc.red(`  - ${line}`));
        else console.log(pc.dim(`    ${line}`));
      }
    }
    return;
  }
  if (action.action_type === "file_write" && typeof current === "string") {
    console.log(pc.dim("  proposed content — not yet compared against the live file:"));
    for (const line of current.split("\n")) console.log(`    ${line}`);
    return;
  }
  if (action.action_type === "file_delete") {
    console.log(pc.dim(`  will delete: ${action.target}`));
    return;
  }
  console.log(pc.dim("  no diffable content for this action type"));
}

export async function reviewCommand(planIdArg: string | undefined): Promise<void> {
  let planId = planIdArg;
  if (!planId) {
    const repo = await resolveOrLinkRepo();
    const plans = await listPlans(repo.id);
    if (plans.length === 0) {
      console.error(pc.red("No plans for this repository yet."));
      process.exitCode = 1;
      return;
    }
    planId = plans[0].id;
  }
  const plan = await getPlan(planId);

  console.log(`${pc.bold(plan.task_description)} ${pc.dim(plan.id)}`);
  for (const action of plan.actions) {
    console.log();
    console.log(`${actionLabel(action)} ${pc.dim(`[${colorRisk(action.risk_level)}]`)} — ${action.status}`);
    const events = await getActionEvents(action.id);
    for (const reason of riskReasons(events)) console.log(pc.dim(`  why flagged — ${reason}`));
    for (const reason of policyReasons(events)) console.log(pc.dim(`  policy — ${reason}`));
    if (action.action_type === "file_write" || action.action_type === "file_delete") {
      printDiff(action);
    }
  }
}
