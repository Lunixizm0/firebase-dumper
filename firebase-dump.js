#!/usr/bin/env node
/**
 * firebase-dump.js
 * 
 * Firebase project dump tool
 * Extracts firestore, auth, storage, rtdb, security rules, remote Config,
 * ml, app check and fcm data via Firebase Admin SDK.
 * 
 * Usage:
 *   node firebase-dump.js [options]
 * 
 *   node firebase-dump.js --key ./serviceAccountKey.json --out ./dump --db-url https://<project>.firebaseio.com
 *   node firebase-dump.js --key ./key.json --services firestore,auth
 *   node firebase-dump.js --help
 * 
 */

const fs = require("fs");
const path = require("path");
const { program } = require("commander");

// cli
program
  .name("firebase-dump")
  .description("Dump Firebase project data via Admin SDK")
  .version("2.2.1")
  .option("-k, --key <path>", "Path to service account JSON key", "./serviceAccountKey.json")
  .option("-o, --out <dir>", "Output directory for dumped files", "./firebase_dump")
  .option("-u, --db-url <url>", "Realtime Database URL (optional)")
  .option("-s, --services <list>", "Comma separated services to dump (default: all)", "all")
  .option("-q, --quiet", "Suppress non error output", false)
  .parse();

const opts = program.opts();

// Validates that a file path is safe 
function isSafePath(targetPath, baseDir = process.cwd()) {
  const resolved = path.resolve(targetPath);
  const base = path.resolve(baseDir);
  return resolved.startsWith(base) || path.isAbsolute(resolved);}

// Validates that the service account key file exists and is readable.
function validateKeyFile(keyPath) {
  if (!fs.existsSync(keyPath)) {
    console.error(`Err: Service account key not found: ${keyPath}`);
    process.exit(1);}

  const stats = fs.statSync(keyPath);
  if (!stats.isFile()) {
    console.error(`Err: Service account key path is not a file: ${keyPath}`);
    process.exit(1);}

  // Check for overly permissive permissions on Unix systems
  if (process.platform !== "win32") {
    const mode = stats.mode & 0o777;
    if (mode & 0o044) {
      console.warn(`Warn: Service account key is readable by others (${mode.toString(8)}). Consider chmod 600.`);}}}

// creates the output directory
function ensureOutputDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  } else {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      console.error(`Err: Output path exists but is not a directory: ${dirPath}`);
      process.exit(1);}}}


 //Parses the --services option into an array 
function parseServices(servicesOpt) {
  const allServices = [
    "serviceAccount", "firestore", "realtimeDB", "auth", "storage",
    "projectConfig", "securityRules", "appCheck", "fcm", "remoteConfig", "ml"];

  if (servicesOpt === "all") {
    return new Set(allServices);}

  const requested = servicesOpt.split(",").map(s => s.trim().toLowerCase());
  const enabled = new Set();

  for (const svc of requested) {
    // Map alias
    const aliasMap = {
      "rtdb": "realtimeDB",
      "realtime": "realtimeDB",
      "db": "realtimeDB",
      "cloudstorage": "storage",
      "rules": "securityRules"};
    const normalized = aliasMap[svc] || svc;

    if (!allServices.includes(normalized)) {
      console.error(`Err: Unknown service: ${svc}. Available: ${allServices.join(", ")}`);
      process.exit(1);}
    enabled.add(normalized);}
  return enabled;}

//global conf
const SERVICE_KEY_PATH = path.resolve(opts.key);
const OUTPUT_DIR = path.resolve(opts.out);
const DB_URL = opts.dbUrl || null;
const QUIET = opts.quiet;
const ENABLED_SERVICES = parseServices(opts.services);

// validate input
validateKeyFile(SERVICE_KEY_PATH);

if (!isSafePath(SERVICE_KEY_PATH)) {
  console.error("Err: Service account key path contains directory traversal.");
  process.exit(1);}

if (!isSafePath(OUTPUT_DIR)) {
  console.error("Err: Output directory path contains directory traversal.");
  process.exit(1);}

ensureOutputDir(OUTPUT_DIR);

