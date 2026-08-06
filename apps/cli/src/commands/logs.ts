// Non-follow mode: one-shot REST fetch of whatever already happened --
// simplest correct tool for "show me what's there and exit."
// Follow mode (Orion Phase 2): a genuine live tail via the same SSE
// stream `implement`/`run` use, not polling -- replaces the old 2s-poll
// loop entirely.

import pc from "picocolors";
import { getActionEvents, getPlan, listPlans, type ActionEvent } from "../client";
import { streamPlan } from "../stream";
import { actionLabel, describeEvent, timeAgo } from "../format";
import { resolveOrLinkRepo } from "../repoContext";
import type { ActionEventMessage } from "@orion/shared";

function printEvent(actionLabelText: string, event: ActionEvent): void {
  const desc = describeEvent(event);
  const when = timeAgo(event.created_at) ?? "";
  console.log(`${pc.dim(`[${when}]`)} ${pc.bold(actionLabelText)} ${event.event_type}${desc ? ` — ${desc}` : ""}`);
}

async function resolvePlanId(planIdArg: string | undefined): Promise<string | null> {
  if (planIdArg) return planIdArg;
  const repo = await resolveOrLinkRepo();
  const plans = await listPlans(repo.id);
  if (plans.length === 0) {
    console.error(pc.red("No plans for this repository yet."));
    process.exitCode = 1;
    return null;
  }
  return plans[0].id; // newest first, per GET /repos/{id}/plans
}

async function tailOnce(planId: string): Promise<void> {
  const plan = await getPlan(planId);
  for (const action of plan.actions) {
    const events = await getActionEvents(action.id);
    for (const event of events) printEvent(actionLabel(action), event);
  }
}

async function tailLive(planId: string): Promise<void> {
  for await (const message of streamPlan(planId)) {
    if (message.type === "action_event") {
      const { action, event } = message as ActionEventMessage;
      printEvent(actionLabel(action), event);
    } else if (message.type === "stream_end") {
      return;
    } else if (message.type === "error") {
      console.error(pc.red(message.detail));
      return;
    }
  }
}

export async function logsCommand(planIdArg: string | undefined, opts: { follow: boolean }): Promise<void> {
  const planId = await resolvePlanId(planIdArg);
  if (!planId) return;

  if (opts.follow) {
    await tailLive(planId);
  } else {
    await tailOnce(planId);
  }
}
