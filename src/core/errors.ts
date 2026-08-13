export class FatalError extends Error {
  readonly exitCode: number;

  constructor(message: string, options: { exitCode?: number } = {}) {
    super(message);
    this.name = "FatalError";
    this.exitCode = options.exitCode ?? 1;
  }
}

export function isApiDisabledError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /has not been used in project|it is disabled|SERVICE_DISABLED/i.test(msg);
}

export function isNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\bNOT_FOUND\b|not found/i.test(msg);
}

export function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
