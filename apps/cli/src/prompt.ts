// Hand-rolled, not inquirer -- three small prompt shapes cover every use
// in this CLI (text input, yes/no, typed-confirmation), and a git-like
// tool's prompts should be as unadorned as git's own ("Username for
// 'https://github.com': "), not a TUI library's styled widgets.

import { createInterface } from "node:readline/promises";

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function promptText(question: string): Promise<string> {
  return ask(question);
}

export async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await ask(`${question} ${suffix} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

// Used for the medium-risk approval tier: the reviewer must re-type the
// exact action target, not just press a key -- cheap to script around
// deliberately, so it's a speed bump against habit, not a real barrier.
export async function promptConfirmMatch(question: string, expected: string): Promise<boolean> {
  const answer = await ask(`${question} (type "${expected}" to confirm) `);
  return answer === expected;
}