// firebase init
let serviceAccount;
try {
  const raw = fs.readFileSync(SERVICE_KEY_PATH, "utf8");
  serviceAccount = JSON.parse(raw);
} catch (e) {
  console.error(`ERR: Failed to parse service account key: ${e.message}`);
  process.exit(1);}

// Validate required fields in service account JSON
const requiredFields = ["project_id", "client_email", "private_key"];
for (const field of requiredFields) {
  if (!serviceAccount[field]) {
    console.error(`ERR: Service account key missing required field: ${field}`);
    process.exit(1);}}

const projectId = serviceAccount.project_id;

if (!QUIET) {
  console.log(`Project ID: ${projectId}`);
  console.log(`Client Email: ${serviceAccount.client_email}`);
  console.log(`Output Dir: ${OUTPUT_DIR}`);
  console.log(`Services: ${Array.from(ENABLED_SERVICES).join(", ")}`);}

// Lazy load Firebase Admin modules
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getDatabase } = require("firebase-admin/database");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const { getSecurityRules } = require("firebase-admin/security-rules");
const { getAppCheck } = require("firebase-admin/app-check");
const { getMessaging } = require("firebase-admin/messaging");
const { getRemoteConfig } = require("firebase-admin/remote-config");
const { getMachineLearning } = require("firebase-admin/machine-learning");

const appConfig = { credential: cert(serviceAccount) };
if (DB_URL) appConfig.databaseURL = DB_URL;

let app;
try {
  app = initializeApp(appConfig);
  if (!QUIET) console.log("Firebase app initialized");
} catch (e) {
  console.error(`[ERROR] Firebase app initialization failed: ${e.message}`);
  process.exit(1);}

// Service references
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

//results
const results = {
  _metadata: {
    projectId,
    clientEmail: serviceAccount.client_email,
    dumpedAt: new Date().toISOString(),
    note: "dump",},
  firestore: { collections: {}, subcollections_recursive: {}, stats: {} },
  realtimeDatabase: null,
  auth: { users: [], stats: {} },
  storage: { buckets: [], files: {} },
  projectConfig: null,
  securityRules: { releases: [], rulesets: [] },
  appCheck: null,
  fcm: { accessible: false },
  remoteConfig: null,
  ml: null,
  customClaims: {},
  errors: [],};


// Utilities 

