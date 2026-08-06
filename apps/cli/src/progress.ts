// Terminal ergonomics helpers (Orion Phase 2, Priority 4) -- spinner,
// icons, indentation, all in one place so every command renders
// consistently instead of each hand-rolling its own. TTY-aware: a
// redrawing spinner only makes sense when something can actually
// overwrite the previous line, so piped/non-interactive output (CI logs,
// `orion implement | tee run.log`) gets one plain line instead of a
// stream of \r control codes that would otherwise corrupt a log file.

import pc from "picocolors";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

export class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private text: string;
  private readonly isTTY = process.stdout.isTTY === true;

  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    if (!this.isTTY) {
      process.stdout.write(`${this.text}\n`);
      return this;
    }
    process.stdout.write(`${pc.cyan(SPINNER_FRAMES[0])} ${this.text}`);
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      process.stdout.write(`\r${pc.cyan(SPINNER_FRAMES[this.frame])} ${this.text}\x1b[K`);
    }, SPINNER_INTERVAL_MS);
    return this;
  }

  /** Changes the label without stopping the animation. On non-TTY output
   * this just prints a new line, since there's nothing to overwrite. */
  update(text: string): void {
    this.text = text;
    if (!this.isTTY) process.stdout.write(`${text}\n`);
  }

  stop(finalLine?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isTTY) process.stdout.write(`\r\x1b[K`);
    if (finalLine) console.log(finalLine);
  }
}

export const icons = {
  ok: pc.green("✓"),
  fail: pc.red("✗"),
  pause: pc.yellow("⏸"),
  arrow: pc.dim("→"),
  bullet: pc.dim("•"),
  live: pc.green("●"),
};

export function indent(text: string, level = 1): string {
  return "  ".repeat(level) + text;
}
