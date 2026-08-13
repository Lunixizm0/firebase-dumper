import type { ServiceDefinition } from "../types.ts";
import { dumpAppCheck } from "./app-check.ts";
import { dumpAuth } from "./auth.ts";
import { dumpFCM } from "./fcm.ts";
import { dumpFirestore } from "./firestore.ts";
import { dumpML } from "./ml.ts";
import { dumpProjectConfig } from "./project-config.ts";
import { dumpRealtimeDB } from "./realtime-db.ts";
import { dumpRemoteConfig } from "./remote-config.ts";
import { dumpSecurityRules } from "./security-rules.ts";
import { dumpServiceAccount } from "./service-account.ts";
import { dumpStorage } from "./storage.ts";

export const SERVICES: readonly ServiceDefinition[] = [
  { name: "serviceAccount", dumper: dumpServiceAccount },
  { name: "firestore", dumper: dumpFirestore },
  { name: "realtimeDB", dumper: dumpRealtimeDB },
  { name: "auth", dumper: dumpAuth },
  { name: "storage", dumper: dumpStorage },
  { name: "projectConfig", dumper: dumpProjectConfig },
  { name: "securityRules", dumper: dumpSecurityRules },
  { name: "appCheck", dumper: dumpAppCheck },
  { name: "fcm", dumper: dumpFCM },
  { name: "remoteConfig", dumper: dumpRemoteConfig },
  { name: "ml", dumper: dumpML }
];
