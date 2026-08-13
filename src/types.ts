import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";

export const SERVICE_NAMES = [
  "serviceAccount",
  "firestore",
  "realtimeDB",
  "auth",
  "storage",
  "projectConfig",
  "securityRules",
  "appCheck",
  "fcm",
  "remoteConfig",
  "ml"
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export const SERVICE_ALIASES: Readonly<Record<string, ServiceName>> = {
  rtdb: "realtimeDB",
  realtime: "realtimeDB",
  db: "realtimeDB",
  cloudstorage: "storage",
  rules: "securityRules"
};

export interface ServiceAccount {
  type?: string;
  project_id: string;
  private_key_id?: string;
  client_email: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
  private_key: string;
  [key: string]: unknown;
}

export interface CliOptions {
  key: string;
  out: string;
  dbUrl?: string;
  bucket?: string;
  services: string;
  quiet: boolean;
  dryRun?: boolean;
  config?: string;
  archive?: boolean;
  storageDownload?: boolean;
  maxPages?: number;
  firestorePageSize?: number;
  maxDocsPerCollection?: number;
  storageMaxFiles?: number;
  retries?: number;
  storageDownloadMaxMb?: number;
}

export interface ResolvedConfig {
  keyPath: string;
  outputDir: string;
  dbUrl: string | null;
  bucketOverride: string | null;
  quiet: boolean;
  enabledServices: ReadonlySet<ServiceName>;
  projectId: string;
  clientEmail: string;
  serviceAccount: ServiceAccount;
  dryRun: boolean;
  archive: boolean;
  storageDownload: boolean;
  maxPages: number;
  firestorePageSize: number;
  maxDocsPerCollection: number;
  storageMaxFiles: number;
  retries: number;
  storageDownloadMaxBytes: number;
}

export type ServiceStatusState = "ok" | "skipped" | "error";

export interface ServiceStatus {
  status: ServiceStatusState;
  detail?: string;
  elapsedMs?: number;
}

export interface SkippedEntry {
  service: string;
  reason: string;
}

export interface DumpErrorEntry {
  service: string;
  error: string;
}

export interface DumpMetadata {
  projectId: string;
  clientEmail: string;
  dumpedAt: string;
  note: string;
}

export interface FirestoreStats {
  totalRootCollections: number;
  totalDocuments: number;
  totalSubcollections: number;
}

export interface AuthStats {
  totalUsers: number;
  verifiedEmails: number;
  disabledUsers: number;
  withPhone: number;
  withPhoto: number;
  withCustomClaims: number;
  withMFA: number;
}

export interface MfaFactorInfo {
  uid: string;
  displayName: string;
  enrollmentTime: string;
  factorId: string;
  phoneNumber: string;
}

export interface DumpUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  phoneNumber?: string;
  photoURL?: string;
  disabled: boolean;
  metadata: {
    creationTime?: string;
    lastSignInTime?: string;
    lastRefreshTime?: string;
  };
  providerData?: unknown;
  customClaims?: Record<string, unknown>;
  tokensValidAfterTime?: string;
  tenantId?: string;
  multiFactor?: MfaFactorInfo[];
}

export interface StorageBucketInfo {
  name: string;
  id?: string;
  location?: string;
  storageClass?: string;
  created?: string;
  updated?: string;
  iamConfiguration?: unknown;
  versioning?: unknown;
  labels?: unknown;
  cors?: unknown;
  lifecycle?: unknown;
  source?: string;
  url?: string;
}

export interface StorageFileInfo {
  name: string;
  size?: string | number;
  contentType?: string;
  contentEncoding?: string;
  updated?: string;
  created?: string;
  md5Hash?: string;
  crc32c?: string;
  generation?: string | number;
  metageneration?: string | number;
  storageClass?: string;
  mediaLink?: string;
  selfLink?: string;
  public: boolean;
  owner?: unknown;
  metadata?: unknown;
  cacheControl?: string;
}

export interface PublicBucketObject {
  key: string | null;
  size: number | null;
  lastModified: string | null;
  etag: string | null;
  storageClass: string | null;
}

export interface AppCheckApp {
  name: string;
  appId: string;
  displayName: string;
  tokenTtl: string;
}

export interface AppCheckResult {
  available: boolean;
  appCount?: number;
  apps?: AppCheckApp[];
  error?: string;
}

export interface FcmResult {
  accessible: boolean;
  note?: string;
}

export interface SecurityRulesResult {
  releases: Array<{
    service: string;
    rulesetName: string;
    createTime: string;
  }>;
  rulesetMetadata: Array<{
    name: string;
    createTime: string;
  }>;
  rulesets: Array<{
    name: string;
    source?: unknown;
    createTime: string;
  }>;
}

export interface MlModelInfo {
  displayName: string;
  modelId: string;
  createTime?: string;
  updateTime?: string;
  validationError?: string;
  published?: boolean;
  etag?: string;
  modelHash?: string;
  tags?: string[];
}

export interface ServiceAccountInfo {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  client_email?: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
  hasPrivateKey: boolean;
}

export interface DumpResult {
  _metadata: DumpMetadata;
  firestore: {
    collections: Record<string, unknown>;
    subcollections_recursive: Record<string, unknown>;
    stats: FirestoreStats;
  };
  realtimeDatabase: unknown;
  auth: {
    users: DumpUser[];
    stats: AuthStats;
  };
  storage: {
    buckets: StorageBucketInfo[];
    files: Record<string, unknown>;
  };
  projectConfig: unknown;
  securityRules: SecurityRulesResult;
  appCheck: AppCheckResult | null;
  fcm: FcmResult;
  remoteConfig: unknown;
  ml: MlModelInfo[];
  customClaims: Record<string, Record<string, unknown>>;
  errors: DumpErrorEntry[];
  skipped: SkippedEntry[];
  _serviceAccountInfo?: ServiceAccountInfo;
}

export interface Logger {
  readonly quiet: boolean;
  section(title: string): void;
  log(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  raw(line: string): void;
}

export interface FirebaseClients {
  app: App;
  db: Firestore;
  auth: Auth;
  storage: Storage;
}

export interface ServiceContext {
  config: ResolvedConfig;
  results: DumpResult;
  statuses: Map<string, ServiceStatus>;
  logger: Logger;
  clients: FirebaseClients;
  serviceAccount: ServiceAccount;
}

export type ServiceDumper = (ctx: ServiceContext) => Promise<void>;

export interface ServiceDefinition {
  name: ServiceName;
  dumper: ServiceDumper;
}
