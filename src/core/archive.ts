import path from "node:path";
import { create as createTar } from "tar";
import type { Logger } from "../types.ts";

function timestampSuffix(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export async function createArchive(outputDir: string, projectId: string, logger: Logger): Promise<string> {
  const parent = path.dirname(outputDir);
  const archivePath = path.join(
    parent,
    `firebase_dump_${projectId}_${timestampSuffix(new Date())}.tar.gz`
  );

  await createTar({ gzip: true, cwd: outputDir, file: archivePath, portable: true }, ["."]);
  logger.log(`Archive: ${archivePath}`);
  return archivePath;
}
