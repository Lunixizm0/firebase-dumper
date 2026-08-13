import type { ServiceAccount as AdminServiceAccount } from "firebase-admin/app";
import type { FirebaseClients, ServiceAccount } from "../types.ts";

export async function initFirebase(serviceAccount: ServiceAccount, dbUrl: string | null): Promise<FirebaseClients> {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  const { getStorage } = await import("firebase-admin/storage");

  const appConfig: Record<string, unknown> = {
    credential: cert(serviceAccount as unknown as AdminServiceAccount)
  };
  if (dbUrl) appConfig.databaseURL = dbUrl;

  const app = initializeApp(appConfig);
  return {
    app,
    db: getFirestore(app),
    auth: getAuth(app),
    storage: getStorage(app)
  };
}
