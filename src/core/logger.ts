import type { Logger } from "../types.ts";

function colorEnabled(): boolean {
  return !process.env.NO_COLOR;
}

export function paint(code: string, s: string): string {
  return colorEnabled() ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export function createLogger(quiet: boolean): Logger {
  return {
    quiet,
    section(title: string): void {
      if (!quiet) console.log(`\n${paint("1;36", "> " + title)}`);
    },
    log(msg: string): void {
      if (!quiet) console.log(msg);
    },
    ok(msg: string): void {
      if (!quiet) console.log(`  ${paint("32", "+")} ${msg}`);
    },
    warn(msg: string): void {
      if (!quiet) console.log(`  ${paint("33", "*")} ${msg}`);
    },
    error(msg: string): void {
      console.error(`  ${paint("31", "-")} ${msg}`);
    },
    raw(line: string): void {
      if (!quiet) console.log(line);
    }
  };
}
