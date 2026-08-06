// Shared by `orion implement` and `orion run`: once a plan has been
// submitted for execution, this either prints the current state and
// returns (--no-watch) or polls until the plan reaches a terminal state,
// printing the approval interrupt and its resolution along the way.
//
// No SSE yet (see the approved plan doc) -- polling every 2s is a
// deliberate v1 simplification, not an oversight. A plan resolves in at
// most a couple of round-trips in practice (submit, maybe one approval
// wait), so the UX cost of polling vs. streaming is small at this stage.

import pc from "picocolors";
import { getActionEvents, getPlan, type Action, type Plan } from "../client";
import { loadConfig, controlRoomUrl } from "../config";
import { actionLabel, colorRisk, riskReasons, policyReasons } from "../format";

const POLL_INTERVAL_MS = 2000;

function findBlocking(plan: Plan): Action | null {
  return plan.actions.find((a) => a.status === "pending") ?? null;
}

function isResolved(plan: Plan): boolean {
  return plan.actions.every((a) => a.status === "completed" || a.status === "failed" || a.status === "denied");
}

async function printInterrupt(action: Action): Promise<void> {
  const events = await getActionEvents(action.id);
  const config = loadConfig();
  console.log();
  console.log(`${pc.yellow("⏸")}  ${pc.bold("Awaiting approval")} — ${actionLabel(action)} ${pc.dim(`[${colorRisk(action.risk_level)}]`)}`);
  for (const reason of riskReasons(events)) console.log(`   ${pc.dim("why flagged —")} ${reason}`);
  for (const reason of policyReasons(events)) console.log(`   ${pc.dim("policy —")} ${reason}`);
  if (config) {
    console.log(`   ${pc.dim("review —")} ${controlRoomUrl(config)}/approvals`);
  }
  console.log();
}

function printSummary(plan: Plan): void {
  console.log();
  for (const action of plan.actions) {
    const icon = action.status === "completed" ? pc.green("✓") : action.status === "denied" ? pc.red("✗") : action.status === "failed" ? pc.red("✗") : pc.dim("·");
    console.log(`  ${icon} ${actionLabel(action)} — ${action.status}`);
  }
  if (plan.pr_url) {
    console.log();
    console.log(`${pc.green("✓")} PR opened → ${pc.bold(plan.pr_url)}`);
  } else if (plan.error) {
    console.log();
    console.log(`${pc.red("✗")} ${plan.error}`);
  }
  console.log();
}

export async function watchPlan(initial: Plan, watch: boolean): Promise<void> {
  let plan = initial;
  let announcedBlock: string | null = null;

  while (!isResolved(plan)) {
    const blocking = findBlocking(plan);
    if (blocking && blocking.id !== announcedBlock) {
      await printInterrupt(blocking);
      announcedBlock = blocking.id;
    }
    if (!watch) {
      if (!blocking) printSummary(plan); // nothing to wait on, show current state as-is
      else console.log(pc.dim(`Not watching — check back with \`orion status\` or \`orion run ${plan.id}\`.`));
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    plan = await getPlan(plan.id);
  }

  printSummary(plan);
}
