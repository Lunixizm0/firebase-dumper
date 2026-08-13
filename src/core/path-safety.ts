import fs from "node:fs";
import path from "node:path";
import { FatalError } from "./errors.ts";

export const BLOCKED_ROOTS: readonly string[] = [
  "/etc",
  "/sys",
  "/proc",
  "/dev",
  "/run",
  "/root",
  "/boot",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/lib",
  "/lib64",
  "/snap",
  "/tmp"
];

export function isSafePath(inputPath: string): boolean {
  if (/\.\.[/\\]/.test(inputPath) || /^\.\.(?:[/\\]|$)/.test(inputPath)) {
    return false;
  }

  if (/[|;&`$<>!]/.test(inputPath)) {
    return false;
  }

  for (const ch of inputPath) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }

  const resolved = path.resolve(inputPath);

  const root = path.parse(resolved).root.replace(/[/\\]$/, "");
  if (resolved === root || resolved === "/" || resolved === "\\") {
    return false;
  }

  for (const blocked of BLOCKED_ROOTS) {
    if (resolved === blocked || resolved.startsWith(blocked + path.sep)) {
      return false;
    }
  }

  return true;
}

export function validateKeyFile(keyPath: string): void {
  if (!fs.existsSync(keyPath)) {
    throw new FatalError(`Err: Service account key not found: ${keyPath}`);
  }

  const stats = fs.statSync(keyPath);
  if (!stats.isFile()) {
    throw new FatalError(`Err: Service account key path is not a file: ${keyPath}`);
  }

  if (process.platform !== "win32") {
    const mode = stats.mode & 0o777;
    if (mode & 0o044) {
      console.warn(`Warn: Service account key is readable by others (${mode.toString(8)}). Consider chmod 600`);
    }
  }
}

export function ensureOutputDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    return;
  }

  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) {
    throw new FatalError(`Err: Output path exists but is not a directory: ${dirPath}`);
  }
}
