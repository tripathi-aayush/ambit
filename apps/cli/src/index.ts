#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { loginCommand } from "./commands/login";
import { linkCommand } from "./commands/link";
import { planCommand } from "./commands/plan";
import { implementCommand } from "./commands/implement";
import { runCommand } from "./commands/run";
import { statusCommand } from "./commands/status";
import { reviewCommand } from "./commands/review";
import { approveCommand, denyCommand } from "./commands/approve";
import { logsCommand } from "./commands/logs";

const program = new Command();

program
  .name("orion")
  .description("Orion — the CLI for a governed AI-engineering runtime. Work begins here; review happens in the Control Room.")
  .version("0.1.0");

program
  .command("login")
  .description("save your Orion API credentials")
  .option("--api-url <url>", "Orion API URL")
  .option("--api-key <key>", "Orion API key")
  .option("--web-url <url>", "Control Room URL")
  .action(loginCommand);

program
  .command("link")
  .description("connect the current directory's repository to Orion")
  .action(linkCommand);

program
  .command("plan <task>")
  .description("generate a plan without executing it")
  .action(planCommand);

program
  .command("implement <task>")
  .description("plan and run — the primary way work begins")
  .option("--no-watch", "don't wait for approval interrupts to resolve")
  .action((task, opts) => implementCommand(task, { watch: opts.watch }));

program
  .command("run [plan-id]")
  .description("execute an already-generated plan (defaults to the most recent)")
  .option("--no-watch", "don't wait for approval interrupts to resolve")
  .action((planId, opts) => runCommand(planId, { watch: opts.watch }));

program
  .command("status")
  .description("what's pending, executing, or recently denied")
  .option("--all", "show counts across every repository, not just the linked one")
  .action((opts) => statusCommand({ all: Boolean(opts.all) }));

program
  .command("review [plan-id]")
  .description("show a plan's diffs and risk/policy reasoning")
  .action(reviewCommand);

program
  .command("approve <action-id>")
  .description("approve a pending action (low-risk only; medium requires confirmation; high is Control Room-only)")
  .action(approveCommand);

program
  .command("deny <action-id>")
  .description("deny a pending action")
  .action(denyCommand);

program
  .command("logs [plan-id]")
  .description("show a plan's execution events")
  .option("-f, --follow", "poll for new events until the plan is resolved")
  .action((planId, opts) => logsCommand(planId, { follow: Boolean(opts.follow) }));

program.parseAsync(process.argv).catch((err) => {
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
