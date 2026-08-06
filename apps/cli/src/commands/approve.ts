// Deliberately NOT a uniform rubber stamp. The whole governance premise
// weakens if the person who typed the prompt can trivially also approve
// it from the same terminal, so this is risk-tiered rather than one
// `POST /approvals/{id}` behind a single command:
//
//   low    -> CLI approves directly
//   medium -> CLI requires a typed confirmation (re-type the target)
//   high   -> CLI refuses outright, points to the Control Room. No
//             override flag. High-risk decisions only happen in the
//             browser, by design -- see the approved plan's Q7 answer.

import pc from "picocolors";
import { getAction, decideApproval, getActionEvents } from "../client";
import { actionLabel, colorRisk, riskReasons, policyReasons } from "../format";
import { loadConfig, controlRoomUrl } from "../config";
import { promptConfirmMatch } from "../prompt";
import os from "node:os";

async function printReasoning(actionId: string): Promise<void> {
  const events = await getActionEvents(actionId);
  for (const reason of riskReasons(events)) console.log(pc.dim(`  why flagged — ${reason}`));
  for (const reason of policyReasons(events)) console.log(pc.dim(`  policy — ${reason}`));
}

async function decide(actionId: string, decision: "approved" | "denied"): Promise<void> {
  const action = await getAction(actionId);
  if (action.status !== "pending") {
    console.error(pc.red(`This action is no longer pending (status: ${action.status}).`));
    process.exitCode = 1;
    return;
  }

  console.log(`${actionLabel(action)} ${pc.dim(`[${colorRisk(action.risk_level)}]`)}`);
  await printReasoning(actionId);
  console.log();

  if (decision === "approved" && action.risk_level === "high") {
    const config = loadConfig();
    console.error(pc.red("High-risk actions can't be approved from the CLI."));
    console.error(pc.dim(`Review this in the Control Room: ${config ? `${controlRoomUrl(config)}/approvals` : "(run `orion login` to see the link)"}`));
    process.exitCode = 1;
    return;
  }

  if (decision === "approved" && action.risk_level === "medium") {
    const confirmed = await promptConfirmMatch(pc.yellow("Medium risk — confirm you've reviewed this."), action.target);
    if (!confirmed) {
      console.log(pc.dim("Not confirmed. No decision recorded."));
      return;
    }
  }

  const approver = `cli:${os.userInfo().username}`;
  const result = await decideApproval(actionId, decision, approver);
  console.log(`${decision === "approved" ? pc.green("✓ approved") : pc.red("✗ denied")} — ${result.status}`);
}

export async function approveCommand(actionId: string): Promise<void> {
  await decide(actionId, "approved");
}

export async function denyCommand(actionId: string): Promise<void> {
  await decide(actionId, "denied");
}
