# firebase-dump

Firebase project dump tool. Extracts Firestore, Auth, Storage, Realtime Database, Security Rules, Remote Config, App Check, FCM, and ML data via the Firebase Admin SDK. Supports anonymous metadata listing for publicly-accessible S3-compatible buckets without any AWS credentials.

---

## Requirements

- Node.js ≥ 22.0.0
- A Firebase service account JSON key with appropriate IAM permissions
- npm dependencies installed (`npm install`)

---

## Installation

```bash
git clone https://github.com/Lunixizm0/firebase-dumper.git
cd firebase-dump
npm install
chmod 600 ./serviceAccountKey.json   # recommended
```

---

## Usage

```
node firebase-dump.js [options]
```

| Flag | Alias | Default | Description |
|---|---|---|---|
| `--key <path>` | `-k` | `./serviceAccountKey.json` | Path to service account JSON key |
| `--out <dir>` | `-o` | `./firebase_dump` | Output directory for dump files |
| `--db-url <url>` | `-u` | - | Realtime Database URL (`https://<project>.firebaseio.com`) |
| `--bucket <name\|url>` | `-b` | - | Firebase Storage bucket name **or** a public S3-compatible URL to list |
| `--services <list>` | `-s` | `all` | Comma-separated list of services to dump |
| `--quiet` | `-q` | `false` | Suppress all non-error output |

---

## Examples

**Full dump (all services):**
```bash
node firebase-dump.js -k ./serviceAccountKey.json
```

**Specific services only:**
```bash
node firebase-dump.js -k ./serviceAccountKey.json -s firestore,auth,storage
```

**With Realtime Database:**
```bash
node firebase-dump.js -k ./serviceAccountKey.json -u https://my-project-default-rtdb.firebaseio.com
```

**Explicit Firebase Storage bucket:**
```bash
node firebase-dump.js -k ./serviceAccountKey.json -b my-project.appspot.com
```

**Publicly-accessible S3 bucket (no AWS credentials required):**
```bash
node firebase-dump.js -k ./serviceAccountKey.json -b https://witeapp.s3.amazonaws.com/
```

**Custom output directory, quiet mode:**
```bash
node firebase-dump.js -k ./serviceAccountKey.json -o /home/user/dumps/firebase -q
```

---

## Services

| Service name | Aliases | What gets extracted |
|---|---|---|
| `serviceAccount` | — | Sanitized service account metadata |
| `firestore` | — | All collections, documents, and subcollections recursively |
| `realtimeDB` | `rtdb`, `db`, `realtime` | Full RTDB root snapshot (requires `--db-url`) |
| `auth` | — | All users, custom claims, MFA factors |
| `storage` | `cloudstorage` | Bucket metadata + file list (no content downloaded) |
| `projectConfig` | — | Firebase Auth project configuration |
| `securityRules` | `rules` | All rulesets + currently deployed Firestore and Storage rules |
| `appCheck` | — | App Check-registered apps via REST API |
| `fcm` | — | FCM accessibility probe via dry-run send |
| `remoteConfig` | — | Remote Config template (parameters, conditions, version) |
| `ml` | — | Firebase ML model list |

Pass `all` (default) to include every service, or a comma-separated subset:

```bash
-s firestore,auth,storage
-s rules,projectConfig
-s all
```

---

## Output files

All files are written to the output directory with `0600` permissions.

| File | Contents |
|---|---|
| `firebase_full_dump.json` | Single file containing everything |
| `firestore_dump.json` | Firestore collections and documents |
| `auth_users_dump.json` | Auth users and per-user statistics |
| `custom_claims_dump.json` | Custom claims keyed by UID |
| `storage_dump.json` | Bucket metadata and file list |
| `rtdb_dump.json` | Realtime Database root snapshot |
| `project_config_dump.json` | Auth project configuration |
| `security_rules_dump.json` | Security rule rulesets and active releases |
| `remote_config_dump.json` | Remote Config template |
| `ml_models_dump.json` | ML model list |
| `service_account_info.json` | Sanitized service account metadata |

---

## Public S3 bucket listing

When `--bucket` is given a URL starting with `http://` or `https://`, the tool treats it as an anonymously-listable, S3-compatible object storage endpoint instead of a Firebase bucket name. It pages through the XML listing API (no AWS credentials, no SDK) and extracts object key, size, ETag, last-modified timestamp, and storage class - the same metadata fields captured for Firebase Storage. File contents are never downloaded.

- If the bucket returns `403 AccessDenied`, the listing is not public and the service is marked as skipped, not an error.
- If the bucket returns `404 NoSuchBucket`, likewise skipped.
- Pagination is capped at 50 pages for now.
- Each request has a 15-second timeout.

---

## Service statuses

The tool distinguishes three outcome categories in its summary:

| Status | Meaning |
|---|---|
| ok | Service dumped successfully |
| skipped | Expected condition: API not enabled, no `--db-url` given, no resources provisioned yet |
| error | Unexpected failure worth investigating |

Services are marked as **skipped** (not error) when:
- The Firestore or Firebase ML API is disabled in GCP
- `--db-url` is not provided for RTDB
- No rulesets or deployed rules exist in the project
- A public bucket listing returns 403 or 404

---

## Required IAM permissions

The service account needs the following roles or equivalent permissions depending on which services you dump:

| Service | Required role / permission |
|---|---|
| Firestore | `roles/datastore.viewer` |
| Auth (users, project config) | `roles/firebase.viewer` |
| Storage | `roles/storage.objectViewer` + `roles/storage.legacyBucketReader` |
| Realtime Database | `roles/firebase.viewer` |
| Security Rules | `roles/firebaserules.viewer` |
| App Check | `roles/firebase.sdkAdminServiceAgent` or `firebaseappcheck.apps.list` |
| FCM | `roles/firebase.viewer` |
| Remote Config | `roles/remoteconfig.viewer` |
| Firebase ML | `roles/firebaseml.viewer` |

The easiest approach for internal/authorized use is `roles/firebase.admin`, which covers all of the above.

---

## Known limitations

- **Firestore**: very large collections (millions of documents) will be slow and memory-intensive. Consider `--services firestore` alone with adequate RAM for large projects.
- **Storage**: the Admin SDK cannot enumerate all buckets in a GCP project without the raw `@google-cloud/storage` client and `storage.buckets.list` IAM permission. By default, the tool tries `<projectId>.firebasestorage.app` and `<projectId>.appspot.com`. Pass `--bucket <name>` explicitly if your bucket uses a custom name.
- **App Check / FCM**: these services are probed for accessibility but their data is not deeply enumerated (App Check lists registered apps; FCM performs a dry-run send with a fake token no real message is delivered).
- **Firebase ML**: full model binary/URL extraction is not implemented, only metadata.

---

## License

MIT see [LICENSE](./LICENSE).
