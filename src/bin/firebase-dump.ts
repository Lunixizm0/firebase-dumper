#!/usr/bin/env node
import { FatalError, toErrorMessage } from "../core/errors.ts";
import { run } from "../index.ts";

try {
  await run();
} catch (err) {
  if (err instanceof FatalError) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = err.exitCode;
  } else {
    console.error("[ERROR]", toErrorMessage(err));
    process.exitCode = 1;
  }
} finally {
  // Let stdio flush before the process exits naturally. firebase-admin may
  // leave handles open, so force-exit shortly after if the process lingers.
  setTimeout(() => process.exit(process.exitCode), 250).unref();
}