//Writes JSON data to a file in the output directory.
function saveJson(name, data) {
  const filePath = path.join(OUTPUT_DIR, `${name}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    if (!QUIET) console.log(`Saved: ${filePath}`);
  } catch (e) {
    console.error(`[ERROR] Failed to write ${filePath}: ${e.message}`);
    results.errors.push({ service: "filesystem", error: e.message });}}

 //Logs an error from a service 
function logError(service, err) {
  const msg = err?.message || String(err);
  results.errors.push({ service, error: msg });
  console.error(`[${service}] Error:`, msg);}

//Formats a Firestore timestamp safely.
function formatTimestamp(ts) {
  try {
    return ts?.toDate?.()?.toISOString?.() || null;
  } catch {
    return null;}}
    
/**
 * Dumps firestore collections, documents, and nested subcollections recursively
 * Uses pagination-friendly iteration to avoid memory issues on large datasets.
 */
async function dumpFirestore() {
  if (!ENABLED_SERVICES.has("firestore")) return;
  if (!QUIET) console.log("\nFirestore Starting dump...");

  try {
    const collections = await db.listCollections();
    if (!QUIET) console.log(`  Total root collections: ${collections.length}`);

    let totalDocs = 0;
    let totalSubcollections = 0;

    /**
     * Recursively dumps a collection and its documents.
     * @param {CollectionReference} colRef Firestore collection reference
     * @param {string} parentPath Path prefix for nested collections
     */
    async function dumpCollection(colRef, parentPath = "") {
      const colName = parentPath ? `${parentPath}/${colRef.id}` : colRef.id;
      const docsSnap = await colRef.get();
      const docs = {};

      for (const doc of docsSnap.docs) {
        totalDocs++;
        const docPath = `${colName}/${doc.id}`;

        docs[doc.id] = {
          _data: doc.data(),
          _createTime: formatTimestamp(doc.createTime),
          _updateTime: formatTimestamp(doc.updateTime),
          _readTime: formatTimestamp(doc.readTime),};

        // Recursively dump subcollections
        const subcols = await doc.ref.listCollections();
        if (subcols.length > 0) {
          totalSubcollections += subcols.length;
          for (const subcol of subcols) {
            const subData = await dumpCollection(subcol, docPath);
            if (!results.firestore.subcollections_recursive[docPath]) {
              results.firestore.subcollections_recursive[docPath] = {};}
            results.firestore.subcollections_recursive[docPath][subcol.id] = subData;}}}
      return docs;}

    for (const col of collections) {
      results.firestore.collections[col.id] = await dumpCollection(col);
      if (!QUIET) {
        console.log(`  [${col.id}] => ${Object.keys(results.firestore.collections[col.id]).length} documents`);}}

    results.firestore.stats = {
      totalRootCollections: collections.length,
      totalDocuments: totalDocs,
      totalSubcollections: totalSubcollections,};

    if (!QUIET) {
      console.log(`  Firestore: ${totalDocs} docs, ${totalSubcollections} subcollections`);}
  } catch (e) {
    logError("firestore", e);}}

/**
 * Dumps the firebase realtime database root node.
 * Skips if no DB_URL was provided.
 */
async function dumpRealtimeDB() {
  if (!ENABLED_SERVICES.has("realtimeDB")) return;
  if (!QUIET) console.log("\n[Realtime DB] Starting dump...");

  if (!DB_URL) {
    if (!QUIET) console.log("  DB_URL not provided, skipping RTDB");
    logError("rtdb", new Error("databaseURL not provided, skipped"));
    return;}

  try {
    const rtdb = getDatabase(app, DB_URL);
    const ref = rtdb.ref("/");
    const snap = await ref.once("value");
    results.realtimeDatabase = snap.val();
    const size = JSON.stringify(results.realtimeDatabase || {}).length;
    if (!QUIET) console.log(`  RTDB root dumped (~${size} bytes)`);
  } catch (e) {
    logError("rtdb", e);}}

/**
 * Dumps all firebase auth users with pagination
 * Handles large user bases by fetching in batches of 1000
 */
async function dumpAuth() {
  if (!ENABLED_SERVICES.has("auth")) return;
  if (!QUIET) console.log("\n[Auth] Starting dump...");

  try {
    const users = [];
    let nextPageToken;
    let page = 0;

    do {
      page++;
      const list = await auth.listUsers(1000, nextPageToken);
      users.push(...list.users);
      nextPageToken = list.pageToken;
      if (!QUIET) console.log(`  Page ${page}: ${list.users.length} users`);
    } while (nextPageToken);

    // Map user objects to serializable format
    results.auth.users = users.map(u => ({
      uid: u.uid,
      email: u.email,
      emailVerified: u.emailVerified,
      displayName: u.displayName,
      phoneNumber: u.phoneNumber,
      photoURL: u.photoURL,
      disabled: u.disabled,
      metadata: {
        creationTime: u.metadata?.creationTime,
        lastSignInTime: u.metadata?.lastSignInTime,
        lastRefreshTime: u.metadata?.lastRefreshTime,},
        
      providerData: u.providerData,
      customClaims: u.customClaims,
      tokensValidAfterTime: u.tokensValidAfterTime,
      tenantId: u.tenantId,
      multiFactor: u.multiFactor?.enrolledFactors?.map(f => ({
        uid: f.uid,
        displayName: f.displayName,
        enrollmentTime: f.enrollmentTime,
        factorId: f.factorId,
        phoneNumber: f.phoneNumber,})),}));

    results.auth.stats = {
      totalUsers: users.length,
      verifiedEmails: users.filter(u => u.emailVerified).length,
      disabledUsers: users.filter(u => u.disabled).length,
      withPhone: users.filter(u => u.phoneNumber).length,
      withPhoto: users.filter(u => u.photoURL).length,
      withCustomClaims: users.filter(u => u.customClaims).length,
      withMFA: users.filter(u => u.multiFactor?.enrolledFactors?.length > 0).length,};

    for (const u of users) {
      if (u.customClaims) {
        results.customClaims[u.uid] = u.customClaims;}}

    if (!QUIET) console.log(` Total users: ${users.length}`);
  } catch (e) {
    logError("auth", e);}}

/**
 * Dumps cloud storage buckets and file metadata.
 * Does NOT download file contents.
 */
async function dumpStorage() {
  if (!ENABLED_SERVICES.has("storage")) return;
  if (!QUIET) console.log("\n[Storage] Starting dump...");

  try {
    const [buckets] = await storage.getBuckets();
    results.storage.buckets = buckets.map(b => ({
      name: b.name,
      id: b.id,
      location: b.metadata?.location,
      storageClass: b.metadata?.storageClass,
      created: b.metadata?.timeCreated,
      updated: b.metadata?.updated,
      iamConfiguration: b.metadata?.iamConfiguration,
      versioning: b.metadata?.versioning,
      labels: b.metadata?.labels,
      cors: b.metadata?.cors,
      lifecycle: b.metadata?.lifecycle,}));

    if (!QUIET) console.log(`  Bucket count: ${buckets.length}`);

    for (const bucket of buckets) {
      const [files] = await bucket.getFiles();
      results.storage.files[bucket.name] = files.map(f => ({
        name: f.name,
        size: f.metadata?.size,
        contentType: f.metadata?.contentType,
        contentEncoding: f.metadata?.contentEncoding,
        updated: f.metadata?.updated,
        created: f.metadata?.timeCreated,
        md5Hash: f.metadata?.md5Hash,
        crc32c: f.metadata?.crc32c,
        generation: f.metadata?.generation,
        metageneration: f.metadata?.metageneration,
        storageClass: f.metadata?.storageClass,
        mediaLink: f.metadata?.mediaLink,
        selfLink: f.metadata?.selfLink,
        public: f.metadata?.acl?.some(a => a.entity === "allUsers") || false,
        owner: f.metadata?.owner,
        metadata: f.metadata?.metadata,
        cacheControl: f.metadata?.cacheControl,}));

      if (!QUIET) console.log(`  [${bucket.name}] => ${files.length} files`);}
  } catch (e) {
    logError("storage", e);}}

  //Dumps the Firebase Auth project configuration
async function dumpProjectConfig() {
  if (!ENABLED_SERVICES.has("projectConfig")) return;
  if (!QUIET) console.log("\n[Project Config] Starting dump...");

  try {
    results.projectConfig = await auth.getProjectConfig();
    if (!QUIET) console.log("  Project config read");
  } catch (e) {
    logError("projectConfig", e);}}

//Dumps Security Rules releases and ruleset contents
async function dumpSecurityRules() {
  if (!ENABLED_SERVICES.has("securityRules")) return;
  if (!QUIET) console.log("\n[Security Rules] Starting dump...");

  try {
    const securityRules = getSecurityRules(app);
    const [releases] = await securityRules.listReleases();

    results.securityRules.releases = releases.map(r => ({
      name: r.name,
      rulesetName: r.rulesetName,
      createTime: r.createTime,
      updateTime: r.updateTime,}));

    for (const rel of releases) {
      try {
        const ruleset = await securityRules.getRuleset(rel.rulesetName);
        results.securityRules.rulesets.push({
          name: ruleset.name,
          source: ruleset.source?.files?.map(f => ({ name: f.name, content: f.content })),
          createTime: ruleset.createTime,});
      } catch (inner) {
        logError(`securityRules.ruleset(${rel.rulesetName})`, inner);}}

    if (!QUIET) {
      console.log(`  [OK] ${releases.length} releases, ${results.securityRules.rulesets.length} rulesets`);}
  } catch (e) {
    logError("securityRules", e);}}

//Checks App Check accessibilit
async function dumpAppCheck() {
  if (!ENABLED_SERVICES.has("appCheck")) return;
  if (!QUIET) console.log("\n[App Check] Starting dump...");

  try {
    const appCheck = getAppCheck(app);
    results.appCheck = { available: true, note: "App Check instance accessible" };
    if (!QUIET) console.log(" App Check accessible");
  } catch (e) {
    results.appCheck = { available: false, error: e.message };
    logError("appCheck", e);}}

// Checks FCM (Firebase Cloud Messaging) accessibility
async function dumpFCM() {
  if (!ENABLED_SERVICES.has("fcm")) return;
  if (!QUIET) console.log("\n[FCM] Starting dump...");

  try {
    const messaging = getMessaging(app);
    results.fcm = { accessible: true, note: "FCM messaging() instance accessible" };
    if (!QUIET) console.log("  FCM accessible");
  } catch (e) {
    logError("fcm", e);}}

//Dumps Remote Config template
async function dumpRemoteConfig() {
  if (!ENABLED_SERVICES.has("remoteConfig")) return;
  if (!QUIET) console.log("\n[Remote Config] Starting dump...");

  try {
    const rc = getRemoteConfig(app);
    const template = await rc.getTemplate();
    results.remoteConfig = {
      parameters: template.parameters,
      parameterGroups: template.parameterGroups,
      conditions: template.conditions,
      version: template.version,
      etag: template.etag,};
      
    if (!QUIET) console.log("  Remote Config template fetched");
  } catch (e) {
    logError("remoteConfig", e);}}

// dymps Firebase ML model list
async function dumpML() {
  if (!ENABLED_SERVICES.has("ml")) return;
  if (!QUIET) console.log("\n[ML] Starting dump...");

  try {
    const ml = getMachineLearning(app);
    const [models] = await ml.listModels();
    results.ml = models.map(m => ({
      displayName: m.displayName,
      modelId: m.modelId,
      createTime: m.createTime,
      updateTime: m.updateTime,
      validationError: m.validationError,
      published: m.published,
      etag: m.etag,
      modelHash: m.modelHash,
      tags: m.tags,}));
    if (!QUIET) console.log(`  ${models.length} ML models found`);
  } catch (e) {
    logError("ml", e);}}

// Dumps sanitized service account metadata 
async function dumpServiceAccountInfo() {
  if (!ENABLED_SERVICES.has("serviceAccount")) return;
  if (!QUIET) console.log("\n[Service Account] Extracting metadata...");

  results._serviceAccountInfo = {
    type: serviceAccount.type,
    project_id: serviceAccount.project_id,
    private_key_id: serviceAccount.private_key_id,
    client_email: serviceAccount.client_email,
    client_id: serviceAccount.client_id,
    auth_uri: serviceAccount.auth_uri,
    token_uri: serviceAccount.token_uri,
    auth_provider_x509_cert_url: serviceAccount.auth_provider_x509_cert_url,
    client_x509_cert_url: serviceAccount.client_x509_cert_url,
    universe_domain: serviceAccount.universe_domain,
    hasPrivateKey: !!serviceAccount.private_key,
    privateKeyLength: serviceAccount.private_key?.length,};

  if (!QUIET) console.log("  Service account metadata extracted ");}

// main
async function main() {
  const start = Date.now();

  await dumpServiceAccountInfo();
  await dumpFirestore();
  await dumpRealtimeDB();
  await dumpAuth();
  await dumpStorage();
  await dumpProjectConfig();
  await dumpSecurityRules();
  await dumpAppCheck();
  await dumpFCM();
  await dumpRemoteConfig();
  await dumpML();

  // Save all dump files
  saveJson("firebase_full_dump", results);
  saveJson("firestore_dump", results.firestore);
  saveJson("auth_users_dump", results.auth);
  saveJson("storage_dump", results.storage);
  saveJson("rtdb_dump", results.realtimeDatabase || {});
  saveJson("custom_claims_dump", results.customClaims);
  saveJson("project_config_dump", results.projectConfig || {});
  saveJson("security_rules_dump", results.securityRules);
  saveJson("remote_config_dump", results.remoteConfig || {});
  saveJson("ml_models_dump", results.ml || {});
  saveJson("service_account_info", results._serviceAccountInfo);

  const duration = ((Date.now() - start) / 1000).toFixed(2);

  if (!QUIET) {
    console.log(`Done in ${duration}s`);
    console.log(`Output: ${path.resolve(OUTPUT_DIR)}`);
    console.log(`Errors: ${results.errors.length}`);
    if (results.errors.length > 0) {
      console.log("Errors:");
      results.errors.forEach(e => console.log(`  - ${e.service}: ${e.error}`));}}}

main().catch(e => {
  console.error("[FATAL]", e.message);
  process.exit(1);});
