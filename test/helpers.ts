import { vi } from "vitest";
import { createResults } from "../src/core/results.ts";
import {
  SERVICE_NAMES,
  type Logger,
  type ResolvedConfig,
  type ServiceAccount,
  type ServiceContext,
  type ServiceName
} from "../src/types.ts";

export function makeServiceAccount(): ServiceAccount {
  return {
    type: "service_account",
    project_id: "test-project",
    private_key_id: "mock-key-id",
    private_key: "-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----\n",
    client_email: "test@test-project.iam.gserviceaccount.com",
    client_id: "12345"
  };
}

export function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  const serviceAccount = makeServiceAccount();
  return {
    keyPath: "/tmp/key.json",
    outputDir: "/tmp/out",
    dbUrl: null,
    bucketOverride: null,
    quiet: true,
    enabledServices: new Set(SERVICE_NAMES) as ReadonlySet<ServiceName>,
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    serviceAccount,
    dryRun: false,
    archive: false,
    storageDownload: false,
    maxPages: 50,
    firestorePageSize: 300,
    maxDocsPerCollection: 0,
    storageMaxFiles: 0,
    retries: 3,
    storageDownloadMaxBytes: 50 * 1024 * 1024,
    ...overrides
  };
}

export function onlyServices(...names: ServiceName[]): ReadonlySet<ServiceName> {
  return new Set(names);
}

export function makeLogger(): Logger {
  return {
    quiet: false,
    section: vi.fn(),
    log: vi.fn(),
    ok: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    raw: vi.fn()
  };
}

export function makeCtx(
  clients: Record<string, unknown>,
  overrides: Partial<ResolvedConfig> = {}
): ServiceContext {
  const config = makeConfig(overrides);
  return {
    config,
    results: createResults(config.projectId, config.clientEmail),
    statuses: new Map(),
    logger: makeLogger(),
    clients: clients as unknown as ServiceContext["clients"],
    serviceAccount: config.serviceAccount
  };
}
