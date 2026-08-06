// v1 is deliberately not a live character-stream -- ActionEvent rows are
// coarse-grained today (execution_started, then one terminal completed/
// failed event; see the approved plan's note on incremental shell_exec
// streaming being separate, scoped follow-up work). `-f` polls for new
// *events* and prints them promptly, which is honest about what's
// actually available rather than faking a finer-grained stream.

import pc from "picocolors";
import { getActionEvents, getPlan, listPlans, type ActionEvent } from "../client";
import { actionLabel, describeEvent, timeAgo } from "../format";
import { resolveOrLinkRepo } from "../repoContext";

const POLL_INTERVAL_MS = 2000;

function printEvent(actionLabelText: string, event: ActionEvent, seen: Set<string>): void {
  if (seen.has(event.id)) return;
  seen.add(event.id);
  const desc = describeEvent(event);
  const when = timeAgo(event.created_at) ?? "";
  console.log(`${pc.dim(`[${when}]`)} ${pc.bold(actionLabelText)} ${event.event_type}${desc ? ` — ${desc}` : ""}`);
}

export async function logsCommand(planIdArg: string | undefined, opts: { follow: boolean }): Promise<void> {
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

  const seen = new Set<string>();
  const isTerminal = (status: string) => status === "completed" || status === "failed" || status === "denied";

  while (true) {
    const plan = await getPlan(planId);
    for (const action of plan.actions) {
      const events = await getActionEvents(action.id);
      for (const event of events) printEvent(actionLabel(action), event, seen);
    }
    const allDone = plan.actions.every((a) => isTerminal(a.status) || a.status === "pending");
    if (!opts.follow || allDone) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
