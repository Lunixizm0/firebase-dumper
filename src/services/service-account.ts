import type { ServiceAccountInfo, ServiceContext } from "../types.ts";

export async function dumpServiceAccount(ctx: ServiceContext): Promise<void> {
  const { config, logger, results, serviceAccount } = ctx;
  if (!config.enabledServices.has("serviceAccount")) return;

  logger.section("Service Account");
  logger.log("Extracting metadata...");

  const info: ServiceAccountInfo = {
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
    privateKeyLength: serviceAccount.private_key?.length
  };
  results._serviceAccountInfo = info;

  logger.log("  Service account metadata extracted");
}
