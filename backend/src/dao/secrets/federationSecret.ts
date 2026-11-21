import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

/** The Sign in with Apple values of the stage's federation secret (authn-authz.md section 3.1). */
export interface AppleCredentials {
  servicesId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
}

const SecretSchema = z.object({
  appleServicesId: z.string(),
  appleTeamId: z.string(),
  appleKeyId: z.string(),
  applePrivateKeyPem: z.string(),
});

/** Placeholder the stack writes until the owner enters a real value. */
const PENDING = "PENDING";

/** The part of the Secrets Manager client the reader uses, so tests can stand in for it. */
export interface SecretSender {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string | undefined }>;
}

/**
 * Reads the Apple credentials from `allplay/<stage>/federation` once per
 * container. Null while any Apple field is still the PENDING placeholder, so
 * callers skip Apple work until the owner has set the values.
 */
export function createFederationSecretReader(
  secretId: string,
  client: SecretSender = new SecretsManagerClient({}),
): () => Promise<AppleCredentials | null> {
  let cached: Promise<AppleCredentials | null> | undefined;
  const read = async (): Promise<AppleCredentials | null> => {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const parsed = SecretSchema.safeParse(JSON.parse(out.SecretString ?? "{}"));
    if (!parsed.success) return null;
    const value = parsed.data;
    const fields = [
      value.appleServicesId,
      value.appleTeamId,
      value.appleKeyId,
      value.applePrivateKeyPem,
    ];
    if (fields.some((field) => field === "" || field === PENDING)) return null;
    return {
      servicesId: value.appleServicesId,
      teamId: value.appleTeamId,
      keyId: value.appleKeyId,
      privateKeyPem: value.applePrivateKeyPem,
    };
  };
  return () => {
    cached ??= read().catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  };
}
