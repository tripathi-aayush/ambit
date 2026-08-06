// Orion Phase 2 (live runtime): renders a plan's live event stream --
// replaces the old 2s-poll loop entirely. Reused by implement/run, and
// by anything else that wants "start something, watch it happen."
//
// The caller is responsible for the subscribe-before-POST ordering (see
// startWatching below) -- this module just consumes whatever arrives.

import pc from "picocolors";
import { streamPlan } from "../stream";
import { loadConfig, controlRoomUrl } from "../config";
import {
  actionLabel,
  colorRisk,
  riskReasons,
  policyReasons,
  executionOutcome,
} from "../format";
import { Spinner, icons, indent } from "../progress";
import type {
  ActionEventMessage,
  PlanSnapshotMessage,
  PlanStreamMessage,
  StreamActionEnvelope,
} from "@orion/shared";

interface TrackedAction {
  index: number;
  envelope: StreamActionEnvelope;
  riskReasons: string[];
  policyReasons: string[];
}

/** Opens the stream for `planId`, kicks off the connection, then invokes
 * `fireRequest` -- the stream's underlying fetch is dispatched (a plain
 * generator's body starts running on the first .next() call) before we
 * wait on anything, so it's already connecting/replaying by the time the
 * POST that actually creates or runs the plan goes out. Firing them in
 * the other order would leave a real gap where an early event could be
 * missed entirely. */
export async function startWatching(
  planId: string,
  fireRequest: () => Promise<void>,
  opts: { watch: boolean }
): Promise<void> {
  const stream = streamPlan(planId);
  const first = stream.next();

  try {
    await fireRequest();
  } catch (err) {
    // Still drain what the stream already has -- the request failing
    // doesn't mean nothing happened server-side before it did.
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
  }

  if (!opts.watch) {
    console.log(pc.dim("Not watching — check `orion status` / `orion logs` for progress."));
    // Close the connection we opened above but never finished reading --
    // otherwise the still-open SSE stream (server keeps it alive with
    // heartbeats until the plan resolves) keeps this process running long
    // after this function returns. See stream.ts's reader.cancel() note.
    await stream.return(undefined);
    return;
  }

  await renderStream(stream, first);
}

async function renderStream(
  stream: AsyncGenerator<PlanStreamMessage>,
  first: Promise<IteratorResult<PlanStreamMessage>>
): Promise<void> {
  const tracked = new Map<string, TrackedAction>();
  let spinner: Spinner | null = null;
  let planningSpinner: Spinner | null = new Spinner("Planning…").start();

  const track = (envelope: StreamActionEnvelope): TrackedAction => {
    let t = tracked.get(envelope.id);
    if (!t) {
      t = { index: tracked.size + 1, envelope, riskReasons: [], policyReasons: [] };
      tracked.set(envelope.id, t);
    } else {
      t.envelope = envelope;
    }
    return t;
  };

  const handle = (message: PlanStreamMessage): void => {
    switch (message.type) {
      case "plan_snapshot": {
        const snapshot = message as PlanSnapshotMessage;
        if (planningSpinner) planningSpinner.update(`Planning "${snapshot.task_description}"…`);
        break;
      }
      case "action_event": {
        const { action, event } = message as ActionEventMessage;
        const t = track(action);

        switch (event.event_type) {
          case "action_created":
            if (planningSpinner) {
              planningSpinner.stop();
              planningSpinner = null;
              console.log(pc.dim("Executing…") + "\n");
            }
            break;
          case "risk_scored":
            t.riskReasons = riskReasons([event]);
            break;
          case "policy_evaluated":
            t.policyReasons = policyReasons([event]);
            break;
          case "approval_requested": {
            if (spinner) spinner.stop();
            const config = loadConfig();
            console.log();
            console.log(
              `${icons.pause}  ${pc.bold("Waiting for approval")} — ${actionLabel(action)} ${pc.dim(`[${colorRisk(action.risk_level)}]`)}`
            );
            for (const reason of t.riskReasons) console.log(indent(pc.dim(`why flagged — ${reason}`)));
            for (const reason of t.policyReasons) console.log(indent(pc.dim(`policy — ${reason}`)));
            if (config) {
              console.log();
              console.log(indent(`Open:`));
              console.log(indent(`${pc.underline(`${controlRoomUrl(config)}/approvals`)}`, 1));
            }
            console.log();
            console.log(pc.dim("Watching…"));
            break;
          }
          case "approval_decided": {
            const decision = event.payload.decision as string;
            const approver = event.payload.approver as string;
            console.log();
            console.log(
              decision === "approved"
                ? `${icons.ok} Approved by ${pc.bold(approver)}`
                : `${icons.fail} Denied by ${pc.bold(approver)}`
            );
            if (decision === "approved") console.log(pc.dim("\nResuming…\n"));
            break;
          }
          case "execution_started":
            spinner = new Spinner(`[${t.index}] ${actionLabel(action)}`).start();
            break;
          case "shell_output": {
            const line = event.payload.line as string;
            if (spinner) {
              spinner.stop();
              spinner = null;
            }
            console.log(indent(pc.dim(line), 2));
            break;
          }
          case "execution_completed": {
            if (spinner) {
              spinner.stop();
              spinner = null;
            }
            const outcome = executionOutcome([event]);
            let detail = "";
            if (outcome?.prUrl) detail = ` — PR opened`;
            else if (outcome?.commitSha) detail = ` — commit ${outcome.commitSha.slice(0, 7)}`;
            else if (outcome?.wroteBytes != null) detail = ` — wrote ${outcome.wroteBytes} bytes`;
            else if (outcome?.note) detail = ` — ${outcome.note}`;
            console.log(`${icons.ok} [${t.index}] ${actionLabel(action)}${pc.dim(detail)}`);
            if (outcome?.prUrl) {
              console.log();
              console.log(`${icons.ok} Pull Request created → ${pc.bold(outcome.prUrl)}`);
            }
            break;
          }
          case "execution_failed": {
            if (spinner) {
              spinner.stop();
              spinner = null;
            }
            console.log(`${icons.fail} [${t.index}] ${actionLabel(action)}`);
            console.log(indent(pc.red(String(event.payload.error ?? "execution failed"))));
            break;
          }
        }
        break;
      }
      case "stream_end":
        if (spinner) spinner.stop();
        if (planningSpinner) planningSpinner.stop();
        console.log();
        console.log(pc.dim(`${tracked.size} action${tracked.size === 1 ? "" : "s"} total.`));
        break;
      case "error":
        if (spinner) spinner.stop();
        if (planningSpinner) planningSpinner.stop();
        console.error(pc.red((message as { detail: string }).detail));
        break;
    }
  };

  let result = await first;
  while (!result.done) {
    handle(result.value);
    if (result.value.type === "stream_end" || result.value.type === "error") {
      // The server closes its end right after sending this, but we still
      // own the client-side reader until we say we're done with it too --
      // same reasoning as the --no-watch early-return path above.
      await stream.return(undefined);
      return;
    }
    result = await stream.next();
  }
}
