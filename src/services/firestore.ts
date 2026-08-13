import type { CollectionReference, Query, QueryDocumentSnapshot, QuerySnapshot } from "firebase-admin/firestore";
import { isApiDisabledError } from "../core/errors.ts";
import { logServiceError, markOk, skipService } from "../core/results.ts";
import { withRetry } from "../core/retry.ts";
import type { ServiceContext } from "../types.ts";

function formatTimestamp(ts: unknown): string | null {
  try {
    const candidate = ts as { toDate?: () => { toISOString?: () => string } };
    return candidate?.toDate?.()?.toISOString?.() ?? null;
  } catch {
    return null;
  }
}

async function fetchPage(
  colRef: CollectionReference,
  lastDoc: QueryDocumentSnapshot | undefined,
  pageSize: number,
  retries: number
): Promise<QuerySnapshot> {
  let query: Query = colRef.orderBy("__name__").limit(pageSize);
  if (lastDoc) query = query.startAfter(lastDoc);
  return withRetry(() => query.get(), { retries });
}

export async function dumpFirestore(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("firestore")) return;

  logger.section("Firestore");
  logger.log("Starting dump...");

  try {
    const db = ctx.clients.db;
    const collections = await db.listCollections();
    logger.log(`  Total root collections: ${collections.length}`);

    let totalDocs = 0;
    let totalSubcollections = 0;

    async function processDoc(
      doc: QueryDocumentSnapshot,
      colName: string,
      docs: Record<string, unknown>
    ): Promise<void> {
      totalDocs++;
      const docPath = `${colName}/${doc.id}`;

      docs[doc.id] = {
        _data: doc.data(),
        _createTime: formatTimestamp(doc.createTime),
        _updateTime: formatTimestamp(doc.updateTime),
        _readTime: formatTimestamp(doc.readTime)
      };

      const subcols = await doc.ref.listCollections();
      if (subcols.length === 0) return;

      totalSubcollections += subcols.length;
      for (const subcol of subcols) {
        const subData = await dumpCollection(subcol, docPath);
        if (!results.firestore.subcollections_recursive[docPath]) {
          results.firestore.subcollections_recursive[docPath] = {};
        }
        (results.firestore.subcollections_recursive[docPath] as Record<string, unknown>)[subcol.id] = subData;
      }
    }

    async function dumpCollection(
      colRef: CollectionReference,
      parentPath = ""
    ): Promise<Record<string, unknown>> {
      const colName = parentPath ? `${parentPath}/${colRef.id}` : colRef.id;
      const docs: Record<string, unknown> = {};
      let lastDoc: QueryDocumentSnapshot | undefined;
      let count = 0;

      for (;;) {
        const snap = await fetchPage(colRef, lastDoc, config.firestorePageSize, config.retries);
        if (snap.empty) break;

        for (const doc of snap.docs) {
          await processDoc(doc, colName, docs);
          count++;
          if (config.maxDocsPerCollection > 0 && count >= config.maxDocsPerCollection) break;
        }

        if (snap.docs.length < config.firestorePageSize) break;
        if (config.maxDocsPerCollection > 0 && count >= config.maxDocsPerCollection) break;
        lastDoc = snap.docs[snap.docs.length - 1];
      }

      return docs;
    }

    for (const col of collections) {
      results.firestore.collections[col.id] = await dumpCollection(col);
      logger.log(
        `  [${col.id}] => ${Object.keys(results.firestore.collections[col.id] as object).length} documents`
      );
    }

    results.firestore.stats = {
      totalRootCollections: collections.length,
      totalDocuments: totalDocs,
      totalSubcollections: totalSubcollections
    };

    logger.log(`  Firestore: ${totalDocs} docs, ${totalSubcollections} subcollections`);
    markOk(ctx, "firestore");
  } catch (e) {
    if (isApiDisabledError(e)) {
      skipService(ctx, "firestore", "Cloud Firestore API is not enabled for this project.");
    } else {
      logServiceError(ctx, "firestore", e);
    }
  }
}
