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
  .version("4.0.2")
  .option("-k, --key <path>", "Path to service account JSON key", "./serviceAccountKey.json")
  .option("-o, --out <dir>", "Output directory for dumped files", "./firebase_dump")
  .option("-u, --db-url <url>", "Realtime Database URL (optional)")
  .option("-b, --bucket <name>", "Storage bucket name, or a public bucket URL")
  .option("-s, --services <list>", "Comma separated services to dump (default: all)", "all")
  .option("-q, --quiet", "Suppress non error output", false)
  .parse();

const opts = program.opts();


// Path safety
const BLOCKED_ROOTS = [
  "/etc", "/sys", "/proc", "/dev", "/run", "/root", "/boot",
  "/bin", "/sbin", "/usr/bin", "/usr/sbin", "/lib", "/lib64",
  "/snap", "/tmp",];

function isSafePath(inputPath) {
  // Raw-input checks
  // "foo/../../etc" or "foo%2F..%2F.." etc
  if (/(\.\.[/\\])|(^\.\.([/\\]|$))/.test(inputPath)) {
    return false;}

  // Reject null bytes and common shell meta-characters 
  if (/[\x00-\x1f|;&`$<>!]/.test(inputPath)) {
    return false;}

  const resolved = path.resolve(inputPath);

  // Must not be the filesystem root
  if (resolved === path.parse(resolved).root.replace(/[/\\]$/, "") ||
      resolved === "/" || resolved === "\\") {
    return false;}

  // Must not target a sensitive directory
  for (const blocked of BLOCKED_ROOTS) {
    if (resolved === blocked || resolved.startsWith(blocked + path.sep)) {
      return false;}}

  return true;}

// Validates that the service account key file exists and is readable
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
      console.warn(`Warn: Service account key is readable by others (${mode.toString(8)}). Consider chmod 600`);}}}

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
const BUCKET_OVERRIDE = opts.bucket || null;
const QUIET = opts.quiet;
const ENABLED_SERVICES = parseServices(opts.services);

// validate input
validateKeyFile(SERVICE_KEY_PATH);

if (!isSafePath(OUTPUT_DIR)) {
  console.error("Err: Output directory path is unsafe");
  process.exit(1);}

if (BUCKET_OVERRIDE && !/^https?:\/\//i.test(BUCKET_OVERRIDE) && !isSafePath(BUCKET_OVERRIDE)) {
  console.error("Err: --bucket value contains illegal characters");
  process.exit(1);}

if (DB_URL) {
  try { new URL(DB_URL); } catch {
    console.error("Err: --db-url is not a valid URL.");
    process.exit(1);}
  if (!/^https:\/\/[a-zA-Z0-9_-]+\.firebaseio\.com\/?$/.test(DB_URL)) {
    console.error("Err: --db-url must be a Firebase RTDB URL (https://<project>.firebaseio.com)");
    process.exit(1);}}

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
  securityRules: { releases: [], rulesetMetadata: [], rulesets: [] },
  appCheck: null,
  fcm: { accessible: false },
  remoteConfig: null,
  ml: null,
  customClaims: {},
  errors: [],
  skipped: [],};

// Tracks status per service for the summary table
const SERVICE_STATUS = {};

// Console formatting helpers
const COLOR = process.env.NO_COLOR ? false : true;
const c = {
  bold: s => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  dim: s => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  green: s => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: s => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  red: s => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: s => (COLOR ? `\x1b[36m${s}\x1b[0m` : s),};

function section(title) {
  if (!QUIET) console.log(`\n${c.bold(c.cyan("> " + title))}`);}

function ok(msg) {
  if (!QUIET) console.log(`  ${c.green("+")} ${msg}`);}

function warn(msg) {
  if (!QUIET) console.log(`  ${c.yellow("*")} ${msg}`);}

// Error/skip classification
function isApiDisabledError(e) {
  const msg = e?.message || String(e);
  return /has not been used in project|it is disabled|SERVICE_DISABLED/i.test(msg);}

// True when the failure means "nothing exists yet"
function isNotFoundError(e) {
  const msg = e?.message || String(e);
  return /\bNOT_FOUND\b|not found/i.test(msg);}

function logSkipped(service, reason) {
  results.skipped.push({ service, reason });
  SERVICE_STATUS[service] = { status: "skipped", detail: reason };
  warn(`${service}: ${reason}`);}
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
  SERVICE_STATUS[service] = { status: "error", detail: msg };
  console.error(`  ${c.red("-")} [${service}] Error: ${msg}`);}

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
    SERVICE_STATUS.firestore = { status: "ok" };
  } catch (e) {
    if (isApiDisabledError(e)) {
      logSkipped("firestore", "Cloud Firestore API is not enabled for this project.");
    } else {
      logError("firestore", e);}}}

/**
 * Dumps the firebase realtime database root node.
 * Skips if no DB_URL was provided.
 */
async function dumpRealtimeDB() {
  if (!ENABLED_SERVICES.has("realtimeDB")) return;
  if (!QUIET) console.log("\n[Realtime DB] Starting dump...");

  if (!DB_URL) {
    logSkipped("rtdb", "No --db-url provided, RTDB dump skipped.");
    return;}

  try {
    const rtdb = getDatabase(app, DB_URL);
    const ref = rtdb.ref("/");
    const snap = await ref.once("value");
    results.realtimeDatabase = snap.val();
    const size = JSON.stringify(results.realtimeDatabase || {}).length;
    ok(`RTDB root dumped (~${size} bytes)`);
    SERVICE_STATUS.rtdb = { status: "ok" };
  } catch (e) {
    if (isNotFoundError(e)) {
      logSkipped("rtdb", "No Realtime Database provisioned for this project.");
    } else {
      logError("rtdb", e);}}}

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
    SERVICE_STATUS.auth = { status: "ok" };
  } catch (e) {
    logError("auth", e);}}

/**
 * Dumps object metadata from a publicly-listable S3-compatible bucket
 * (no AWS credentials) This only works if the buckets 
 * XML listing endpoint is already Only key/size/etag/timestamp metadata is
 * captured no object content is ever downloaded.
 */
async function dumpPublicBucket(bucketUrl) {
  const base = bucketUrl.endsWith("/") ? bucketUrl : `${bucketUrl}/`;
  let continuationToken = null;
  const objects = [];
  let bucketName = null;
  let page = 0;
  const MAX_PAGES = 50; 

  do {
    const params = new URLSearchParams({ "list-type": "2" });
    if (continuationToken) params.set("continuation-token", continuationToken);

    const resp = await fetch(`${base}?${params.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(15000),});
    const text = await resp.text();

    if (!resp.ok) {
      if (resp.status === 403 || /AccessDenied/i.test(text)) {
        logSkipped("storage", `Bucket exists but its listing isnt public (HTTP 403).`);
        return;}
      if (resp.status === 404 || /NoSuchBucket/i.test(text)) {
        logSkipped("storage", `Bucket not found at this URL (HTTP 404).`);
        return;}
      throw new Error(`HTTP ${resp.status} while listing bucket`);}

    bucketName = bucketName || (text.match(/<Name>([^<]*)<\/Name>/) || [])[1] || bucketUrl;

    const contentBlocks = text.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    for (const block of contentBlocks) {
      objects.push({
        key: (block.match(/<Key>([^<]*)<\/Key>/) || [])[1] || null,
        size: Number((block.match(/<Size>([^<]*)<\/Size>/) || [])[1]) || null,
        lastModified: (block.match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1] || null,
        etag: ((block.match(/<ETag>([^<]*)<\/ETag>/) || [])[1] || "").replace(/"/g, "") || null,
        storageClass: (block.match(/<StorageClass>([^<]*)<\/StorageClass>/) || [])[1] || null,});}

    page++;
    if (!QUIET) console.log(`  Page ${page}: ${contentBlocks.length} objects`);

    const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(text);
    continuationToken = isTruncated
      ? (text.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/) || [])[1] || null
      : null;

    if (continuationToken && page >= MAX_PAGES) {
      warn(`Reached ${MAX_PAGES}-page cap, stopping pagination early.`);
      break;}
  } while (continuationToken);

  results.storage.buckets.push({ name: bucketName, source: "public-anonymous-listing", url: bucketUrl });
  results.storage.files[bucketName] = objects;
  ok(`[${bucketName}] => ${objects.length} objects listed (metadata only, no content downloaded)`);
  SERVICE_STATUS.storage = { status: "ok" };}

/**
 * Dumps cloud storage buckets and file metadata.
 * Does NOT download file contents.
 */
async function dumpStorage() {
  if (!ENABLED_SERVICES.has("storage")) return;
  if (!QUIET) console.log("\n[Storage] Starting dump...");

  if (BUCKET_OVERRIDE && /^https?:\/\//i.test(BUCKET_OVERRIDE)) {
    try {
      await dumpPublicBucket(BUCKET_OVERRIDE);
    } catch (e) {
      logError("storage", e);}
    return;}

  try {
    const candidateNames = BUCKET_OVERRIDE
      ? [BUCKET_OVERRIDE]
      : [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];

    let bucket = null;
    let lastErr = null;
    for (const name of candidateNames) {
      try {
        const candidate = storage.bucket(name);
        await candidate.getMetadata(); 
        bucket = candidate;
        break;
      } catch (e) {
        lastErr = e;}}

    if (!bucket) {
      throw new Error(
        `No accessible bucket found (tried: ${candidateNames.join(", ")}). ` +
        `Pass --bucket <name> explicitly. Last error: ${lastErr?.message}`);}

    const [metadata] = await bucket.getMetadata();
    results.storage.buckets.push({
      name: metadata.name,
      id: metadata.id,
      location: metadata.location,
      storageClass: metadata.storageClass,
      created: metadata.timeCreated,
      updated: metadata.updated,
      iamConfiguration: metadata.iamConfiguration,
      versioning: metadata.versioning,
      labels: metadata.labels,
      cors: metadata.cors,
      lifecycle: metadata.lifecycle,});

    if (!QUIET) console.log(`  Using bucket: ${bucket.name}`);

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

    if (!QUIET) console.log(`  [${bucket.name}] => ${files.length} files`);
    SERVICE_STATUS.storage = { status: "ok" };
  } catch (e) {
    logError("storage", e);}}

  //Dumps the Firebase Auth project configuration
async function dumpProjectConfig() {
  if (!ENABLED_SERVICES.has("projectConfig")) return;
  if (!QUIET) console.log("\n[Project Config] Starting dump...");

  try {
    results.projectConfig = await auth.projectConfigManager().getProjectConfig();
    if (!QUIET) console.log("  Project config read");
    SERVICE_STATUS.projectConfig = { status: "ok" };
  } catch (e) {
    logError("projectConfig", e);}}

//Dumps Security Rules releases and ruleset contents
async function dumpSecurityRules() {
  if (!ENABLED_SERVICES.has("securityRules")) return;
  if (!QUIET) console.log("\n[Security Rules] Starting dump...");

  try {
    const securityRules = getSecurityRules(app);

    // The SDK only exposes whatever ruleset is currently deployed per service.
    let allMetadata = [];
    let pageToken;
    try {
      do {
        const page = await securityRules.listRulesetMetadata(100, pageToken);
        allMetadata = allMetadata.concat(page.rulesets || []);
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (/Invalid ListRulesets response/i.test(e.message)) {
        logSkipped("securityRules", "No rulesets exist in this project yet");
        allMetadata = [];
      } else {
        throw e;}}

    results.securityRules.rulesetMetadata = allMetadata.map(m => ({
      name: m.name,
      createTime: m.createTime,}));

    for (const meta of allMetadata) {
      try {
        const ruleset = await securityRules.getRuleset(meta.name);
        results.securityRules.rulesets.push({
          name: ruleset.name,
          source: ruleset.source?.files?.map(f => ({ name: f.name, content: f.content })),
          createTime: ruleset.createTime,});
      } catch (inner) {
        logError(`securityRules.ruleset(${meta.name})`, inner);}}

    try {
      const firestoreRuleset = await securityRules.getFirestoreRuleset();
      results.securityRules.releases.push({
        service: "cloud.firestore",
        rulesetName: firestoreRuleset.name,
        createTime: firestoreRuleset.createTime,});
    } catch (inner) {
      if (isNotFoundError(inner)) {
        logSkipped("securityRules", "No Firestore ruleset is currently deployed");
      } else {
        logError("securityRules.getFirestoreRuleset", inner);}}

    try {
      const storageRuleset = await securityRules.getStorageRuleset();
      results.securityRules.releases.push({
        service: "firebase.storage",
        rulesetName: storageRuleset.name,
        createTime: storageRuleset.createTime,});
    } catch (inner) {
      if (isNotFoundError(inner)) {
        logSkipped("securityRules", "No Storage ruleset is currently deployed");
      } else {
        logError("securityRules.getStorageRuleset", inner);}}

    if (!QUIET) {
      console.log(`  ${allMetadata.length} rulesets, ${results.securityRules.releases.length} active releases`);}
    SERVICE_STATUS.securityRules = SERVICE_STATUS.securityRules || { status: "ok" };
  } catch (e) {
    logError("securityRules", e);}}

//Probes App Check via REST the firebase-admin SDK has no enumeration API
// so we use the service-account credential to call the App Check REST endpoint
// that lists apps registered with App Check for the project.
async function dumpAppCheck() {
  if (!ENABLED_SERVICES.has("appCheck")) return;
  section("App Check");

  try {
    const tokenResult = await app.options.credential.getAccessToken();
    const accessToken = tokenResult.access_token;

    const url = `https://firebaseappcheck.googleapis.com/v1/projects/${projectId}/apps`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),});
    const body = await resp.text();

    if (resp.status === 401 || resp.status === 403) {
      logSkipped("appCheck",
        `Permission denied — credential needs roles/firebase.sdkAdminServiceAgent or ` +
        `firebaseappcheck.apps.list IAM permission`);
      return;}

    if (resp.status === 404 || isNotFoundError({ message: body })) {
      logSkipped("appCheck", "No App Check apps configured for this project");
      return;}

    if (isApiDisabledError({ message: body })) {
      logSkipped("appCheck", "Firebase App Check API is not enabled for this project");
      return;}

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);}

    const data = JSON.parse(body);
    const apps = data.apps || [];
    results.appCheck = {
      available: true,
      appCount: apps.length,
      apps: apps.map(a => ({
        name: a.name,
        appId: a.appId,
        displayName: a.displayName,
        tokenTtl: a.appCheckTokenTtl,})),};

    ok(`App Check: ${apps.length} app(s) listed`);
    SERVICE_STATUS.appCheck = { status: "ok" };
  } catch (e) {
    results.appCheck = { available: false, error: e.message };
    logError("appCheck", e);}}

// Probes FCM with a dry-run send This makes a real API call to the FCM
// endpoint dryRun=true means no actual push is dispatched The probe token
// is intentionally invalid we expect INVALID_ARGUMENT back which still
// proves the credential is authorised and the API is reachable
async function dumpFCM() {
  if (!ENABLED_SERVICES.has("fcm")) return;
  section("FCM");

  try {
    const messaging = getMessaging(app);
    let note;
    try {
      await messaging.send({ token: "firebase-dump-probe" }, true /* dryRun */);
      note = "dry-run send succeeded";
    } catch (probeErr) {
      const msg = probeErr?.message || "";
      if (/INVALID_ARGUMENT|invalid-registration-token|registration-token-not-registered/i.test(msg)) {
        // Expected: the probe token was rejected after the auth layer accepted
        note = "API reachable credentials valid";
      } else if (isApiDisabledError(probeErr)) {
        logSkipped("fcm", "Firebase Cloud Messaging API is not enabled for this project");
        return;
      } else {
        throw probeErr;}}

    results.fcm = { accessible: true, note };
    ok(`FCM: ${note}`);
    SERVICE_STATUS.fcm = { status: "ok" };
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
    SERVICE_STATUS.remoteConfig = { status: "ok" };
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
    SERVICE_STATUS.ml = { status: "ok" };
  } catch (e) {
    if (isApiDisabledError(e)) {
      logSkipped("ml", "Firebase ML API is not enabled for this project.");
    } else {
      logError("ml", e);}}}

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
    const okCount = Object.values(SERVICE_STATUS).filter(s => s.status === "ok").length;
    const skipCount = results.skipped.length;
    const errCount = results.errors.length;

    console.log(`\n${c.bold("Summary")}`);
    const rows = Object.entries(SERVICE_STATUS).sort(([a], [b]) => a.localeCompare(b));
    const nameWidth = Math.max(...rows.map(([name]) => name.length), 8);
    for (const [name, info] of rows) {
      const label = name.padEnd(nameWidth);
      if (info.status === "ok") console.log(`  ${c.green("+")} ${label}  ${c.dim("ok")}`);
      else if (info.status === "skipped") console.log(`  ${c.yellow("*")} ${label}  ${c.dim(info.detail)}`);
      else console.log(`  ${c.red("-")} ${label}  ${c.red(info.detail)}`);}

    console.log("");
    console.log(`Duration : ${duration}s`);
    console.log(`Output   : ${path.resolve(OUTPUT_DIR)}`);
    console.log(`${c.green("OK")}: ${okCount}   ${c.yellow("Skipped")}: ${skipCount}   ${c.red("Errors")}: ${errCount}`);}}

main().catch(e => {
  console.error("[FATAL]", e.message);
  process.exit(1);});
